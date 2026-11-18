import gzip
import json
from datetime import date

TODAY = date.today().isoformat()

SETTINGS = {"restaurant_name": "Test Resto", "currency": "Rs", "tax_rate": 10, "service_charge_rate": 5,
            "default_delivery_fee": 100, "address": "", "phone": "", "receipt_footer": ""}


def _set_mode(client, admin, mode, location="kitchen"):
    r = client.put("/api/settings", headers=admin, json={**SETTINGS, "inventory_mode": mode, "recipe_stock_location": location})
    assert r.status_code == 200, r.text
    assert r.json()["inventory_mode"] == mode


def _item(client, admin, iid):
    return client.get(f"/api/inventory/items/{iid}", headers=admin).json()


def _fixture(client, admin):
    unit = client.post("/api/inventory/units", headers=admin, json={"name": "Gram-r", "abbreviation": "gr"}).json()
    sup = client.post("/api/inventory/suppliers", headers=admin, json={"name": "Recipe Supplier"}).json()
    meat = client.post("/api/inventory/items", headers=admin, json={"name": "Patty", "unit_id": unit["id"]}).json()
    bun = client.post("/api/inventory/items", headers=admin, json={"name": "Bun", "unit_id": unit["id"]}).json()
    client.post("/api/inventory/purchases", headers=admin, json={
        "supplier_id": sup["id"], "purchase_date": TODAY,
        "items": [{"item_id": meat["id"], "quantity": 10, "unit_cost": 100}, {"item_id": bun["id"], "quantity": 10, "unit_cost": 20}],
    })
    client.post("/api/inventory/issues", headers=admin, json={"issue_date": TODAY, "items": [
        {"item_id": meat["id"], "quantity": 6}, {"item_id": bun["id"], "quantity": 6}]})
    cat = client.post("/api/menu/categories", headers=admin, json={"name": "Recipe Cat"}).json()
    dish = client.post("/api/menu/items", headers=admin, json={"category_id": cat["id"], "name": "Recipe Burger", "price": 400}).json()
    side = client.post("/api/menu/items", headers=admin, json={"category_id": cat["id"], "name": "Plain Bun", "price": 50}).json()
    return meat, bun, dish, side


def test_recipe_mode_end_to_end(client, admin, setup_data):
    meat, bun, dish, side = _fixture(client, admin)

    # recipe: 1 patty + 1 bun per burger (a duplicate line is merged)
    r = client.put(f"/api/menu/items/{dish['id']}/recipe", headers=admin, json={"lines": [
        {"inventory_item_id": meat["id"], "quantity": 0.5}, {"inventory_item_id": meat["id"], "quantity": 0.5},
        {"inventory_item_id": bun["id"], "quantity": 1}]})
    assert r.status_code == 200, r.text
    rec = r.json()
    assert rec["recipe_cost"] == 120 and rec["food_cost_pct"] == 30 and len(rec["lines"]) == 2
    menu = {m["id"]: m for m in client.get("/api/menu/items", headers=admin).json()}
    assert menu[dish["id"]]["cost_price"] == 120  # synced from recipe
    summary = {s["menu_item_id"]: s for s in client.get("/api/menu/recipes/summary", headers=admin).json()}
    assert summary[dish["id"]]["line_count"] == 2
    assert client.put(f"/api/menu/items/{dish['id']}/recipe", headers=admin,
                      json={"lines": [{"inventory_item_id": 999999, "quantity": 1}]}).status_code == 400

    def sell(qty, void_one=False):
        o = client.post("/api/orders", headers=admin, json={"order_type": "takeaway", "send_to_kitchen": True, "items": [
            {"menu_item_id": dish["id"], "quantity": qty}, {"menu_item_id": side["id"], "quantity": 1}]}).json()
        if void_one:
            line = next(i for i in o["items"] if i["menu_item_id"] == dish["id"])
            o = client.post(f"/api/orders/{o['id']}/items/{line['id']}/void", headers=admin, json={"reason": "x", "quantity": 1}).json()
        return client.post(f"/api/orders/{o['id']}/complete", headers=admin,
                           json={"payments": [{"method": "cash", "amount": o["total"]}]}).json()

    # issue mode (default): nothing is deducted automatically
    _set_mode(client, admin, "issue")
    sell(2)
    assert _item(client, admin, meat["id"])["kitchen_qty"] == 6

    # recipe mode, kitchen stock: 3 burgers sold, 1 voided -> 2 deducted; side dish without recipe ignored
    _set_mode(client, admin, "recipe", "kitchen")
    order = sell(3, void_one=True)
    assert order["status"] == "completed"
    assert _item(client, admin, meat["id"])["kitchen_qty"] == 4
    assert _item(client, admin, bun["id"])["kitchen_qty"] == 4
    assert _item(client, admin, meat["id"])["store_qty"] == 4  # store untouched
    mv = client.get("/api/inventory/movements", headers=admin, params={"item_id": meat["id"], "movement_type": "sale"}).json()
    assert mv and mv[0]["ref_no"] == order["order_no"] and mv[0]["quantity"] == -2

    # reopening puts the stock back; completing again deducts again (no double count)
    reopened = client.post(f"/api/orders/{order['id']}/reopen", headers=admin).json()
    assert reopened["status"] == "open"
    assert _item(client, admin, meat["id"])["kitchen_qty"] == 6
    client.post(f"/api/orders/{order['id']}/complete", headers=admin)
    assert _item(client, admin, meat["id"])["kitchen_qty"] == 4

    # recipe mode from store; selling more than in stock is allowed (goes negative, sale never blocked)
    _set_mode(client, admin, "recipe", "store")
    sell(6)
    assert _item(client, admin, meat["id"])["store_qty"] == -2
    assert _item(client, admin, meat["id"])["kitchen_qty"] == 4

    # P&L food cost follows the method; new reports run
    pl = {r["line"]: r["amount"] for r in client.get("/api/reports/profit-loss", headers=admin).json()["rows"]}
    assert pl["Food cost (recipe cost of dishes sold)"] == -(2 * 120 + 6 * 120)
    costing = {r["item"]: r for r in client.get("/api/reports/menu-costing", headers=admin).json()["rows"]}
    assert costing["Recipe Burger"]["food_cost_pct"] == 30 and costing["Plain Bun"]["status"] == "NO RECIPE"
    var = {r["item"]: r for r in client.get("/api/reports/ingredient-variance", headers=admin).json()["rows"]}
    assert var["Patty"]["issued"] == 6 and var["Patty"]["deducted"] == 8
    _set_mode(client, admin, "issue")


def test_restore_older_version_backup(client, admin):
    backup = json.loads(gzip.decompress(client.get("/api/backup/download", headers=admin).content))
    # simulate a backup taken before migration 0002: old revision, no new table / columns
    backup["schema_revision"] = "0001"
    backup["tables"].pop("recipe_lines")
    for table, col in (("app_settings", "inventory_mode"), ("app_settings", "recipe_stock_location"),
                       ("order_items", "cost_amount"), ("orders", "stock_deducted")):
        block = backup["tables"][table]
        idx = block["columns"].index(col)
        block["columns"].pop(idx)
        for row in block["rows"]:
            row.pop(idx)
    data = gzip.compress(json.dumps(backup).encode())
    r = client.post("/api/backup/restore", headers=admin, files={"file": ("old.rmsbak", data, "application/octet-stream")})
    assert r.status_code == 200, r.text
    assert client.get("/api/settings", headers=admin).json()["inventory_mode"] == "issue"
    assert client.get("/api/menu/recipes/summary", headers=admin).json() == []
