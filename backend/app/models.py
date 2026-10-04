from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

Money = Numeric(12, 2)
Qty = Numeric(12, 3)
Cost = Numeric(12, 4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# --------------------------------------------------------------------------- users / settings

class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(200))
    # admin | manager | cashier | waiter | kitchen | storekeeper
    role: Mapped[str] = mapped_column(String(20), default="cashier")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class AppSetting(Base):
    """Single-row table with restaurant-wide settings."""

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurant_name: Mapped[str] = mapped_column(String(120), default="My Restaurant")
    address: Mapped[str] = mapped_column(String(255), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    currency: Mapped[str] = mapped_column(String(10), default="Rs")
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    service_charge_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    default_delivery_fee: Mapped[Decimal] = mapped_column(Money, default=0)
    receipt_footer: Mapped[str] = mapped_column(String(255), default="Thank you for dining with us!")


# --------------------------------------------------------------------------- menu

class MenuCategory(TimestampMixin, Base):
    __tablename__ = "menu_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    items: Mapped[list["MenuItem"]] = relationship(back_populates="category")


class MenuItem(TimestampMixin, Base):
    __tablename__ = "menu_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("menu_categories.id"))
    name: Mapped[str] = mapped_column(String(120))
    code: Mapped[str | None] = mapped_column(String(30), unique=True, nullable=True)
    description: Mapped[str] = mapped_column(Text, default="")
    price: Mapped[Decimal] = mapped_column(Money)
    cost_price: Mapped[Decimal] = mapped_column(Money, default=0)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # which order types may sell this item
    available_dine_in: Mapped[bool] = mapped_column(Boolean, default=True)
    available_takeaway: Mapped[bool] = mapped_column(Boolean, default=True)
    available_delivery: Mapped[bool] = mapped_column(Boolean, default=True)

    category: Mapped[MenuCategory] = relationship(back_populates="items")


# --------------------------------------------------------------------------- tables

class DiningArea(TimestampMixin, Base):
    __tablename__ = "dining_areas"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)

    tables: Mapped[list["DiningTable"]] = relationship(back_populates="area")


class DiningTable(TimestampMixin, Base):
    __tablename__ = "dining_tables"

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int | None] = mapped_column(ForeignKey("dining_areas.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(40), unique=True)
    capacity: Mapped[int] = mapped_column(Integer, default=4)
    # available | occupied | reserved | cleaning
    status: Mapped[str] = mapped_column(String(20), default="available")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    area: Mapped[DiningArea | None] = relationship(back_populates="tables")


# --------------------------------------------------------------------------- customers / orders

class Customer(TimestampMixin, Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(120), default="")
    address: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")


class Order(TimestampMixin, Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_no: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    # dine_in | takeaway | delivery
    order_type: Mapped[str] = mapped_column(String(20), index=True)
    # open | completed | cancelled
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)
    table_id: Mapped[int | None] = mapped_column(ForeignKey("dining_tables.id"), nullable=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True)
    customer_name: Mapped[str] = mapped_column(String(120), default="")
    customer_phone: Mapped[str] = mapped_column(String(40), default="")
    delivery_address: Mapped[str] = mapped_column(Text, default="")
    guests: Mapped[int] = mapped_column(Integer, default=1)
    notes: Mapped[str] = mapped_column(Text, default="")
    # pending | dispatched | delivered (delivery orders only)
    delivery_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    rider_name: Mapped[str] = mapped_column(String(80), default="")

    subtotal: Mapped[Decimal] = mapped_column(Money, default=0)
    discount_type: Mapped[str] = mapped_column(String(10), default="amount")  # amount | percent
    discount_value: Mapped[Decimal] = mapped_column(Money, default=0)
    discount_amount: Mapped[Decimal] = mapped_column(Money, default=0)
    service_charge: Mapped[Decimal] = mapped_column(Money, default=0)
    tax_amount: Mapped[Decimal] = mapped_column(Money, default=0)
    delivery_fee: Mapped[Decimal] = mapped_column(Money, default=0)
    total: Mapped[Decimal] = mapped_column(Money, default=0)
    paid_amount: Mapped[Decimal] = mapped_column(Money, default=0)

    cancel_reason: Mapped[str] = mapped_column(String(255), default="")
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    kot_counter: Mapped[int] = mapped_column(Integer, default=0)

    table: Mapped[DiningTable | None] = relationship()
    customer: Mapped[Customer | None] = relationship()
    created_by: Mapped[User | None] = relationship()
    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="OrderItem.id"
    )
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="Payment.id"
    )


class OrderItem(TimestampMixin, Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    menu_item_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id"))
    name: Mapped[str] = mapped_column(String(120))
    category_name: Mapped[str] = mapped_column(String(80), default="")
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal] = mapped_column(Money)
    line_total: Mapped[Decimal] = mapped_column(Money)
    notes: Mapped[str] = mapped_column(String(255), default="")
    # new (not yet sent) | sent | preparing | ready | served | cancelled
    status: Mapped[str] = mapped_column(String(20), default="new")
    kot_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str] = mapped_column(String(255), default="")

    order: Mapped[Order] = relationship(back_populates="items")
    menu_item: Mapped[MenuItem] = relationship()


class Payment(TimestampMixin, Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    # cash | card | online
    method: Mapped[str] = mapped_column(String(20))
    amount: Mapped[Decimal] = mapped_column(Money)
    reference: Mapped[str] = mapped_column(String(80), default="")
    received_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    order: Mapped[Order] = relationship(back_populates="payments")


# --------------------------------------------------------------------------- inventory

class Unit(Base):
    __tablename__ = "units"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(30), unique=True)  # e.g. Kilogram
    abbreviation: Mapped[str] = mapped_column(String(10))  # e.g. kg


class ItemCategory(Base):
    __tablename__ = "item_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)


class InventoryItem(TimestampMixin, Base):
    """Raw material / ingredient kept in store and issued to kitchen."""

    __tablename__ = "inventory_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    sku: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("item_categories.id"), nullable=True)
    unit_id: Mapped[int] = mapped_column(ForeignKey("units.id"))
    reorder_level: Mapped[Decimal] = mapped_column(Qty, default=0)
    store_qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    kitchen_qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    avg_cost: Mapped[Decimal] = mapped_column(Cost, default=0)
    last_purchase_price: Mapped[Decimal] = mapped_column(Cost, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    category: Mapped[ItemCategory | None] = relationship()
    unit: Mapped[Unit] = relationship()


class Supplier(TimestampMixin, Base):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    contact_person: Mapped[str] = mapped_column(String(120), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    email: Mapped[str] = mapped_column(String(120), default="")
    address: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Purchase(TimestampMixin, Base):
    """Goods received note: ingredients purchased into the store."""

    __tablename__ = "purchases"

    id: Mapped[int] = mapped_column(primary_key=True)
    purchase_no: Mapped[str] = mapped_column(String(30), unique=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"))
    purchase_date: Mapped[date] = mapped_column(Date, index=True)
    invoice_no: Mapped[str] = mapped_column(String(60), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    total: Mapped[Decimal] = mapped_column(Money, default=0)
    paid_amount: Mapped[Decimal] = mapped_column(Money, default=0)
    # received | cancelled
    status: Mapped[str] = mapped_column(String(20), default="received")
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    supplier: Mapped[Supplier] = relationship()
    created_by: Mapped[User | None] = relationship()
    items: Mapped[list["PurchaseItem"]] = relationship(
        back_populates="purchase", cascade="all, delete-orphan", order_by="PurchaseItem.id"
    )


class PurchaseItem(Base):
    __tablename__ = "purchase_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    purchase_id: Mapped[int] = mapped_column(ForeignKey("purchases.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("inventory_items.id"))
    quantity: Mapped[Decimal] = mapped_column(Qty)
    unit_cost: Mapped[Decimal] = mapped_column(Cost)
    line_total: Mapped[Decimal] = mapped_column(Money)

    purchase: Mapped[Purchase] = relationship(back_populates="items")
    item: Mapped[InventoryItem] = relationship()


class StockIssue(TimestampMixin, Base):
    """Store-to-kitchen issue."""

    __tablename__ = "stock_issues"

    id: Mapped[int] = mapped_column(primary_key=True)
    issue_no: Mapped[str] = mapped_column(String(30), unique=True)
    issue_date: Mapped[date] = mapped_column(Date, index=True)
    issued_to: Mapped[str] = mapped_column(String(120), default="Kitchen")
    notes: Mapped[str] = mapped_column(Text, default="")
    total_value: Mapped[Decimal] = mapped_column(Money, default=0)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    created_by: Mapped[User | None] = relationship()
    items: Mapped[list["StockIssueItem"]] = relationship(
        back_populates="issue", cascade="all, delete-orphan", order_by="StockIssueItem.id"
    )


class StockIssueItem(Base):
    __tablename__ = "stock_issue_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("stock_issues.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("inventory_items.id"))
    quantity: Mapped[Decimal] = mapped_column(Qty)
    unit_cost: Mapped[Decimal] = mapped_column(Cost)
    line_total: Mapped[Decimal] = mapped_column(Money)

    issue: Mapped[StockIssue] = relationship(back_populates="items")
    item: Mapped[InventoryItem] = relationship()


class StockAdjustment(TimestampMixin, Base):
    """Manual stock correction: wastage, damage, kitchen consumption, physical count."""

    __tablename__ = "stock_adjustments"

    id: Mapped[int] = mapped_column(primary_key=True)
    adjustment_date: Mapped[date] = mapped_column(Date, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("inventory_items.id"))
    location: Mapped[str] = mapped_column(String(20))  # store | kitchen
    # wastage | damage | consumption | count_correction | opening
    reason: Mapped[str] = mapped_column(String(30))
    quantity: Mapped[Decimal] = mapped_column(Qty)  # signed: + adds, - removes
    unit_cost: Mapped[Decimal] = mapped_column(Cost, default=0)
    value: Mapped[Decimal] = mapped_column(Money, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    item: Mapped[InventoryItem] = relationship()
    created_by: Mapped[User | None] = relationship()


class StockMovement(TimestampMixin, Base):
    """Immutable stock ledger. One row per location change."""

    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("inventory_items.id"), index=True)
    location: Mapped[str] = mapped_column(String(20))  # store | kitchen
    movement_type: Mapped[str] = mapped_column(String(30))  # purchase | issue_out | issue_in | adjustment | purchase_cancel
    quantity: Mapped[Decimal] = mapped_column(Qty)  # signed
    unit_cost: Mapped[Decimal] = mapped_column(Cost, default=0)
    balance_after: Mapped[Decimal] = mapped_column(Qty)
    ref_type: Mapped[str] = mapped_column(String(30), default="")
    ref_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ref_no: Mapped[str] = mapped_column(String(40), default="")
    movement_date: Mapped[date] = mapped_column(Date, index=True)
    notes: Mapped[str] = mapped_column(String(255), default="")
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    item: Mapped[InventoryItem] = relationship()


# --------------------------------------------------------------------------- expenses

class ExpenseCategory(Base):
    __tablename__ = "expense_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)


class Expense(TimestampMixin, Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    expense_date: Mapped[date] = mapped_column(Date, index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("expense_categories.id"))
    amount: Mapped[Decimal] = mapped_column(Money)
    paid_to: Mapped[str] = mapped_column(String(120), default="")
    payment_method: Mapped[str] = mapped_column(String(20), default="cash")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    category: Mapped[ExpenseCategory] = relationship()
