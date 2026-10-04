"""Business reports.

Every report returns the same shape so the UI can render any of them generically:

    {key, title, description, date_from, date_to,
     columns: [{key, label, type}], rows: [...], totals: {...} | None,
     chart: {type, x, y: [...]} | None}

Sales reports only count *completed* orders and use the business timezone
(the DB session timezone is set from settings.timezone).
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Integer, and_, case, cast, func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
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
from ..security import get_current_user, require_roles
from ..utils import day_range, today

router = APIRouter(prefix="/api", tags=["reports"])

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
ORDER_TYPE_LABELS = {"dine_in": "Dine-in", "takeaway": "Take-away", "delivery": "Delivery"}


def col(key: str, label: str, type_: str = "text", total: bool = False) -> dict:
    return {"key": key, "label": label, "type": type_, "total": total}


def num(v) -> float:
    return float(v or 0)


@dataclass
class Ctx:
    db: Session
    start: object
    end: object
    date_from: date
    date_to: date

    def completed(self):
        """WHERE clause for completed orders inside the period."""
        return and_(Order.status == "completed", Order.created_at >= self.start, Order.created_at < self.end)

    def in_period(self):
        return and_(Order.created_at >= self.start, Order.created_at < self.end)


@dataclass
class Report:
    key: str
    title: str
    group: str
    description: str
    fn: Callable[[Ctx], dict]
    uses_dates: bool = True
    extra_roles: tuple[str, ...] = ()  # roles besides admin/manager allowed to run it


REPORTS: dict[str, Report] = {}


def report(key: str, title: str, group: str, description: str, uses_dates: bool = True, extra_roles: tuple = ()):
    def deco(fn):
        REPORTS[key] = Report(key, title, group, description, fn, uses_dates, extra_roles)
        return fn

    return deco


def _with_totals(columns: list[dict], rows: list[dict]) -> dict | None:
    keys = [c["key"] for c in columns if c.get("total")]
    if not keys:
        return None
    return {k: round(sum(num(r.get(k)) for r in rows), 3) for k in keys}


# =========================================================================== SALES

@report("daily-sales", "Daily Sales Summary", "Sales", "Day-by-day orders, gross sales, discounts, taxes and net totals.")
def daily_sales(c: Ctx):
    day = func.date(Order.created_at)
    rows = c.db.execute(
        select(
            day.label("day"),
            func.count(Order.id),
            func.sum(Order.subtotal),
            func.sum(Order.discount_amount),
            func.sum(Order.service_charge),
            func.sum(Order.tax_amount),
            func.sum(Order.delivery_fee),
            func.sum(Order.total),
        )
        .where(c.completed())
        .group_by(day)
        .order_by(day)
    ).all()
    data = [
        {
            "date": r[0].isoformat(),
            "orders": r[1],
            "gross": num(r[2]),
            "discount": num(r[3]),
            "service": num(r[4]),
            "tax": num(r[5]),
            "delivery": num(r[6]),
            "total": num(r[7]),
            "avg": round(num(r[7]) / r[1], 2) if r[1] else 0,
        }
        for r in rows
    ]
    columns = [
        col("date", "Date", "date"),
        col("orders", "Orders", "number", True),
        col("gross", "Gross Sales", "money", True),
        col("discount", "Discounts", "money", True),
        col("service", "Service Charge", "money", True),
        col("tax", "Tax", "money", True),
        col("delivery", "Delivery Fees", "money", True),
        col("total", "Net Total", "money", True),
        col("avg", "Avg Order Value", "money"),
    ]
    totals = _with_totals(columns, data)
    if totals and totals["orders"]:
        totals["avg"] = round(totals["total"] / totals["orders"], 2)
    return {"columns": columns, "rows": data, "totals": totals, "chart": {"type": "line", "x": "date", "y": ["total"]}}


@report("sales-by-order-type", "Sales by Order Type", "Sales", "Dine-in vs take-away vs delivery: volume, revenue and share.")
def sales_by_type(c: Ctx):
    rows = c.db.execute(
        select(Order.order_type, func.count(Order.id), func.sum(Order.total), func.sum(Order.guests))
        .where(c.completed())
        .group_by(Order.order_type)
        .order_by(func.sum(Order.total).desc())
    ).all()
    grand = sum(num(r[2]) for r in rows) or 1
    data = [
        {
            "order_type": ORDER_TYPE_LABELS.get(r[0], r[0]),
            "orders": r[1],
            "total": num(r[2]),
            "avg": round(num(r[2]) / r[1], 2) if r[1] else 0,
            "share": round(num(r[2]) * 100 / grand, 2),
        }
        for r in rows
    ]
    columns = [
        col("order_type", "Order Type"),
        col("orders", "Orders", "number", True),
        col("total", "Sales", "money", True),
        col("avg", "Avg Order Value", "money"),
        col("share", "Share %", "percent"),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data),
            "chart": {"type": "pie", "x": "order_type", "y": ["total"]}}


def _item_sales_rows(c: Ctx, group_by_category: bool):
    q = select(
        (OrderItem.category_name if group_by_category else OrderItem.name).label("name"),
        *([] if group_by_category else [OrderItem.category_name]),
        func.sum(OrderItem.quantity),
        func.sum(OrderItem.line_total),
        func.count(func.distinct(OrderItem.order_id)),
    ).join(Order, Order.id == OrderItem.order_id).where(c.completed(), OrderItem.status != "cancelled")
    if group_by_category:
        q = q.group_by(OrderItem.category_name)
    else:
        q = q.group_by(OrderItem.name, OrderItem.category_name)
    return c.db.execute(q.order_by(func.sum(OrderItem.line_total).desc())).all()


@report("item-sales", "Item-wise Sales", "Sales", "Quantity sold and revenue per menu item, ranked by revenue.")
def item_sales(c: Ctx):
    rows = _item_sales_rows(c, False)
    grand = sum(num(r[3]) for r in rows) or 1
    data = [
        {"rank": idx + 1, "item": r[0], "category": r[1], "qty": int(r[2]), "orders": r[4],
         "revenue": num(r[3]), "avg_price": round(num(r[3]) / r[2], 2) if r[2] else 0,
         "share": round(num(r[3]) * 100 / grand, 2)}
        for idx, r in enumerate(rows)
    ]
    columns = [
        col("rank", "#", "number"),
        col("item", "Item"),
        col("category", "Category"),
        col("qty", "Qty Sold", "number", True),
        col("orders", "Orders", "number"),
        col("avg_price", "Avg Price", "money"),
        col("revenue", "Revenue", "money", True),
        col("share", "Share %", "percent"),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data),
            "chart": {"type": "bar", "x": "item", "y": ["revenue"], "limit": 15}}


@report("category-sales", "Category-wise Sales", "Sales", "Revenue and quantity per menu category.")
def category_sales(c: Ctx):
    rows = _item_sales_rows(c, True)
    grand = sum(num(r[2]) for r in rows) or 1
    data = [
        {"category": r[0] or "-", "qty": int(r[1]), "orders": r[3], "revenue": num(r[2]),
         "share": round(num(r[2]) * 100 / grand, 2)}
        for r in rows
    ]
    columns = [
        col("category", "Category"),
        col("qty", "Qty Sold", "number", True),
        col("orders", "Orders", "number"),
        col("revenue", "Revenue", "money", True),
        col("share", "Share %", "percent"),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data),
            "chart": {"type": "pie", "x": "category", "y": ["revenue"]}}


@report("hourly-sales", "Hourly Sales (Peak Hours)", "Sales", "Orders and revenue by hour of day to find peak hours.")
def hourly_sales(c: Ctx):
    hour = cast(func.extract("hour", Order.created_at), Integer)
    rows = dict(
        (r[0], r[1:])
        for r in c.db.execute(
            select(hour, func.count(Order.id), func.sum(Order.total)).where(c.completed()).group_by(hour)
        ).all()
    )
    data = []
    for h in range(24):
        cnt, total = rows.get(h, (0, 0))
        if cnt or 8 <= h <= 23:
            data.append({"hour": f"{h:02d}:00 - {h:02d}:59", "orders": cnt, "total": num(total),
                         "avg": round(num(total) / cnt, 2) if cnt else 0})
    columns = [
        col("hour", "Hour"),
        col("orders", "Orders", "number", True),
        col("total", "Sales", "money", True),
        col("avg", "Avg Order Value", "money"),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data),
            "chart": {"type": "bar", "x": "hour", "y": ["total"]}}


@report("weekday-sales", "Day-of-Week Sales", "Sales", "Which weekdays bring the most business.")
def weekday_sales(c: Ctx):
    dow = cast(func.extract("isodow", Order.created_at), Integer)
    days = func.count(func.distinct(func.date(Order.created_at)))
    rows = {
        r[0]: r[1:]
        for r in c.db.execute(
            select(dow, func.count(Order.id), func.sum(Order.total), days).where(c.completed()).group_by(dow)
        ).all()
    }
    data = []
    for i, name in enumerate(WEEKDAYS, start=1):
        cnt, total, n_days = rows.get(i, (0, 0, 0))
        data.append({"weekday": name, "orders": cnt, "total": num(total),
                     "avg_per_day": round(num(total) / n_days, 2) if n_days else 0})
    columns = [
        col("weekday", "Day"),
        col("orders", "Orders", "number", True),
        col("total", "Sales", "money", True),
        col("avg_per_day", "Avg Sales / Day", "money"),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data),
            "chart": {"type": "bar", "x": "weekday", "y": ["total"]}}


@report("payment-methods", "Payment Method Summary", "Sales", "Collections split by cash, card and online payments.")
def payment_methods(c: Ctx):
    rows = c.db.execute(
        select(Payment.method, func.count(Payment.id), func.sum(Payment.amount))
        .join(Order, Order.id == Payment.order_id)
        .where(c.completed())
        .group_by(Payment.method)
        .order_by(func.sum(Payment.amount).desc())
    ).all()
    grand = sum(num(r[2]) for r in rows) or 1
    data = [{"method": r[0].title(), "count": r[1], "amount": num(r[2]), "share": round(num(r[2]) * 100 / grand, 2)}
            for r in rows]
    columns = [
        col("method", "Method"),
        col("count", "Transactions", "number", True),
        col("amount", "Amount", "money", True),
        col("share", "Share %", "percent"),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data),
            "chart": {"type": "pie", "x": "method", "y": ["amount"]}}


@report("discounts", "Discount Report", "Sales", "Every discounted order with the discount given and who took the order.")
def discounts(c: Ctx):
    rows = c.db.execute(
        select(Order.order_no, Order.created_at, Order.order_type, Order.subtotal, Order.discount_type,
               Order.discount_value, Order.discount_amount, Order.total, User.full_name)
        .outerjoin(User, User.id == Order.created_by_id)
        .where(c.completed(), Order.discount_amount > 0)
        .order_by(Order.created_at)
    ).all()
    data = [
        {"order_no": r[0], "date": r[1].isoformat(), "order_type": ORDER_TYPE_LABELS.get(r[2], r[2]),
         "subtotal": num(r[3]),
         "discount_rule": f"{num(r[5]):g}%" if r[4] == "percent" else "Flat",
         "discount": num(r[6]), "total": num(r[7]), "staff": r[8] or "-"}
        for r in rows
    ]
    columns = [
        col("order_no", "Order #"),
        col("date", "Date/Time", "datetime"),
        col("order_type", "Type"),
        col("staff", "Staff"),
        col("subtotal", "Gross", "money", True),
        col("discount_rule", "Rule"),
        col("discount", "Discount", "money", True),
        col("total", "Net Total", "money", True),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data), "chart": None}


@report("cancellations", "Cancelled Orders & Voided Items", "Sales", "Lost revenue from cancelled orders and voided items, with reasons.")
def cancellations(c: Ctx):
    data = []
    orders = c.db.execute(
        select(Order.order_no, Order.created_at, Order.order_type, Order.subtotal, Order.cancel_reason, User.full_name)
        .outerjoin(User, User.id == Order.created_by_id)
        .where(c.in_period(), Order.status == "cancelled")
    ).all()
    for r in orders:
        data.append({"kind": "Order cancelled", "order_no": r[0], "date": r[1].isoformat(),
                     "order_type": ORDER_TYPE_LABELS.get(r[2], r[2]), "item": "(whole order)", "qty": None,
                     "value": num(r[3]), "reason": r[4], "staff": r[5] or "-"})
    voids = c.db.execute(
        select(Order.order_no, OrderItem.created_at, Order.order_type, OrderItem.name, OrderItem.quantity,
               OrderItem.line_total, OrderItem.cancel_reason, User.full_name)
        .join(Order, Order.id == OrderItem.order_id)
        .outerjoin(User, User.id == Order.created_by_id)
        .where(c.in_period(), Order.status != "cancelled", OrderItem.status == "cancelled")
    ).all()
    for r in voids:
        data.append({"kind": "Item voided", "order_no": r[0], "date": r[1].isoformat(),
                     "order_type": ORDER_TYPE_LABELS.get(r[2], r[2]), "item": r[3], "qty": r[4],
                     "value": num(r[5]), "reason": r[6], "staff": r[7] or "-"})
    data.sort(key=lambda d: d["date"])
    columns = [
        col("kind", "Type"),
        col("order_no", "Order #"),
        col("date", "Date/Time", "datetime"),
        col("order_type", "Order Type"),
        col("item", "Item"),
        col("qty", "Qty", "number"),
        col("value", "Value", "money", True),
        col("reason", "Reason"),
        col("staff", "Order Taker"),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data), "chart": None}


@report("table-performance", "Table Performance", "Sales", "Revenue, covers and turnover for each dine-in table.")
def table_performance(c: Ctx):
    duration = func.avg(func.extract("epoch", Order.completed_at - Order.created_at) / 60)
    rows = c.db.execute(
        select(DiningTable.name, func.count(Order.id), func.sum(Order.guests), func.sum(Order.total), duration)
        .join(Order, Order.table_id == DiningTable.id)
        .where(c.completed(), Order.order_type == "dine_in")
        .group_by(DiningTable.name)
        .order_by(func.sum(Order.total).desc())
    ).all()
    data = [
        {"table": r[0], "orders": r[1], "guests": int(r[2] or 0), "total": num(r[3]),
         "per_guest": round(num(r[3]) / r[2], 2) if r[2] else 0,
         "avg_minutes": round(num(r[4]), 1)}
        for r in rows
    ]
    columns = [
        col("table", "Table"),
        col("orders", "Orders", "number", True),
        col("guests", "Covers", "number", True),
        col("total", "Sales", "money", True),
        col("per_guest", "Avg / Cover", "money"),
        col("avg_minutes", "Avg Seating (min)", "number"),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data),
            "chart": {"type": "bar", "x": "table", "y": ["total"]}}


@report("staff-performance", "Staff Sales Performance", "Sales", "Orders, revenue and discounts by the staff member who took the order.")
def staff_performance(c: Ctx):
    rows = c.db.execute(
        select(User.full_name, User.role, func.count(Order.id), func.sum(Order.total), func.sum(Order.discount_amount))
        .join(Order, Order.created_by_id == User.id)
        .where(c.completed())
        .group_by(User.full_name, User.role)
        .order_by(func.sum(Order.total).desc())
    ).all()
    data = [
        {"staff": r[0], "role": r[1].title(), "orders": r[2], "total": num(r[3]),
         "avg": round(num(r[3]) / r[2], 2) if r[2] else 0, "discount": num(r[4])}
        for r in rows
    ]
    columns = [
        col("staff", "Staff"),
        col("role", "Role"),
        col("orders", "Orders", "number", True),
        col("total", "Sales", "money", True),
        col("avg", "Avg Order Value", "money"),
        col("discount", "Discounts Given", "money", True),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data),
            "chart": {"type": "bar", "x": "staff", "y": ["total"]}}


@report("top-customers", "Top Customers", "Sales", "Repeat customers ranked by spend (take-away & delivery with phone numbers).")
def top_customers(c: Ctx):
    rows = c.db.execute(
        select(Order.customer_name, Order.customer_phone, func.count(Order.id), func.sum(Order.total),
               func.max(Order.created_at))
        .where(c.completed(), Order.customer_phone != "")
        .group_by(Order.customer_name, Order.customer_phone)
        .order_by(func.sum(Order.total).desc())
        .limit(100)
    ).all()
    data = [
        {"customer": r[0] or "-", "phone": r[1], "orders": r[2], "total": num(r[3]),
         "avg": round(num(r[3]) / r[2], 2) if r[2] else 0, "last_order": r[4].isoformat()}
        for r in rows
    ]
    columns = [
        col("customer", "Customer"),
        col("phone", "Phone"),
        col("orders", "Orders", "number", True),
        col("total", "Total Spent", "money", True),
        col("avg", "Avg Order", "money"),
        col("last_order", "Last Order", "datetime"),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data), "chart": None}


@report("delivery-report", "Delivery Report", "Sales", "Delivery orders per rider with fees and order value.")
def delivery_report(c: Ctx):
    rider = func.coalesce(func.nullif(Order.rider_name, ""), "(unassigned)")
    rows = c.db.execute(
        select(rider, func.count(Order.id), func.sum(Order.delivery_fee), func.sum(Order.total),
               func.sum(case((Order.delivery_status == "delivered", 1), else_=0)))
        .where(c.completed(), Order.order_type == "delivery")
        .group_by(rider)
        .order_by(func.count(Order.id).desc())
    ).all()
    data = [
        {"rider": r[0], "orders": r[1], "delivered": int(r[4] or 0), "fees": num(r[2]), "total": num(r[3])}
        for r in rows
    ]
    columns = [
        col("rider", "Rider"),
        col("orders", "Orders", "number", True),
        col("delivered", "Marked Delivered", "number", True),
        col("fees", "Delivery Fees", "money", True),
        col("total", "Order Value", "money", True),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data),
            "chart": {"type": "bar", "x": "rider", "y": ["orders"]}}


@report("non-selling-items", "Non-Selling Menu Items", "Sales", "Active menu items with zero sales in the period - candidates for menu review.")
def non_selling(c: Ctx):
    sold = (
        select(OrderItem.menu_item_id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(c.completed(), OrderItem.status != "cancelled")
    )
    rows = c.db.execute(
        select(MenuItem.name, MenuCategory.name, MenuItem.price, MenuItem.is_available)
        .join(MenuCategory, MenuCategory.id == MenuItem.category_id)
        .where(MenuItem.is_active.is_(True), MenuItem.id.not_in(sold))
        .order_by(MenuCategory.name, MenuItem.name)
    ).all()
    data = [{"item": r[0], "category": r[1], "price": num(r[2]), "available": "Yes" if r[3] else "No"} for r in rows]
    columns = [col("item", "Item"), col("category", "Category"), col("price", "Price", "money"),
               col("available", "Currently Available")]
    return {"columns": columns, "rows": data, "totals": None, "chart": None}


# =========================================================================== INVENTORY

@report("purchases-by-supplier", "Purchases by Supplier", "Inventory", "Purchase value, payments and outstanding balance per supplier.")
def purchases_by_supplier(c: Ctx):
    rows = c.db.execute(
        select(Supplier.name, func.count(Purchase.id), func.sum(Purchase.total), func.sum(Purchase.paid_amount))
        .join(Purchase, Purchase.supplier_id == Supplier.id)
        .where(Purchase.status == "received", Purchase.purchase_date.between(c.date_from, c.date_to))
        .group_by(Supplier.name)
        .order_by(func.sum(Purchase.total).desc())
    ).all()
    data = [{"supplier": r[0], "invoices": r[1], "total": num(r[2]), "paid": num(r[3]),
             "balance": round(num(r[2]) - num(r[3]), 2)} for r in rows]
    columns = [
        col("supplier", "Supplier"),
        col("invoices", "Purchases", "number", True),
        col("total", "Purchase Value", "money", True),
        col("paid", "Paid", "money", True),
        col("balance", "Balance Due", "money", True),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data),
            "chart": {"type": "bar", "x": "supplier", "y": ["total"]}}


@report("purchase-items", "Item-wise Purchases", "Inventory", "Quantity purchased, value and price range per ingredient.")
def purchase_items(c: Ctx):
    rows = c.db.execute(
        select(InventoryItem.name, Unit.abbreviation, func.sum(PurchaseItem.quantity), func.sum(PurchaseItem.line_total),
               func.min(PurchaseItem.unit_cost), func.max(PurchaseItem.unit_cost))
        .join(PurchaseItem, PurchaseItem.item_id == InventoryItem.id)
        .join(Purchase, Purchase.id == PurchaseItem.purchase_id)
        .join(Unit, Unit.id == InventoryItem.unit_id)
        .where(Purchase.status == "received", Purchase.purchase_date.between(c.date_from, c.date_to))
        .group_by(InventoryItem.name, Unit.abbreviation)
        .order_by(func.sum(PurchaseItem.line_total).desc())
    ).all()
    data = [{"item": r[0], "unit": r[1], "qty": num(r[2]), "value": num(r[3]),
             "avg_cost": round(num(r[3]) / num(r[2]), 2) if r[2] else 0,
             "min_cost": num(r[4]), "max_cost": num(r[5])} for r in rows]
    columns = [
        col("item", "Item"),
        col("unit", "Unit"),
        col("qty", "Qty Purchased", "qty"),
        col("min_cost", "Min Price", "money"),
        col("max_cost", "Max Price", "money"),
        col("avg_cost", "Avg Price", "money"),
        col("value", "Value", "money", True),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data),
            "chart": {"type": "bar", "x": "item", "y": ["value"], "limit": 15}}


@report("kitchen-issues", "Store-to-Kitchen Issues", "Inventory", "Ingredients issued from store to kitchen with cost (proxy for food cost).")
def kitchen_issues(c: Ctx):
    rows = c.db.execute(
        select(InventoryItem.name, Unit.abbreviation, func.sum(StockIssueItem.quantity), func.sum(StockIssueItem.line_total),
               func.count(func.distinct(StockIssue.id)))
        .join(StockIssueItem, StockIssueItem.item_id == InventoryItem.id)
        .join(StockIssue, StockIssue.id == StockIssueItem.issue_id)
        .join(Unit, Unit.id == InventoryItem.unit_id)
        .where(StockIssue.issue_date.between(c.date_from, c.date_to))
        .group_by(InventoryItem.name, Unit.abbreviation)
        .order_by(func.sum(StockIssueItem.line_total).desc())
    ).all()
    data = [{"item": r[0], "unit": r[1], "qty": num(r[2]), "issues": r[4], "value": num(r[3])} for r in rows]
    columns = [
        col("item", "Item"),
        col("unit", "Unit"),
        col("issues", "No. of Issues", "number"),
        col("qty", "Qty Issued", "qty"),
        col("value", "Cost Value", "money", True),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data),
            "chart": {"type": "bar", "x": "item", "y": ["value"], "limit": 15}}


@report("stock-valuation", "Current Stock & Valuation", "Inventory", "On-hand quantity in store and kitchen with weighted-average value.", uses_dates=False)
def stock_valuation(c: Ctx):
    rows = c.db.execute(
        select(InventoryItem.name, ItemCategory.name, Unit.abbreviation, InventoryItem.store_qty,
               InventoryItem.kitchen_qty, InventoryItem.avg_cost, InventoryItem.reorder_level)
        .join(Unit, Unit.id == InventoryItem.unit_id)
        .outerjoin(ItemCategory, ItemCategory.id == InventoryItem.category_id)
        .where(InventoryItem.is_active.is_(True))
        .order_by(ItemCategory.name, InventoryItem.name)
    ).all()
    data = []
    for r in rows:
        store, kitchen, cost, reorder = num(r[3]), num(r[4]), num(r[5]), num(r[6])
        data.append({
            "item": r[0], "category": r[1] or "-", "unit": r[2], "store_qty": store, "kitchen_qty": kitchen,
            "avg_cost": round(cost, 2), "store_value": round(store * cost, 2),
            "kitchen_value": round(kitchen * cost, 2), "value": round((store + kitchen) * cost, 2),
            "status": "LOW" if reorder > 0 and store <= reorder else "OK",
        })
    columns = [
        col("item", "Item"),
        col("category", "Category"),
        col("unit", "Unit"),
        col("store_qty", "Store Qty", "qty"),
        col("kitchen_qty", "Kitchen Qty", "qty"),
        col("avg_cost", "Avg Cost", "money"),
        col("store_value", "Store Value", "money", True),
        col("kitchen_value", "Kitchen Value", "money", True),
        col("value", "Total Value", "money", True),
        col("status", "Status", "status"),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data),
            "chart": {"type": "pie", "x": "category", "y": ["value"], "aggregate": True}}


@report("reorder", "Low Stock / Reorder List", "Inventory", "Items at or below reorder level with suggested order quantity.", uses_dates=False)
def reorder(c: Ctx):
    rows = c.db.execute(
        select(InventoryItem.name, Unit.abbreviation, InventoryItem.store_qty, InventoryItem.kitchen_qty,
               InventoryItem.reorder_level, InventoryItem.last_purchase_price)
        .join(Unit, Unit.id == InventoryItem.unit_id)
        .where(InventoryItem.is_active.is_(True), InventoryItem.reorder_level > 0,
               InventoryItem.store_qty <= InventoryItem.reorder_level)
        .order_by(InventoryItem.name)
    ).all()
    data = []
    for r in rows:
        suggested = max(num(r[4]) * 2 - num(r[2]), 0)
        data.append({"item": r[0], "unit": r[1], "store_qty": num(r[2]), "kitchen_qty": num(r[3]),
                     "reorder_level": num(r[4]), "suggested": round(suggested, 3),
                     "est_cost": round(suggested * num(r[5]), 2)})
    columns = [
        col("item", "Item"),
        col("unit", "Unit"),
        col("store_qty", "Store Qty", "qty"),
        col("kitchen_qty", "Kitchen Qty", "qty"),
        col("reorder_level", "Reorder Level", "qty"),
        col("suggested", "Suggested Order", "qty"),
        col("est_cost", "Est. Cost (last price)", "money", True),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data), "chart": None}


@report("wastage", "Wastage & Adjustments", "Inventory", "Stock adjustments (wastage, damage, kitchen consumption counts, corrections) with value.")
def wastage(c: Ctx):
    rows = c.db.execute(
        select(StockAdjustment.adjustment_date, InventoryItem.name, Unit.abbreviation, StockAdjustment.location,
               StockAdjustment.reason, StockAdjustment.quantity, StockAdjustment.value, StockAdjustment.notes)
        .join(InventoryItem, InventoryItem.id == StockAdjustment.item_id)
        .join(Unit, Unit.id == InventoryItem.unit_id)
        .where(StockAdjustment.adjustment_date.between(c.date_from, c.date_to))
        .order_by(StockAdjustment.adjustment_date, StockAdjustment.id)
    ).all()
    data = [{"date": r[0].isoformat(), "item": r[1], "unit": r[2], "location": r[3].title(),
             "reason": r[4].replace("_", " ").title(), "qty": num(r[5]), "value": num(r[6]), "notes": r[7]}
            for r in rows]
    columns = [
        col("date", "Date", "date"),
        col("item", "Item"),
        col("location", "Location"),
        col("reason", "Reason"),
        col("qty", "Qty", "qty"),
        col("unit", "Unit"),
        col("value", "Value", "money", True),
        col("notes", "Notes"),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data), "chart": None}


# =========================================================================== FINANCE

@report("expenses", "Expenses by Category", "Finance", "Operating expenses grouped by category.")
def expenses_report(c: Ctx):
    rows = c.db.execute(
        select(ExpenseCategory.name, func.count(Expense.id), func.sum(Expense.amount))
        .join(Expense, Expense.category_id == ExpenseCategory.id)
        .where(Expense.expense_date.between(c.date_from, c.date_to))
        .group_by(ExpenseCategory.name)
        .order_by(func.sum(Expense.amount).desc())
    ).all()
    grand = sum(num(r[2]) for r in rows) or 1
    data = [{"category": r[0], "entries": r[1], "amount": num(r[2]), "share": round(num(r[2]) * 100 / grand, 2)}
            for r in rows]
    columns = [
        col("category", "Category"),
        col("entries", "Entries", "number", True),
        col("amount", "Amount", "money", True),
        col("share", "Share %", "percent"),
    ]
    return {"columns": columns, "rows": data, "totals": _with_totals(columns, data),
            "chart": {"type": "pie", "x": "category", "y": ["amount"]}}


def _sum(c: Ctx, stmt) -> float:
    return num(c.db.scalar(stmt))


@report("profit-loss", "Profit & Loss Summary", "Finance", "Net sales minus food cost (kitchen issues) and expenses. Food cost uses store-to-kitchen issues since recipes are not mapped yet.")
def profit_loss(c: Ctx):
    net_sales = _sum(c, select(func.sum(Order.subtotal - Order.discount_amount)).where(c.completed()))
    service = _sum(c, select(func.sum(Order.service_charge)).where(c.completed()))
    delivery = _sum(c, select(func.sum(Order.delivery_fee)).where(c.completed()))
    tax = _sum(c, select(func.sum(Order.tax_amount)).where(c.completed()))
    food_cost = _sum(c, select(func.sum(StockIssue.total_value)).where(StockIssue.issue_date.between(c.date_from, c.date_to)))
    waste = -_sum(c, select(func.sum(StockAdjustment.value)).where(
        StockAdjustment.adjustment_date.between(c.date_from, c.date_to),
        StockAdjustment.location == "store", StockAdjustment.value < 0))
    expenses = _sum(c, select(func.sum(Expense.amount)).where(Expense.expense_date.between(c.date_from, c.date_to)))
    revenue = net_sales + service + delivery
    gross_profit = revenue - food_cost - waste
    net_profit = gross_profit - expenses

    def pct(v):
        return round(v * 100 / revenue, 2) if revenue else 0

    lines = [
        ("Net food & beverage sales", net_sales, "income"),
        ("Service charges", service, "income"),
        ("Delivery fees", delivery, "income"),
        ("Total revenue (excl. tax)", revenue, "subtotal"),
        ("Food cost (issued to kitchen)", -food_cost, "cost"),
        ("Store wastage / damage", -waste, "cost"),
        ("Gross profit", gross_profit, "subtotal"),
        ("Operating expenses", -expenses, "cost"),
        ("Net profit", net_profit, "total"),
        ("Tax collected (payable, excluded above)", tax, "info"),
    ]
    data = [{"line": n, "amount": round(v, 2), "pct": pct(v) if kind != "info" else None, "kind": kind}
            for n, v, kind in lines]
    columns = [col("line", "Line"), col("amount", "Amount", "money"), col("pct", "% of Revenue", "percent")]
    return {"columns": columns, "rows": data, "totals": None, "chart": None}



# =========================================================================== DAY END

@report("day-end", "Day-End (Z) Summary", "Sales",
        "Shift / day closing summary: sales, collections by method, voids and expected cash in drawer.",
        extra_roles=("cashier",))
def day_end(c: Ctx):
    rows: list[dict] = []

    def section(title):
        rows.append({"line": title, "count": None, "amount": None, "kind": "subtotal"})

    na = object()  # marks "not applicable" so SQL NULL sums still show as 0.00

    def line(title, amount=na, count=None, kind="income"):
        rows.append({"line": title, "count": count, "amount": None if amount is na else round(num(amount), 2), "kind": kind})

    t = c.db.execute(
        select(func.count(Order.id), func.sum(Order.subtotal), func.sum(Order.discount_amount),
               func.sum(Order.service_charge), func.sum(Order.tax_amount), func.sum(Order.delivery_fee),
               func.sum(Order.total), func.sum(case((Order.order_type == "dine_in", Order.guests), else_=0)))
        .where(c.completed())
    ).one()
    section("Sales")
    line("Gross sales", t[1], t[0])
    line("Discounts", -num(t[2]))
    line("Service charges", t[3])
    line("Tax", t[4])
    line("Delivery fees", t[5])
    line("Net total", t[6], t[0], kind="total")
    line("Dine-in covers", count=int(t[7] or 0), kind="info")

    section("By order type")
    for r in c.db.execute(
        select(Order.order_type, func.count(Order.id), func.sum(Order.total))
        .where(c.completed()).group_by(Order.order_type).order_by(Order.order_type)
    ):
        line(ORDER_TYPE_LABELS.get(r[0], r[0]), r[2], r[1])

    section("Collections")
    pays = {r[0]: (r[1], num(r[2])) for r in c.db.execute(
        select(Payment.method, func.count(Payment.id), func.sum(Payment.amount))
        .join(Order, Order.id == Payment.order_id).where(c.completed()).group_by(Payment.method)
    )}
    for m in ("cash", "card", "online"):
        cnt, amt = pays.get(m, (0, 0.0))
        line(m.title(), amt, cnt)
    line("Total collected", sum(v[1] for v in pays.values()), sum(v[0] for v in pays.values()), kind="total")

    section("Cash drawer")
    cash_sales = pays.get("cash", (0, 0.0))[1]
    cash_exp = _sum(c, select(func.sum(Expense.amount)).where(
        Expense.expense_date.between(c.date_from, c.date_to), Expense.payment_method == "cash"))
    line("Cash sales", cash_sales)
    line("Cash expenses paid out", -cash_exp)
    line("Expected cash in drawer (excl. opening float)", cash_sales - cash_exp, kind="total")

    section("Exceptions")
    cancelled = c.db.execute(
        select(func.count(Order.id), func.sum(Order.subtotal)).where(c.in_period(), Order.status == "cancelled")
    ).one()
    voids = c.db.execute(
        select(func.count(OrderItem.id), func.sum(OrderItem.line_total))
        .join(Order, Order.id == OrderItem.order_id)
        .where(c.in_period(), Order.status != "cancelled", OrderItem.status == "cancelled")
    ).one()
    open_orders = c.db.execute(
        select(func.count(Order.id), func.sum(Order.total)).where(Order.status == "open")
    ).one()
    line("Cancelled orders", cancelled[1], cancelled[0], kind="cost")
    line("Voided items", voids[1], voids[0], kind="cost")
    line("Orders still open (unsettled, any date)", open_orders[1], open_orders[0], kind="info")

    columns = [col("line", "Line"), col("count", "Count", "number"), col("amount", "Amount", "money")]
    return {"columns": columns, "rows": rows, "totals": None, "chart": None}


# =========================================================================== endpoints

def _can_run(rep: Report, user: User) -> bool:
    return user.role in ("admin", "manager") or user.role in rep.extra_roles


@router.get("/reports")
def list_reports(user: User = Depends(get_current_user)):
    return [
        {"key": r.key, "title": r.title, "group": r.group, "description": r.description, "uses_dates": r.uses_dates}
        for r in REPORTS.values()
        if _can_run(r, user)
    ]


@router.get("/reports/{key}")
def run_report(
    key: str,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rep = REPORTS.get(key)
    if not rep:
        raise HTTPException(status_code=404, detail="Report not found")
    if not _can_run(rep, user):
        raise HTTPException(status_code=403, detail="You do not have permission for this report")
    start, end, d_from, d_to = day_range(date_from, date_to, default_days=0 if key == "day-end" else 6)
    result = rep.fn(Ctx(db, start, end, d_from, d_to))
    return {
        "key": rep.key,
        "title": rep.title,
        "group": rep.group,
        "description": rep.description,
        "uses_dates": rep.uses_dates,
        "date_from": d_from.isoformat(),
        "date_to": d_to.isoformat(),
        **result,
    }


# =========================================================================== dashboard

@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), _: User = Depends(require_roles("manager", "cashier"))):
    t = today()
    start, end, *_ = day_range(t, t)
    c = Ctx(db, start, end, t, t)
    w_start, *_ = day_range(t - timedelta(days=6), t)

    today_row = db.execute(
        select(func.count(Order.id), func.coalesce(func.sum(Order.total), 0), func.coalesce(func.sum(Order.guests), 0))
        .where(c.completed())
    ).one()
    open_row = db.execute(
        select(func.count(Order.id), func.coalesce(func.sum(Order.total), 0)).where(Order.status == "open")
    ).one()
    by_type = {
        r[0]: {"orders": r[1], "total": num(r[2])}
        for r in db.execute(
            select(Order.order_type, func.count(Order.id), func.sum(Order.total)).where(c.completed()).group_by(Order.order_type)
        )
    }
    day = func.date(Order.created_at)
    trend_rows = {
        r[0]: (r[1], num(r[2]))
        for r in db.execute(
            select(day, func.count(Order.id), func.sum(Order.total))
            .where(Order.status == "completed", Order.created_at >= w_start, Order.created_at < end)
            .group_by(day)
        )
    }
    trend = []
    for i in range(6, -1, -1):
        d = t - timedelta(days=i)
        cnt, total = trend_rows.get(d, (0, 0.0))
        trend.append({"date": d.isoformat(), "orders": cnt, "total": total})

    top_items = [
        {"item": r[0], "qty": int(r[1]), "revenue": num(r[2])}
        for r in db.execute(
            select(OrderItem.name, func.sum(OrderItem.quantity), func.sum(OrderItem.line_total))
            .join(Order, Order.id == OrderItem.order_id)
            .where(c.completed(), OrderItem.status != "cancelled")
            .group_by(OrderItem.name)
            .order_by(func.sum(OrderItem.quantity).desc())
            .limit(5)
        )
    ]
    payments = {
        r[0]: num(r[1])
        for r in db.execute(
            select(Payment.method, func.sum(Payment.amount))
            .join(Order, Order.id == Payment.order_id)
            .where(c.completed())
            .group_by(Payment.method)
        )
    }
    tables = db.execute(
        select(DiningTable.status, func.count(DiningTable.id)).where(DiningTable.is_active.is_(True)).group_by(DiningTable.status)
    ).all()
    occupied = db.scalar(
        select(func.count(func.distinct(Order.table_id))).where(Order.status == "open", Order.table_id.is_not(None))
    )
    total_tables = sum(r[1] for r in tables)
    low_stock = db.scalar(
        select(func.count(InventoryItem.id)).where(
            InventoryItem.is_active.is_(True), InventoryItem.reorder_level > 0,
            InventoryItem.store_qty <= InventoryItem.reorder_level,
        )
    )
    kitchen_pending = db.scalar(
        select(func.count(OrderItem.id))
        .join(Order, Order.id == OrderItem.order_id)
        .where(OrderItem.status.in_(["sent", "preparing"]), Order.status != "cancelled")
    )
    pending_deliveries = db.scalar(
        select(func.count(Order.id)).where(
            Order.order_type == "delivery", Order.status != "cancelled",
            Order.delivery_status.in_(["pending", "dispatched"]),
        )
    )
    expenses_today = num(db.scalar(select(func.sum(Expense.amount)).where(Expense.expense_date == t)))
    cancelled_today = db.scalar(select(func.count(Order.id)).where(c.in_period(), Order.status == "cancelled"))

    orders_today, sales_today, guests_today = today_row
    return {
        "date": t.isoformat(),
        "sales_today": num(sales_today),
        "orders_today": orders_today,
        "avg_order_value": round(num(sales_today) / orders_today, 2) if orders_today else 0,
        "guests_today": int(guests_today or 0),
        "open_orders": open_row[0],
        "open_orders_value": num(open_row[1]),
        "cancelled_today": cancelled_today,
        "by_type": by_type,
        "payments": payments,
        "trend": trend,
        "top_items": top_items,
        "tables": {"total": total_tables, "occupied": occupied or 0},
        "low_stock": low_stock,
        "kitchen_pending": kitchen_pending,
        "pending_deliveries": pending_deliveries,
        "expenses_today": expenses_today,
    }
