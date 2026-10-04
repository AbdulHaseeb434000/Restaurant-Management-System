import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .backup import auto_backup_if_due
from .config import settings
from .database import SessionLocal
from .migrate import run_migrations
from .routers import auth, backup, customers, expenses, inventory, menu, orders, reports, tables
from .routers import settings as settings_router
from .seed import seed


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.secret_key == "change-me-in-production":
        logging.getLogger("uvicorn.error").warning("SECRET_KEY is the default value - set a strong SECRET_KEY before going live")
    run_migrations()
    with SessionLocal() as db:
        seed(db, demo=settings.seed_demo_data)
    task = asyncio.create_task(_auto_backup_loop()) if settings.backup_interval_hours > 0 else None
    yield
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


async def _auto_backup_loop():
    log = logging.getLogger("uvicorn.error")
    await asyncio.sleep(30)  # let startup settle
    while True:
        try:
            await asyncio.to_thread(auto_backup_if_due)
        except Exception:  # never let a failed backup take the app down
            log.exception("Automatic backup failed")
        await asyncio.sleep(15 * 60)


app = FastAPI(title="Restaurant Management System", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth, backup, settings_router, menu, tables, customers, orders, inventory, expenses, reports):
    app.include_router(r.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
