import asyncio

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from .. import backup as bk
from ..config import settings
from ..database import SessionLocal
from ..security import get_current_user, oauth2_scheme

router = APIRouter(prefix="/api/backup", tags=["backup"])


def admin_only(token: str = Depends(oauth2_scheme)) -> int:
    """Admin check with its own short-lived session.

    The usual request-scoped session stays open (holding table locks) until the response is sent,
    which would deadlock the TRUNCATE done by a restore.
    """
    with SessionLocal() as db:
        user = get_current_user(token, db)
        if user.role != "admin":
            raise HTTPException(status_code=403, detail="Only an administrator can manage backups")
        return user.id

MAX_UPLOAD = 512 * 1024 * 1024


@router.get("/status")
def status(_: int = Depends(admin_only)):
    files = bk.list_backup_files()
    autos = [f for f in files if f["kind"] == "automatic"]
    return {
        "interval_hours": settings.backup_interval_hours,
        "keep": settings.backup_keep,
        "directory": str(bk.backup_dir()),
        "last_automatic": autos[0] if autos else None,
        "files": files,
    }


@router.get("/download")
async def download(_: int = Depends(admin_only)):
    data, _summary = await asyncio.to_thread(bk.create_backup_bytes)
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{bk.backup_filename()}"'},
    )


@router.post("/files")
async def create_server_backup(_: int = Depends(admin_only)):
    """Write a backup into the server's backup folder (in addition to downloading)."""
    return await asyncio.to_thread(bk.write_backup_file, "manual-")


@router.get("/files/{name}")
def download_file(name: str, _: int = Depends(admin_only)):
    try:
        path = bk.backup_file_path(name)
    except bk.BackupError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Backup file not found")
    return FileResponse(path, media_type="application/octet-stream", filename=path.name)


async def _restore(content: bytes) -> dict:
    # safety net: keep a copy of the current data before replacing it
    safety = await asyncio.to_thread(bk.write_backup_file, "pre-restore-")
    try:
        result = await asyncio.to_thread(bk.restore_backup_bytes, content)
    except bk.BackupError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {**result, "safety_backup": safety["name"]}


@router.post("/restore")
async def restore_upload(file: UploadFile = File(...), _: int = Depends(admin_only)):
    content = await file.read(MAX_UPLOAD + 1)
    if len(content) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail="Backup file is too large")
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    return await _restore(content)


@router.post("/files/{name}/restore")
async def restore_server_file(name: str, _: int = Depends(admin_only)):
    try:
        path = bk.backup_file_path(name)
    except bk.BackupError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Backup file not found")
    return await _restore(path.read_bytes())
