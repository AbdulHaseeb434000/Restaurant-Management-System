from tests.conftest import login


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_auth_required(client):
    assert client.get("/api/orders").status_code == 401


def test_dine_in_full_flow(client, admin, setup_data):
    d = setup_data
    r = client.post("/api/orders", headers=admin, json={
        "order_type": "dine_in", "table_id": d["t1"]["id"], "guests": 2,
        "items": [{"menu_item_id": d["burger"]["id"], "quantity": 2}],
    })
    assert r.status_code == 201, r.text
    order = r.json()
    assert order["subtotal"] == 1000
    # service 5% = 50 ; tax 10% on 1050 = 105 ; total 1155
    assert order["service_charge"] == 50
    assert order["tax_amount"] == 105
    assert order["total"] == 1155

    # table now occupied, second order on same table rejected
    tables = {t["id"]: t for t in client.get("/api/tables", headers=admin).json()}
    assert tables[d["t1"]["id"]]["status"] == "occupied"
    assert tables[d["t1"]["id"]]["open_order_id"] == order["id"]
    r = client.post("/api/orders", headers=admin, json={"order_type": "dine_in", "table_id": d["t1"]["id"]})
    assert r.status_code == 400

    # add same item again merges unsent line
    order = client.post(f"/api/orders/{order['id']}/items", headers=admin, json={
        "items": [{"menu_item_id": d["burger"]["id"], "quantity": 1}, {"menu_item_id": d["fries"]["id"], "quantity": 1, "notes": "extra salt"}],
    }).json()
    assert len(order["items"]) == 2
    assert order["items"][0]["quantity"] == 3

    # send to kitchen -> KOT 1
    order = client.post(f"/api/orders/{order['id']}/send-to-kitchen", headers=admin).json()
    assert all(i["status"] == "sent" and i["kot_no"] == 1 for i in order["items"])
    tickets = client.get("/api/kitchen/tickets", headers=admin).json()
    assert any(t["order_id"] == order["id"] and t["kot_no"] == 1 for t in tickets)

    # sent items cannot be edited, only voided
    fries_line = order["items"][1]
    r = client.patch(f"/api/orders/{order['id']}/items/{fries_line['id']}", headers=admin, json={"quantity": 2})
    assert r.status_code == 400
    order = client.post(f"/api/orders/{order['id']}/items/{fries_line['id']}/void", headers=admin, json={"reason": "Wrong item"}).json()
    assert order["subtotal"] == 1500

    # kitchen marks ticket ready
    r = client.patch(f"/api/kitchen/tickets/{order['id']}/1", headers=admin, json={"status": "ready"})
    assert r.status_code == 200

    # discount 10%
    order = client.post(f"/api/orders/{order['id']}/discount", headers=admin, json={"discount_type": "percent", "discount_value": 10}).json()
    assert order["discount_amount"] == 150
    # net 1350, service 67.5, tax 141.75 -> 1559.25
    assert order["total"] == 1559.25

    # transfer table
    order = client.post(f"/api/orders/{order['id']}/transfer", headers=admin, json={"table_id": d["t2"]["id"]}).json()
    assert order["table_id"] == d["t2"]["id"]
    tables = {t["id"]: t for t in client.get("/api/tables", headers=admin).json()}
    assert tables[d["t1"]["id"]]["status"] == "available"
    assert tables[d["t2"]["id"]]["status"] == "occupied"

    # can't complete unpaid
    assert client.post(f"/api/orders/{order['id']}/complete", headers=admin).status_code == 400
    # overpay rejected
    r = client.post(f"/api/orders/{order['id']}/payments", headers=admin, json={"method": "cash", "amount": 99999})
    assert r.status_code == 400
    # split payment + close
    order = client.post(f"/api/orders/{order['id']}/payments", headers=admin, json={"method": "card", "amount": 1000}).json()
    assert order["balance_due"] == 559.25
    order = client.post(f"/api/orders/{order['id']}/complete", headers=admin, json={"payments": [{"method": "cash", "amount": 559.25}]}).json()
    assert order["status"] == "completed"
    assert order["paid_amount"] == 1559.25
    tables = {t["id"]: t for t in client.get("/api/tables", headers=admin).json()}
    assert tables[d["t2"]["id"]]["status"] == "available"

    # completed order is locked
    r = client.post(f"/api/orders/{order['id']}/items", headers=admin, json={"items": [{"menu_item_id": d["burger"]["id"], "quantity": 1}]})
    assert r.status_code == 400
    # reopen (manager/admin)
    order = client.post(f"/api/orders/{order['id']}/reopen", headers=admin).json()
    assert order["status"] == "open"
    order = client.post(f"/api/orders/{order['id']}/complete", headers=admin).json()
    assert order["status"] == "completed"


def test_delivery_requires_address_and_creates_customer(client, admin, setup_data):
    d = setup_data
    r = client.post("/api/orders", headers=admin, json={"order_type": "delivery", "customer_phone": "0300"})
    assert r.status_code == 400
    r = client.post("/api/orders", headers=admin, json={
        "order_type": "delivery", "customer_name": "Ali", "customer_phone": "0300-111", "delivery_address": "Street 1",
        "items": [{"menu_item_id": d["fries"]["id"], "quantity": 1}], "send_to_kitchen": True,
    })
    assert r.status_code == 201, r.text
    order = r.json()
    assert order["delivery_fee"] == 100
    assert order["service_charge"] == 0
    assert order["delivery_status"] == "pending"
    assert order["customer_id"]
    cust = client.get("/api/customers/by-phone/0300-111", headers=admin).json()
    assert cust["name"] == "Ali"
    order = client.post(f"/api/orders/{order['id']}/delivery-status", headers=admin, json={"delivery_status": "dispatched", "rider_name": "Asif"}).json()
    assert order["rider_name"] == "Asif"
    order = client.post(f"/api/orders/{order['id']}/complete", headers=admin, json={"payments": [{"method": "cash", "amount": order["total"]}]}).json()
    assert order["status"] == "completed"


def test_takeaway_cancel_and_unavailable_item(client, admin, setup_data):
    d = setup_data
    order = client.post("/api/orders", headers=admin, json={"order_type": "takeaway", "items": [{"menu_item_id": d["burger"]["id"], "quantity": 1}]}).json()
    # remove unsent item
    order = client.delete(f"/api/orders/{order['id']}/items/{order['items'][0]['id']}", headers=admin).json()
    assert order["items"] == [] and order["total"] == 0
    assert client.post(f"/api/orders/{order['id']}/complete", headers=admin).status_code == 400
    order = client.post(f"/api/orders/{order['id']}/cancel", headers=admin, json={"reason": "Customer left"}).json()
    assert order["status"] == "cancelled"

    client.patch(f"/api/menu/items/{d['fries']['id']}/availability", headers=admin, params={"is_available": False})
    r = client.post("/api/orders", headers=admin, json={"order_type": "takeaway", "items": [{"menu_item_id": d["fries"]["id"], "quantity": 1}]})
    assert r.status_code == 400
    client.patch(f"/api/menu/items/{d['fries']['id']}/availability", headers=admin, params={"is_available": True})


def test_role_permissions(client, admin, setup_data):
    r = client.post("/api/users", headers=admin, json={"username": "kit1", "full_name": "Kitchen One", "password": "secret1", "role": "kitchen"})
    assert r.status_code == 201
    r = client.post("/api/users", headers=admin, json={"username": "kit1", "full_name": "Dup", "password": "secret1", "role": "kitchen"})
    assert r.status_code == 409
    kit = login(client, "kit1", "secret1")
    assert client.get("/api/kitchen/tickets", headers=kit).status_code == 200
    assert client.post("/api/orders", headers=kit, json={"order_type": "takeaway"}).status_code == 403
    assert client.get("/api/reports", headers=kit).status_code == 403
    assert client.get("/api/users", headers=kit).status_code == 403
