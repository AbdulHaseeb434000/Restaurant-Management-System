"""Full-data backup and restore.

A backup is a gzip-compressed JSON document holding every table of the app plus the
schema (Alembic) revision it was taken from. Restores replace *all* data inside a
single transaction, so a failed restore leaves the database untouched.
"""

import gzip
import json
import logging
import re
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

from sqlalchemy import Date, DateTime, Numeric, select, text
from sqlalchemy.engine import Connection

from . import models  # noqa: F401  (registers tables)
from .config import settings
from .database import Base, engine

log = logging.getLogger("uvicorn.error")

FORMAT = "restaurant-management-backup"
FORMAT_VERSION = 1
EXTENSION = ".rmsbak"
AUTO_PREFIX = "auto-"
SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]+\.rmsbak$")


class BackupError(ValueError):
    pass


def _json_default(v):
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    raise TypeError(f"Cannot serialise {type(v)!r}")


def _current_revision(conn: Connection) -> str | None:
    try:
        return conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except Exception:  # table missing on very old databases
        return None


def create_backup_bytes() -> tuple[bytes, dict]:
    """Return (gzipped file content, summary)."""
    tables: dict[str, dict] = {}
    counts: dict[str, int] = {}
    with engine.connect() as conn:
        revision = _current_revision(conn)
        restaurant = conn.execute(text("SELECT restaurant_name FROM app_settings WHERE id = 1")).scalar()
        for table in Base.metadata.sorted_tables:
            cols = [c.name for c in table.columns]
            pk = list(table.primary_key.columns)
            rows = conn.execute(select(*table.columns).order_by(*pk)).all()
            tables[table.name] = {"columns": cols, "rows": [list(r) for r in rows]}
            counts[table.name] = len(rows)
    payload = {
        "format": FORMAT,
        "format_version": FORMAT_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "schema_revision": revision,
        "restaurant_name": restaurant,
        "tables": tables,
    }
    data = gzip.compress(json.dumps(payload, default=_json_default, separators=(",", ":")).encode("utf-8"))
    return data, {"schema_revision": revision, "counts": counts, "size": len(data)}


def backup_filename(prefix: str = "") -> str:
    return f"{prefix}rms-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}{EXTENSION}"


def _parse(content: bytes) -> dict:
    try:
        raw = gzip.decompress(content) if content[:2] == b"\x1f\x8b" else content
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        raise BackupError("This file is not a valid backup (could not read it)")
    if not isinstance(payload, dict) or payload.get("format") != FORMAT:
        raise BackupError("This file is not a Restaurant Management backup")
    if payload.get("format_version") != FORMAT_VERSION:
        raise BackupError("Backup format version is not supported by this app version")
    if not isinstance(payload.get("tables"), dict):
        raise BackupError("Backup file is damaged (no tables)")
    return payload


def _converter(column):
    t = column.type
    if isinstance(t, DateTime):
        return lambda v: None if v is None else datetime.fromisoformat(v)
    if isinstance(t, Date):
        return lambda v: None if v is None else date.fromisoformat(v)
    if isinstance(t, Numeric):
        return lambda v: None if v is None else Decimal(str(v))
    return lambda v: v


def restore_backup_bytes(content: bytes) -> dict:
    payload = _parse(content)
    known = {t.name: t for t in Base.metadata.sorted_tables}
    unknown = set(payload["tables"]) - set(known)
    if unknown:
        raise BackupError(f"Backup contains tables this app does not know: {', '.join(sorted(unknown))}")

    counts: dict[str, int] = {}
    with engine.begin() as conn:  # one transaction: all or nothing
        current = _current_revision(conn)
        if payload.get("schema_revision") != current:
            raise BackupError(
                f"Backup was made with database version {payload.get('schema_revision')} but this app is at "
                f"{current}. Restore it with the same app version."
            )
        names = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
        conn.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
        for table in Base.metadata.sorted_tables:
            block = payload["tables"].get(table.name)
            if not block:
                counts[table.name] = 0
                continue
            cols = block.get("columns", [])
            missing = [c for c in cols if c not in table.c]
            if missing:
                raise BackupError(f"Backup table {table.name} has unexpected columns: {', '.join(missing)}")
            conv = [_converter(table.c[c]) for c in cols]
            rows = [{c: f(v) for c, f, v in zip(cols, conv, r)} for r in block.get("rows", [])]
            for i in range(0, len(rows), 1000):
                conn.execute(table.insert(), rows[i : i + 1000])
            counts[table.name] = len(rows)
            # keep auto-increment ids in step with restored data
            if "id" in table.c:
                conn.execute(
                    text(
                        f"SELECT setval(pg_get_serial_sequence('\"{table.name}\"', 'id'), "
                        f"COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM \"{table.name}\""
                    )
                )
    return {"restored_from": payload.get("created_at"), "counts": counts}


# --------------------------------------------------------------------------- files on the server

def backup_dir() -> Path:
    path = Path(settings.backup_dir)
    if not path.is_absolute():
        path = Path(__file__).resolve().parent.parent / path
    path.mkdir(parents=True, exist_ok=True)
    return path


def list_backup_files() -> list[dict]:
    files = sorted(backup_dir().glob(f"*{EXTENSION}"), key=lambda p: p.stat().st_mtime, reverse=True)
    return [
        {
            "name": f.name,
            "size": f.stat().st_size,
            "created_at": datetime.fromtimestamp(f.stat().st_mtime, timezone.utc).isoformat(),
            "kind": "automatic" if f.name.startswith(AUTO_PREFIX) else ("safety" if f.name.startswith("pre-restore-") else "manual"),
        }
        for f in files
    ]


def backup_file_path(name: str) -> Path:
    if not SAFE_NAME.match(name):
        raise BackupError("Invalid backup file name")
    path = backup_dir() / name
    if not path.is_file():
        raise FileNotFoundError(name)
    return path


def write_backup_file(prefix: str) -> dict:
    data, summary = create_backup_bytes()
    path = backup_dir() / backup_filename(prefix)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)
    return {"name": path.name, **summary}


def prune_auto_backups() -> None:
    autos = sorted(backup_dir().glob(f"{AUTO_PREFIX}*{EXTENSION}"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in autos[max(settings.backup_keep, 1):]:
        old.unlink(missing_ok=True)


def auto_backup_if_due() -> str | None:
    """Write an automatic backup when the newest one is older than the interval."""
    hours = settings.backup_interval_hours
    if hours <= 0:
        return None
    autos = sorted(backup_dir().glob(f"{AUTO_PREFIX}*{EXTENSION}"), key=lambda p: p.stat().st_mtime, reverse=True)
    if autos:
        age_h = (datetime.now().timestamp() - autos[0].stat().st_mtime) / 3600
        if age_h < hours:
            return None
    info = write_backup_file(AUTO_PREFIX)
    prune_auto_backups()
    log.info("Automatic backup written: %s", info["name"])
    return info["name"]
