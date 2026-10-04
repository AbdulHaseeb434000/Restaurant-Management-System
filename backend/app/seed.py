"""Initial data: admin account and settings always; demo data (menu, tables,
inventory, ~30 days of history) only on an empty database when enabled."""

import random
from datetime import datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .models import (
    AppSetting,
    Customer,
    DiningArea,
    DiningTable,
    Expense,
    ExpenseCategory,
    InventoryItem,
    ItemCategory,
    MenuCategory,
    MenuItem,
    Order,
    OrderItem,
    Payment,
    Purchase,
    PurchaseItem,
    StockAdjustment,
    StockIssue,
    StockIssueItem,
    Supplier,
    Unit,
    User,
)
from .security import hash_password
from .services import apply_purchase_cost, move_stock, recalc_order
from .utils import TZ, q2, today

UNITS = [("Kilogram", "kg"), ("Gram", "g"), ("Litre", "ltr"), ("Millilitre", "ml"), ("Piece", "pcs"),
         ("Dozen", "dz"), ("Packet", "pkt"), ("Bottle", "btl"), ("Can", "can")]

MENU = {
    "Starters": [("Chicken Wings (6 pcs)", 650), ("Fish Crackers", 450), ("Loaded Fries", 550),
                 ("Chicken Corn Soup", 380), ("Garlic Bread", 320)],
    "BBQ & Grill": [("Chicken Tikka", 750), ("Seekh Kabab (4 pcs)", 820), ("Malai Boti", 880),
                    ("Grilled Fish", 1250), ("Mixed Grill Platter", 2450)],
    "Karahi & Handi": [("Chicken Karahi (Half)", 1450), ("Chicken Karahi (Full)", 2700),
                       ("Mutton Karahi (Half)", 2350), ("Chicken White Handi", 1550), ("Daal Mash", 650)],
    "Rice & Biryani": [("Chicken Biryani", 520), ("Beef Pulao", 580), ("Egg Fried Rice", 480),
                       ("Plain Rice", 250)],
    "Burgers & Wraps": [("Zinger Burger", 590), ("Beef Smash Burger", 850), ("Chicken Shawarma", 380),
                        ("Club Sandwich", 690)],
    "Breads": [("Roti", 40), ("Naan", 70), ("Garlic Naan", 150), ("Paratha", 120)],
    "Desserts": [("Kheer", 280), ("Gulab Jamun (2 pcs)", 220), ("Chocolate Brownie", 390)],
    "Beverages": [("Soft Drink (Regular)", 150), ("Soft Drink (1.5L)", 330), ("Mineral Water", 120),
                  ("Fresh Lime", 250), ("Mint Margarita", 390), ("Doodh Patti Chai", 160)],
}

INVENTORY = [
    # name, category, unit, reorder, price
    ("Chicken (boneless)", "Meat & Poultry", "kg", 10, 1150), ("Chicken (with bone)", "Meat & Poultry", "kg", 15, 720),
    ("Mutton", "Meat & Poultry", "kg", 5, 2400), ("Beef Mince", "Meat & Poultry", "kg", 5, 1300),
    ("Fish (Rahu)", "Meat & Poultry", "kg", 4, 1100), ("Eggs", "Dairy & Eggs", "dz", 5, 380),
    ("Yogurt", "Dairy & Eggs", "kg", 5, 260), ("Cream", "Dairy & Eggs", "ltr", 3, 900),
    ("Milk", "Dairy & Eggs", "ltr", 10, 220), ("Butter", "Dairy & Eggs", "kg", 2, 1900),
    ("Basmati Rice", "Dry Goods", "kg", 25, 380), ("Flour (Atta)", "Dry Goods", "kg", 40, 140),
    ("Maida", "Dry Goods", "kg", 10, 160), ("Daal Mash", "Dry Goods", "kg", 5, 520),
    ("Sugar", "Dry Goods", "kg", 10, 155), ("Tea Leaves", "Dry Goods", "kg", 2, 1600),
    ("Cooking Oil", "Oils & Spices", "ltr", 20, 520), ("Ghee", "Oils & Spices", "kg", 5, 640),
    ("Salt", "Oils & Spices", "kg", 3, 60), ("Red Chilli Powder", "Oils & Spices", "kg", 2, 1100),
    ("Garam Masala", "Oils & Spices", "kg", 1, 2200), ("Tomatoes", "Vegetables", "kg", 10, 180),
    ("Onions", "Vegetables", "kg", 15, 140), ("Potatoes", "Vegetables", "kg", 20, 90),
    ("Green Chillies", "Vegetables", "kg", 2, 240), ("Ginger Garlic Paste", "Vegetables", "kg", 3, 420),
    ("Lemons", "Vegetables", "kg", 2, 300), ("Mint & Coriander", "Vegetables", "kg", 1, 200),
    ("Burger Buns", "Bakery", "pcs", 40, 35), ("Pita Bread", "Bakery", "pcs", 40, 25),
    ("Soft Drink Cans", "Beverages", "can", 48, 105), ("Soft Drink 1.5L", "Beverages", "btl", 24, 230),
    ("Mineral Water 500ml", "Beverages", "btl", 48, 60), ("Takeaway Boxes", "Packaging", "pcs", 100, 22),
    ("Paper Bags", "Packaging", "pcs", 100, 8),
]

SUPPLIERS = [
    ("Al-Madina Poultry", "Haji Aslam", "0300-1112233"),
    ("Fresh Veg Mandi", "Rafiq", "0321-4445566"),
    ("Metro Cash & Carry", "Sales Desk", "042-111-638-765"),
    ("City Beverages Distributor", "Imran", "0333-7778899"),
    ("Royal Meat Shop", "Bashir", "0345-2223344"),
]

EXPENSE_CATEGORIES = ["Rent", "Salaries", "Electricity", "Gas", "Water", "Maintenance", "Marketing",
                      "Fuel (Delivery)", "Miscellaneous"]

DEMO_USERS = [
    ("manager", "Sara Manager", "manager"),
    ("cashier", "Ali Cashier", "cashier"),
    ("waiter", "Usman Waiter", "waiter"),
    ("kitchen", "Chef Kamran", "kitchen"),
    ("store", "Bilal Storekeeper", "storekeeper"),
]

CUSTOMERS = [
    ("Ahmed Khan", "0300-1234567", "House 12, Street 4, Model Town"),
    ("Ayesha Siddiqui", "0321-7654321", "Flat 3B, Gulberg Heights"),
    ("Hamza Ali", "0333-1122334", "45-C, DHA Phase 5"),
    ("Fatima Noor", "0345-9988776", "House 88, Johar Town Block J"),
    ("Zain Malik", "0301-5566778", "Office 7, Mall Road Plaza"),
    ("Mariam Javed", "0312-3344556", "House 2, Cavalry Ground"),
]


def seed(db: Session, demo: bool = True) -> None:
    if not db.get(AppSetting, 1):
        db.add(AppSetting(id=1, restaurant_name="Spice Garden Restaurant", address="Main Boulevard, Lahore",
                          phone="042-35000000", currency="Rs", tax_rate=Decimal("16"),
                          service_charge_rate=Decimal("5"), default_delivery_fee=Decimal("150"),
                          receipt_footer="Thank you for dining with us! Please visit again."))
    if not db.scalar(select(func.count(User.id))):
        db.add(User(username=settings.admin_username.strip().lower(), full_name="Administrator",
                    password_hash=hash_password(settings.admin_password), role="admin"))
    if not db.scalar(select(func.count(Unit.id))):
        db.add_all(Unit(name=n, abbreviation=a) for n, a in UNITS)
    if not db.scalar(select(func.count(ExpenseCategory.id))):
        db.add_all(ExpenseCategory(name=n) for n in EXPENSE_CATEGORIES)
    db.commit()

    if demo and not db.scalar(select(func.count(MenuItem.id))):
        seed_demo(db)


def seed_demo(db: Session) -> None:
    rng = random.Random(42)
    users = {}
    for username, name, role in DEMO_USERS:
        u = db.scalar(select(User).where(User.username == username))
        if not u:
            u = User(username=username, full_name=name, role=role, password_hash=hash_password(f"{username}123"))
            db.add(u)
        users[role] = u
    admin = db.scalar(select(User).where(User.role == "admin"))

    # menu
    menu_items: list[MenuItem] = []
    for idx, (cat_name, items) in enumerate(MENU.items()):
        cat = MenuCategory(name=cat_name, sort_order=idx)
        db.add(cat)
        for n, (name, price) in enumerate(items):
            mi = MenuItem(category=cat, name=name, code=f"{cat_name[:2].upper()}{n + 1:02d}", price=Decimal(price),
                          cost_price=q2(Decimal(price) * Decimal("0.38")),
                          available_dine_in=True, available_takeaway=True,
                          available_delivery=cat_name != "Breads" or name in ("Naan", "Roti"))
            db.add(mi)
            menu_items.append(mi)

    # tables
    tables: list[DiningTable] = []
    for area_name, prefix, count, cap in (("Main Hall", "T", 8, 4), ("Family Hall", "F", 5, 6), ("Rooftop", "R", 4, 4)):
        area = DiningArea(name=area_name)
        db.add(area)
        for i in range(1, count + 1):
            t = DiningTable(area=area, name=f"{prefix}{i}", capacity=cap if i % 4 else cap + 2)
            db.add(t)
            tables.append(t)

    customers = [Customer(name=n, phone=p, address=a) for n, p, a in CUSTOMERS]
    db.add_all(customers)

    # inventory masters
    units = {u.abbreviation: u for u in db.scalars(select(Unit))}
    cats: dict[str, ItemCategory] = {}
    inv: list[tuple[InventoryItem, int]] = []
    for name, cat_name, unit, reorder, price in INVENTORY:
        if cat_name not in cats:
            cats[cat_name] = ItemCategory(name=cat_name)
            db.add(cats[cat_name])
        item = InventoryItem(name=name, category=cats[cat_name], unit=units[unit], reorder_level=Decimal(reorder),
                             store_qty=0, kitchen_qty=0, avg_cost=0, last_purchase_price=0,
                             sku=f"INV-{len(inv) + 1:03d}")
        db.add(item)
        inv.append((item, price))
    suppliers = [Supplier(name=n, contact_person=c, phone=p) for n, c, p in SUPPLIERS]
    db.add_all(suppliers)
    db.flush()

    t0 = today()
    days = 30

    def supplier_for(item: InventoryItem) -> Supplier:
        cat = item.category.name
        if cat == "Meat & Poultry":
            return suppliers[0] if "Chicken" in item.name else suppliers[4]
        if cat == "Vegetables":
            return suppliers[1]
        if cat == "Beverages":
            return suppliers[3]
        return suppliers[2]

    # purchases every 3 days + daily issues
    for d in range(days, -1, -1):
        day = t0 - timedelta(days=d)
        if d % 3 == 0:
            by_supplier: dict[int, list[tuple[InventoryItem, Decimal, Decimal]]] = {}
            for item, price in inv:
                qty = Decimal(int(Decimal(item.reorder_level) * Decimal(rng.uniform(0.8, 1.3))) + 1)
                cost = q2(Decimal(price) * Decimal(rng.uniform(0.94, 1.08)))
                by_supplier.setdefault(supplier_for(item).id, []).append((item, qty, cost))
            for sup in suppliers:
                lines = by_supplier.get(sup.id)
                if not lines:
                    continue
                p = Purchase(purchase_no="TMP", supplier_id=sup.id, purchase_date=day,
                             invoice_no=f"INV-{rng.randint(1000, 9999)}", created_by_id=users["storekeeper"].id)
                db.add(p)
                db.flush()
                p.purchase_no = f"PUR-{p.id:06d}"
                total = Decimal(0)
                for item, qty, cost in lines:
                    lt = q2(qty * cost)
                    total += lt
                    p.items.append(PurchaseItem(item_id=item.id, quantity=qty, unit_cost=cost, line_total=lt))
                    apply_purchase_cost(item, qty, cost)
                    move_stock(db, item, "store", qty, "purchase", day, unit_cost=cost, ref_type="purchase",
                               ref_id=p.id, ref_no=p.purchase_no, notes=f"From {sup.name}",
                               user_id=users["storekeeper"].id)
                p.total = q2(total)
                p.paid_amount = p.total if d > 6 else q2(total * Decimal("0.5"))
        # daily issue to kitchen
        issue = StockIssue(issue_no="TMP", issue_date=day, issued_to="Main Kitchen",
                           created_by_id=users["storekeeper"].id)
        db.add(issue)
        db.flush()
        issue.issue_no = f"ISS-{issue.id:06d}"
        total = Decimal(0)
        for idx, (item, _) in enumerate(inv):
            avail = Decimal(item.store_qty)
            want = (Decimal(item.reorder_level) * Decimal(rng.uniform(0.22, 0.34))).quantize(Decimal("1"))
            if d == 0 and idx % 8 == 0:
                # leave a few items below reorder level so the low-stock screens have something to show
                want = max(avail - (Decimal(item.reorder_level) * Decimal("0.6")).quantize(Decimal("1")), want)
            qty = min(want, avail)
            if qty <= 0:
                continue
            cost = Decimal(item.avg_cost)
            lt = q2(qty * cost)
            total += lt
            issue.items.append(StockIssueItem(item_id=item.id, quantity=qty, unit_cost=cost, line_total=lt))
            common = dict(unit_cost=cost, ref_type="issue", ref_id=issue.id, ref_no=issue.issue_no,
                          user_id=users["storekeeper"].id)
            move_stock(db, item, "store", -qty, "issue_out", day, notes="To Main Kitchen", **common)
            move_stock(db, item, "kitchen", qty, "issue_in", day, notes="From store", **common)
            if d % 7 == 0 and d > 0:
                # weekly kitchen closing count: record what was consumed since last count
                used = (Decimal(item.kitchen_qty) * Decimal(rng.uniform(0.85, 0.95))).quantize(Decimal("0.001"))
                if used <= 0:
                    continue
                adj = StockAdjustment(adjustment_date=day, item_id=item.id, location="kitchen", reason="consumption",
                                      quantity=-used, unit_cost=cost, value=q2(-used * cost),
                                      notes="Weekly kitchen closing count", created_by_id=users["kitchen"].id)
                db.add(adj)
                db.flush()
                move_stock(db, item, "kitchen", -used, "adjustment", day, unit_cost=cost, ref_type="adjustment",
                           ref_id=adj.id, ref_no=f"ADJ-{adj.id:06d}", notes="consumption: weekly count",
                           user_id=users["kitchen"].id)
        issue.total_value = q2(total)
        if d % 7 == 2:
            item, _ = inv[rng.randrange(len(inv))]
            q = min(Decimal(1), Decimal(item.store_qty))
            if q > 0:
                adj = StockAdjustment(adjustment_date=day, item_id=item.id, location="store", reason="wastage",
                                      quantity=-q, unit_cost=item.avg_cost, value=q2(-q * Decimal(item.avg_cost)),
                                      notes="Spoiled", created_by_id=users["storekeeper"].id)
                db.add(adj)
                db.flush()
                move_stock(db, item, "store", -q, "adjustment", day, ref_type="adjustment", ref_id=adj.id,
                           ref_no=f"ADJ-{adj.id:06d}", notes="wastage: Spoiled", user_id=users["storekeeper"].id)

    # expenses
    cats_exp = {c.name: c for c in db.scalars(select(ExpenseCategory))}
    month_start = t0 - timedelta(days=days)
    db.add(Expense(expense_date=month_start, category_id=cats_exp["Rent"].id, amount=Decimal(250000), paid_to="Landlord",
                   payment_method="bank", created_by_id=admin.id))
    db.add(Expense(expense_date=month_start + timedelta(days=1), category_id=cats_exp["Salaries"].id,
                   amount=Decimal(420000), paid_to="Staff payroll", payment_method="bank", created_by_id=admin.id))
    for d in range(days, -1, -1):
        day = t0 - timedelta(days=d)
        if d % 10 == 0:
            db.add(Expense(expense_date=day, category_id=cats_exp["Electricity"].id, amount=Decimal(rng.randint(30000, 45000)),
                           paid_to="LESCO", payment_method="bank", created_by_id=admin.id))
        if d % 2 == 0:
            db.add(Expense(expense_date=day, category_id=cats_exp["Fuel (Delivery)"].id, amount=Decimal(rng.randint(1500, 3500)),
                           paid_to="Fuel station", created_by_id=admin.id))
        if d % 9 == 4:
            db.add(Expense(expense_date=day, category_id=cats_exp["Maintenance"].id, amount=Decimal(rng.randint(3000, 12000)),
                           paid_to="Technician", notes="Repairs", created_by_id=admin.id))

    # historical orders
    app_settings = db.get(AppSetting, 1)
    staff = [users["cashier"], users["waiter"], users["manager"]]
    riders = ["Asif", "Naveed", "Shahid"]
    weights = [1, 1, 1, 1, 1, 1, 2, 3, 3, 2, 2, 1, 1, 2, 3, 4, 4, 3]  # 06:00 .. 23:00 weight index from 06
    order_count = 0
    for d in range(days, 0, -1):
        day = t0 - timedelta(days=d)
        n = rng.randint(25, 40) + (12 if day.weekday() >= 4 else 0)
        for _ in range(n):
            hour = rng.choices(range(11, 24), weights=weights[5:18])[0]
            created = datetime.combine(day, time(hour, rng.randint(0, 59)), tzinfo=TZ)
            otype = rng.choices(["dine_in", "takeaway", "delivery"], weights=[5, 3, 3])[0]
            order_count += 1
            order = Order(order_no=f"ORD-H{order_count:05d}", order_type=otype, status="completed",
                          created_by_id=rng.choice(staff).id, created_at=created,
                          completed_at=created + timedelta(minutes=rng.randint(15, 75)),
                          discount_type="amount", discount_value=0, kot_counter=1,
                          guests=rng.randint(1, 6) if otype == "dine_in" else 1)
            if otype == "dine_in":
                order.table_id = rng.choice(tables).id
            else:
                if rng.random() < 0.7:
                    cust = rng.choice(customers)
                    order.customer_id, order.customer_name, order.customer_phone = cust.id, cust.name, cust.phone
                    order.delivery_address = cust.address if otype == "delivery" else ""
                if otype == "delivery":
                    if not order.customer_phone:
                        order.customer_name, order.customer_phone = "Walk-in Caller", f"0300-{rng.randint(1000000, 9999999)}"
                        order.delivery_address = "Nearby area"
                    order.delivery_status = "delivered"
                    order.rider_name = rng.choice(riders)
                    order.delivery_fee = app_settings.default_delivery_fee
            for mi in rng.sample(menu_items, rng.randint(1, 5)):
                qty = rng.choice([1, 1, 1, 2, 2, 3])
                order.items.append(OrderItem(menu_item_id=mi.id, name=mi.name, category_name=mi.category.name,
                                             quantity=qty, unit_price=mi.price, line_total=q2(mi.price * qty),
                                             status="served", kot_no=1, sent_at=created, created_at=created))
            if rng.random() < 0.04 and len(order.items) > 1:
                order.items[-1].status = "cancelled"
                order.items[-1].cancel_reason = rng.choice(["Customer changed mind", "Wrong item punched", "Out of stock"])
            if rng.random() < 0.12:
                order.discount_type, order.discount_value = "percent", Decimal(rng.choice([5, 10, 15]))
            recalc_order(order, app_settings)
            if rng.random() < 0.03:
                order.status = "cancelled"
                order.cancel_reason = rng.choice(["Customer left", "Duplicate order", "Long wait time"])
            else:
                method = rng.choices(["cash", "card", "online"], weights=[6, 3, 2])[0]
                order.payments.append(Payment(method=method, amount=order.total, received_by_id=users["cashier"].id,
                                              created_at=order.completed_at))
                order.paid_amount = order.total
            db.add(order)
        db.flush()
    db.commit()
