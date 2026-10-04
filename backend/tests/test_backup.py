import gzip
import json
import shutil
from pathlib import Path

from tests.conftest import login

BACKUP_DIR = Path(__file__).parent / ".backups-test"


def teardown_module():
    shutil.rmtree(BACKUP_DIR, ignore_errors=True)


def test_backup_and_restore_roundtrip(client, admin, setup_data):
    # some data worth protecting
    cust = client.post("/api/customers", headers=admin, json={"name": "Backup Bob", "phone": "0300-BACKUP"}).json()
    order = client.post("/api/orders", headers=admin, json={
        "order_type": "takeaway", "items": [{"menu_item_id": setup_data["burger"]["id"], "quantity": 2}],
    }).json()

    r = client.get("/api/backup/download", headers=admin)
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"] and ".rmsbak" in r.headers["content-disposition"]
    backup = r.content
    payload = json.loads(gzip.decompress(backup))
    assert payload["format"] == "restaurant-management-backup"
    assert any(row for row in payload["tables"]["orders"]["rows"])

    # damage the data after the backup
    client.delete(f"/api/customers/{cust['id']}", headers=admin)
    client.post(f"/api/orders/{order['id']}/cancel", headers=admin, json={"reason": "oops"})
    client.post("/api/customers", headers=admin, json={"name": "After Backup", "phone": "0300-AFTER"})

    r = client.post("/api/backup/restore", headers=admin, files={"file": ("b.rmsbak", backup, "application/octet-stream")})
    assert r.status_code == 200, r.text
    assert r.json()["safety_backup"].startswith("pre-restore-")

    phones = [c["phone"] for c in client.get("/api/customers", headers=admin).json()]
    assert "0300-BACKUP" in phones and "0300-AFTER" not in phones
    assert client.get(f"/api/orders/{order['id']}", headers=admin).json()["status"] == "open"
    # sequences continue after the restored ids (no duplicate key errors)
    r = client.post("/api/customers", headers=admin, json={"name": "New After Restore", "phone": "0300-NEW"})
    assert r.status_code == 201
    assert r.json()["id"] > cust["id"]

    # the safety backup and manual server backups are listed and downloadable
    client.post("/api/backup/files", headers=admin)
    files = client.get("/api/backup/status", headers=admin).json()["files"]
    kinds = {f["kind"] for f in files}
    assert {"safety", "manual"} <= kinds
    assert client.get(f"/api/backup/files/{files[0]['name']}", headers=admin).status_code == 200
    assert client.get("/api/backup/files/..%2F..%2Fetc%2Fpasswd", headers=admin).status_code in (400, 404)


def test_restore_rejects_bad_files(client, admin):
    r = client.post("/api/backup/restore", headers=admin, files={"file": ("x.rmsbak", b"not a backup", "application/octet-stream")})
    assert r.status_code == 400
    wrong_version = gzip.compress(json.dumps({"format": "restaurant-management-backup", "format_version": 1,
                                              "schema_revision": "9999", "tables": {}}).encode())
    r = client.post("/api/backup/restore", headers=admin, files={"file": ("x.rmsbak", wrong_version, "application/octet-stream")})
    assert r.status_code == 400 and "version" in r.json()["detail"]
    # data untouched after a rejected restore
    assert client.get("/api/menu/items", headers=admin).json()


def test_backup_admin_only(client, admin):
    client.post("/api/users", headers=admin, json={"username": "mgr9", "full_name": "M", "password": "secret1", "role": "manager"})
    mgr = login(client, "mgr9", "secret1")
    assert client.get("/api/backup/download", headers=mgr).status_code == 403
    assert client.post("/api/backup/restore", headers=mgr, files={"file": ("x", b"x", "application/octet-stream")}).status_code == 403
