"""Apply Alembic migrations on startup."""

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from .database import engine

log = logging.getLogger(__name__)
ALEMBIC_INI = Path(__file__).resolve().parent.parent / "alembic.ini"


def run_migrations() -> None:
    cfg = Config(str(ALEMBIC_INI))
    cfg.attributes["configure_logger"] = False
    tables = set(inspect(engine).get_table_names())
    if "users" in tables and "alembic_version" not in tables:
        # database created before migrations were introduced: it already matches the initial schema
        log.info("Existing database without migration history - stamping initial revision")
        command.stamp(cfg, "0001")
    command.upgrade(cfg, "head")
