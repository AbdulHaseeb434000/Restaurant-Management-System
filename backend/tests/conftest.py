import os

os.environ.setdefault(
    "DATABASE_URL",
    os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg2://postgres:postgres@localhost:5432/restaurant_test"),
)
os.environ["SEED_DEMO_DATA"] = "false"
os.environ["BACKUP_INTERVAL_HOURS"] = "0"
os.environ["BACKUP_DIR"] = os.path.join(os.path.dirname(__file__), ".backups-test")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    _reset_schema()
    with TestClient(app) as c:  # startup runs the Alembic migrations
        yield c
    _reset_schema()


def _reset_schema():
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))


def login(client, username, password):
    r = client.post("/api/auth/login", data={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def admin(client):
    return login(client, "admin", "admin123")


@pytest.fixture(scope="session")
def setup_data(client, admin):
    """Minimal master data shared by tests."""
    client.put("/api/settings", headers=admin, json={
        "restaurant_name": "Test Resto", "currency": "Rs", "tax_rate": 10, "service_charge_rate": 5,
        "default_delivery_fee": 100, "address": "", "phone": "", "receipt_footer": "",
    })
    cat = client.post("/api/menu/categories", headers=admin, json={"name": "Mains"}).json()
    burger = client.post("/api/menu/items", headers=admin, json={"category_id": cat["id"], "name": "Burger", "price": 500}).json()
    fries = client.post("/api/menu/items", headers=admin, json={"category_id": cat["id"], "name": "Fries", "price": 200}).json()
    area = client.post("/api/areas", headers=admin, json={"name": "Hall"}).json()
    t1 = client.post("/api/tables", headers=admin, json={"name": "T1", "area_id": area["id"], "capacity": 4}).json()
    t2 = client.post("/api/tables", headers=admin, json={"name": "T2", "area_id": area["id"], "capacity": 2}).json()
    return {"burger": burger, "fries": fries, "t1": t1, "t2": t2, "cat": cat}
