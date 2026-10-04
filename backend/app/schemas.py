from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer

# Decimals are stored exactly in the DB but serialised as JSON numbers for the UI.
Num = Annotated[Decimal, PlainSerializer(lambda v: float(v), return_type=float, when_used="json")]
PosNum = Annotated[Decimal, Field(gt=0), PlainSerializer(lambda v: float(v), return_type=float, when_used="json")]
NonNegNum = Annotated[Decimal, Field(ge=0), PlainSerializer(lambda v: float(v), return_type=float, when_used="json")]

OrderType = Literal["dine_in", "takeaway", "delivery"]
Role = Literal["admin", "manager", "cashier", "waiter", "kitchen", "storekeeper"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------- auth / users

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(ORM):
    id: int
    username: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    full_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=6)
    role: Role = "cashier"
    is_active: bool = True


class UserUpdate(BaseModel):
    full_name: str | None = None
    password: str | None = Field(default=None, min_length=6)
    role: Role | None = None
    is_active: bool | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


# --------------------------------------------------------------------------- settings

class SettingsBase(BaseModel):
    restaurant_name: str = "My Restaurant"
    address: str = ""
    phone: str = ""
    currency: str = "Rs"
    tax_rate: NonNegNum = Decimal(0)
    service_charge_rate: NonNegNum = Decimal(0)
    default_delivery_fee: NonNegNum = Decimal(0)
    receipt_footer: str = ""


class SettingsOut(SettingsBase, ORM):
    pass


# --------------------------------------------------------------------------- menu

class MenuCategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    sort_order: int = 0
    is_active: bool = True


class MenuCategoryOut(MenuCategoryIn, ORM):
    id: int
    item_count: int = 0


class MenuItemIn(BaseModel):
    category_id: int
    name: str = Field(min_length=1, max_length=120)
    code: str | None = None
    description: str = ""
    price: NonNegNum
    cost_price: NonNegNum = Decimal(0)
    is_available: bool = True
    is_active: bool = True
    available_dine_in: bool = True
    available_takeaway: bool = True
    available_delivery: bool = True


class MenuItemOut(MenuItemIn, ORM):
    id: int
    category_name: str = ""


# --------------------------------------------------------------------------- tables

class AreaIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class AreaOut(AreaIn, ORM):
    id: int


class TableIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    area_id: int | None = None
    capacity: int = Field(default=4, ge=1)
    is_active: bool = True


class TableStatusIn(BaseModel):
    status: Literal["available", "reserved", "cleaning"]


class TableOut(ORM):
    id: int
    name: str
    area_id: int | None
    area_name: str | None = None
    capacity: int
    status: str
    is_active: bool
    open_order_id: int | None = None
    open_order_no: str | None = None
    open_order_total: Num | None = None
    open_since: datetime | None = None


# --------------------------------------------------------------------------- customers

class CustomerIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=3, max_length=40)
    email: str = ""
    address: str = ""
    notes: str = ""


class CustomerOut(CustomerIn, ORM):
    id: int
    created_at: datetime
    order_count: int = 0
    total_spent: Num = Decimal(0)


# --------------------------------------------------------------------------- orders

class OrderItemIn(BaseModel):
    menu_item_id: int
    quantity: int = Field(ge=1)
    notes: str = ""


class OrderCreate(BaseModel):
    order_type: OrderType
    table_id: int | None = None
    customer_id: int | None = None
    customer_name: str = ""
    customer_phone: str = ""
    delivery_address: str = ""
    guests: int = Field(default=1, ge=1)
    notes: str = ""
    items: list[OrderItemIn] = []
    send_to_kitchen: bool = False


class OrderUpdate(BaseModel):
    table_id: int | None = None
    customer_id: int | None = None
    customer_name: str | None = None
    customer_phone: str | None = None
    delivery_address: str | None = None
    guests: int | None = Field(default=None, ge=1)
    notes: str | None = None
    rider_name: str | None = None
    delivery_fee: NonNegNum | None = None


class OrderItemsAdd(BaseModel):
    items: list[OrderItemIn] = Field(min_length=1)
    send_to_kitchen: bool = False


class OrderItemUpdate(BaseModel):
    quantity: int | None = Field(default=None, ge=1)
    notes: str | None = None


class CancelIn(BaseModel):
    reason: str = Field(min_length=1, max_length=255)


class DiscountIn(BaseModel):
    discount_type: Literal["amount", "percent"]
    discount_value: NonNegNum


class PaymentIn(BaseModel):
    method: Literal["cash", "card", "online"]
    amount: PosNum
    reference: str = ""


class PayAndCloseIn(BaseModel):
    payments: list[PaymentIn] = []


class TransferIn(BaseModel):
    table_id: int


class KitchenStatusIn(BaseModel):
    status: Literal["preparing", "ready", "served"]


class DeliveryStatusIn(BaseModel):
    delivery_status: Literal["pending", "dispatched", "delivered"]
    rider_name: str | None = None


class OrderItemOut(ORM):
    id: int
    menu_item_id: int
    name: str
    category_name: str
    quantity: int
    unit_price: Num
    line_total: Num
    notes: str
    status: str
    kot_no: int | None
    sent_at: datetime | None
    cancel_reason: str
    created_at: datetime


class PaymentOut(ORM):
    id: int
    method: str
    amount: Num
    reference: str
    created_at: datetime


class OrderOut(ORM):
    id: int
    order_no: str
    order_type: str
    status: str
    table_id: int | None
    table_name: str | None = None
    customer_id: int | None
    customer_name: str
    customer_phone: str
    delivery_address: str
    guests: int
    notes: str
    delivery_status: str | None
    rider_name: str
    subtotal: Num
    discount_type: str
    discount_value: Num
    discount_amount: Num
    service_charge: Num
    tax_amount: Num
    delivery_fee: Num
    total: Num
    paid_amount: Num
    balance_due: Num = Decimal(0)
    cancel_reason: str
    created_by_name: str | None = None
    created_at: datetime
    completed_at: datetime | None
    items: list[OrderItemOut] = []
    payments: list[PaymentOut] = []


class OrderListOut(ORM):
    id: int
    order_no: str
    order_type: str
    status: str
    table_name: str | None = None
    customer_name: str
    customer_phone: str
    delivery_address: str
    delivery_status: str | None
    rider_name: str
    total: Num
    paid_amount: Num
    item_count: int = 0
    created_by_name: str | None = None
    created_at: datetime
    completed_at: datetime | None


class KitchenTicket(BaseModel):
    order_id: int
    order_no: str
    order_type: str
    table_name: str | None
    customer_name: str
    kot_no: int
    sent_at: datetime | None
    notes: str
    items: list[OrderItemOut]


# --------------------------------------------------------------------------- inventory

class UnitIn(BaseModel):
    name: str = Field(min_length=1, max_length=30)
    abbreviation: str = Field(min_length=1, max_length=10)


class UnitOut(UnitIn, ORM):
    id: int


class NamedIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class NamedOut(NamedIn, ORM):
    id: int


class InventoryItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    sku: str | None = None
    category_id: int | None = None
    unit_id: int
    reorder_level: NonNegNum = Decimal(0)
    is_active: bool = True


class InventoryItemOut(ORM):
    id: int
    name: str
    sku: str | None
    category_id: int | None
    category_name: str | None = None
    unit_id: int
    unit_name: str = ""
    reorder_level: Num
    store_qty: Num
    kitchen_qty: Num
    avg_cost: Num
    last_purchase_price: Num
    stock_value: Num = Decimal(0)
    is_low: bool = False
    is_active: bool


class SupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    contact_person: str = ""
    phone: str = ""
    email: str = ""
    address: str = ""
    is_active: bool = True


class SupplierOut(SupplierIn, ORM):
    id: int
    total_purchases: Num = Decimal(0)
    balance_due: Num = Decimal(0)


class PurchaseLineIn(BaseModel):
    item_id: int
    quantity: PosNum
    unit_cost: NonNegNum


class PurchaseIn(BaseModel):
    supplier_id: int
    purchase_date: date
    invoice_no: str = ""
    notes: str = ""
    paid_amount: NonNegNum = Decimal(0)
    items: list[PurchaseLineIn] = Field(min_length=1)


class PurchasePaymentIn(BaseModel):
    paid_amount: NonNegNum


class LineOut(ORM):
    id: int
    item_id: int
    item_name: str = ""
    unit_name: str = ""
    quantity: Num
    unit_cost: Num
    line_total: Num


class PurchaseOut(ORM):
    id: int
    purchase_no: str
    supplier_id: int
    supplier_name: str = ""
    purchase_date: date
    invoice_no: str
    notes: str
    total: Num
    paid_amount: Num
    status: str
    created_by_name: str | None = None
    created_at: datetime
    items: list[LineOut] = []


class IssueLineIn(BaseModel):
    item_id: int
    quantity: PosNum


class IssueIn(BaseModel):
    issue_date: date
    issued_to: str = "Kitchen"
    notes: str = ""
    items: list[IssueLineIn] = Field(min_length=1)


class IssueOut(ORM):
    id: int
    issue_no: str
    issue_date: date
    issued_to: str
    notes: str
    total_value: Num
    created_by_name: str | None = None
    created_at: datetime
    items: list[LineOut] = []


class AdjustmentIn(BaseModel):
    adjustment_date: date
    item_id: int
    location: Literal["store", "kitchen"]
    reason: Literal["wastage", "damage", "consumption", "count_correction", "opening"]
    quantity: Num  # signed
    unit_cost: NonNegNum | None = None
    notes: str = ""


class AdjustmentOut(ORM):
    id: int
    adjustment_date: date
    item_id: int
    item_name: str = ""
    unit_name: str = ""
    location: str
    reason: str
    quantity: Num
    unit_cost: Num
    value: Num
    notes: str
    created_by_name: str | None = None
    created_at: datetime


class MovementOut(ORM):
    id: int
    item_id: int
    item_name: str = ""
    unit_name: str = ""
    location: str
    movement_type: str
    quantity: Num
    unit_cost: Num
    balance_after: Num
    ref_type: str
    ref_id: int | None
    ref_no: str
    movement_date: date
    notes: str
    created_at: datetime


# --------------------------------------------------------------------------- expenses

class ExpenseIn(BaseModel):
    expense_date: date
    category_id: int
    amount: PosNum
    paid_to: str = ""
    payment_method: Literal["cash", "card", "online", "bank"] = "cash"
    notes: str = ""


class ExpenseOut(ExpenseIn, ORM):
    id: int
    category_name: str = ""
    created_at: datetime


Token.model_rebuild()
