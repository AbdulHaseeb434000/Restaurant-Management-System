from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Base, SessionLocal, engine
from .routers import auth, customers, expenses, inventory, menu, orders, reports, tables
from .routers import settings as settings_router
from .seed import seed


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed(db, demo=settings.seed_demo_data)
    yield


app = FastAPI(title="Restaurant Management System", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth, settings_router, menu, tables, customers, orders, inventory, expenses, reports):
    app.include_router(r.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
