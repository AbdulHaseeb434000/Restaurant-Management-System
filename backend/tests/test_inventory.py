from datetime import date

TODAY = date.today().isoformat()


def _setup(client, admin):
    unit = client.post("/api/inventory/units", headers=admin, json={"name": "Kilo", "abbreviation": "kilo"}).json()
    cat = client.post("/api/inventory/categories", headers=admin, json={"name": "Veg"}).json()
    item = client.post("/api/inventory/items", headers=admin, json={"name": "Onion", "unit_id": unit["id"], "category_id": cat["id"], "reorder_level": 5}).json()
    sup = client.post("/api/inventory/suppliers", headers=admin, json={"name": "Mandi"}).json()
    return item, sup


def test_purchase_issue_adjust_flow(client, admin):
    item, sup = _setup(client, admin)
    # purchase 10 @ 100 and 10 @ 200 -> avg 150
    r = client.post("/api/inventory/purchases", headers=admin, json={
        "supplier_id": sup["id"], "purchase_date": TODAY, "paid_amount": 500,
        "items": [{"item_id": item["id"], "quantity": 10, "unit_cost": 100}],
    })
    assert r.status_code == 201, r.text
    p1 = r.json()
    assert p1["total"] == 1000 and p1["purchase_no"].startswith("PUR-")
    client.post("/api/inventory/purchases", headers=admin, json={
        "supplier_id": sup["id"], "purchase_date": TODAY,
        "items": [{"item_id": item["id"], "quantity": 10, "unit_cost": 200}],
    })
    it = client.get(f"/api/inventory/items/{item['id']}", headers=admin).json()
    assert it["store_qty"] == 20 and it["avg_cost"] == 150 and it["last_purchase_price"] == 200

    # issue more than available fails
    r = client.post("/api/inventory/issues", headers=admin, json={"issue_date": TODAY, "items": [{"item_id": item["id"], "quantity": 25}]})
    assert r.status_code == 400
    r = client.post("/api/inventory/issues", headers=admin, json={"issue_date": TODAY, "items": [{"item_id": item["id"], "quantity": 16}]})
    assert r.status_code == 201, r.text
    assert r.json()["total_value"] == 2400
    it = client.get(f"/api/inventory/items/{item['id']}", headers=admin).json()
    assert it["store_qty"] == 4 and it["kitchen_qty"] == 16 and it["is_low"] is True

    # wastage must be negative
    r = client.post("/api/inventory/adjustments", headers=admin, json={"adjustment_date": TODAY, "item_id": item["id"], "location": "kitchen", "reason": "wastage", "quantity": 2})
    assert r.status_code == 400
    r = client.post("/api/inventory/adjustments", headers=admin, json={"adjustment_date": TODAY, "item_id": item["id"], "location": "kitchen", "reason": "wastage", "quantity": -2})
    assert r.status_code == 201 and r.json()["value"] == -300
    it = client.get(f"/api/inventory/items/{item['id']}", headers=admin).json()
    assert it["kitchen_qty"] == 14

    # ledger: 2 purchases, issue out/in, adjustment
    mv = client.get("/api/inventory/movements", headers=admin, params={"item_id": item["id"]}).json()
    assert [m["movement_type"] for m in reversed(mv)] == ["purchase", "purchase", "issue_out", "issue_in", "adjustment"]

    # cancelling a purchase whose stock was already issued fails (store only has 4)
    r = client.post(f"/api/inventory/purchases/{p1['id']}/cancel", headers=admin, json={"reason": "wrong"})
    assert r.status_code == 400

    # supplier balance
    sups = {s["id"]: s for s in client.get("/api/inventory/suppliers", headers=admin).json()}
    assert sups[sup["id"]]["balance_due"] == 2500
    r = client.post(f"/api/inventory/purchases/{p1['id']}/payment", headers=admin, json={"paid_amount": 1000})
    assert r.json()["paid_amount"] == 1000


def test_reports_all_run(client, admin):
    reports = client.get("/api/reports", headers=admin).json()
    assert len(reports) >= 12
    for rep in reports:
        r = client.get(f"/api/reports/{rep['key']}", headers=admin)
        assert r.status_code == 200, (rep["key"], r.text)
        body = r.json()
        assert {"columns", "rows"} <= body.keys()
    assert client.get("/api/reports/nope", headers=admin).status_code == 404
    assert client.get("/api/reports/daily-sales", headers=admin, params={"date_from": "2026-02-02", "date_to": "2026-01-01"}).status_code == 400
    assert client.get("/api/dashboard", headers=admin).status_code == 200


def test_expenses(client, admin):
    cats = client.get("/api/expenses/categories", headers=admin).json()
    r = client.post("/api/expenses", headers=admin, json={"expense_date": TODAY, "category_id": cats[0]["id"], "amount": 1500})
    assert r.status_code == 201
    assert any(e["amount"] == 1500 for e in client.get("/api/expenses", headers=admin).json())
