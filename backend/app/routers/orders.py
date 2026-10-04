from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from ..database import get_db
from ..models import Customer, DiningTable, MenuItem, Order, OrderItem, Payment, User
from ..schemas import (
    CancelIn,
    DeliveryStatusIn,
    DiscountIn,
    KitchenStatusIn,
    KitchenTicket,
    OrderCreate,
    OrderItemIn,
    OrderItemOut,
    OrderItemsAdd,
    OrderItemUpdate,
    OrderListOut,
    OrderOut,
    OrderUpdate,
    PayAndCloseIn,
    PaymentIn,
    TransferIn,
    VoidIn,
)
from ..security import (
    CASHIERS,
    FRONT_OF_HOUSE,
    KITCHEN,
    MANAGERS,
    get_current_user,
    require_roles,
)
from ..services import balance_due, recalc_order
from ..utils import day_range, get_app_settings, get_or_404, q2

router = APIRouter(prefix="/api", tags=["orders"])


def now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- helpers

def _load_order(db: Session, order_id: int, lock: bool = False) -> Order:
    stmt = (
        select(Order)
        .where(Order.id == order_id)
        .options(
            selectinload(Order.items),
            selectinload(Order.payments),
            joinedload(Order.table),
            joinedload(Order.created_by),
        )
    )
    if lock:
        stmt = stmt.with_for_update(of=Order)
    order = db.scalars(stmt).unique().first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


def _editable(order: Order) -> None:
    if order.status != "open":
        raise HTTPException(status_code=400, detail=f"Order is {order.status} and can no longer be modified")


def order_out(order: Order) -> OrderOut:
    out = OrderOut.model_validate(order)
    out.table_name = order.table.name if order.table else None
    out.created_by_name = order.created_by.full_name if order.created_by else None
    out.balance_due = balance_due(order)
    return out


def _check_table_free(db: Session, table_id: int, exclude_order_id: int | None = None) -> DiningTable:
    table = get_or_404(db, DiningTable, table_id, "Table")
    if not table.is_active:
        raise HTTPException(status_code=400, detail="Table is inactive")
    stmt = select(Order.order_no).where(Order.table_id == table_id, Order.status == "open")
    if exclude_order_id:
        stmt = stmt.where(Order.id != exclude_order_id)
    existing = db.scalar(stmt)
    if existing:
        raise HTTPException(status_code=400, detail=f"Table {table.name} already has an open order ({existing})")
    return table


def _add_lines(db: Session, order: Order, lines: list[OrderItemIn]) -> None:
    flag = {"dine_in": "available_dine_in", "takeaway": "available_takeaway", "delivery": "available_delivery"}[
        order.order_type
    ]
    for line in lines:
        mi = db.scalars(
            select(MenuItem).where(MenuItem.id == line.menu_item_id).options(joinedload(MenuItem.category))
        ).first()
        if not mi or not mi.is_active:
            raise HTTPException(status_code=400, detail=f"Menu item #{line.menu_item_id} not found")
        if not mi.is_available:
            raise HTTPException(status_code=400, detail=f"'{mi.name}' is currently unavailable")
        if not getattr(mi, flag):
            raise HTTPException(
                status_code=400, detail=f"'{mi.name}' is not offered for {order.order_type.replace('_', ' ')}"
            )
        notes = line.notes.strip()
        # merge into an identical, not-yet-sent line
        existing = next(
            (
                i
                for i in order.items
                if i.menu_item_id == mi.id and i.status == "new" and i.notes == notes and i.unit_price == mi.price
            ),
            None,
        )
        if existing:
            existing.quantity += line.quantity
            existing.line_total = q2(existing.unit_price * existing.quantity)
        else:
            order.items.append(
                OrderItem(
                    menu_item_id=mi.id,
                    name=mi.name,
                    category_name=mi.category.name if mi.category else "",
                    quantity=line.quantity,
                    unit_price=mi.price,
                    line_total=q2(mi.price * line.quantity),
                    notes=notes,
                    status="new",
                )
            )


def _send_to_kitchen(order: Order) -> int | None:
    pending = [i for i in order.items if i.status == "new"]
    if not pending:
        return None
    order.kot_counter = (order.kot_counter or 0) + 1
    ts = now()
    for i in pending:
        i.status = "sent"
        i.kot_no = order.kot_counter
        i.sent_at = ts
    return order.kot_counter


def _release_table(db: Session, order: Order) -> None:
    if order.table_id:
        table = db.get(DiningTable, order.table_id)
        if table:
            others = db.scalar(
                select(func.count(Order.id)).where(
                    Order.table_id == table.id, Order.status == "open", Order.id != order.id
                )
            )
            if not others:
                table.status = "available"


def _upsert_customer(db: Session, name: str, phone: str, address: str) -> Customer | None:
    phone = phone.strip()
    if not phone:
        return None
    c = db.scalar(select(Customer).where(Customer.phone == phone))
    if c is None:
        c = Customer(name=name.strip() or phone, phone=phone, address=address.strip())
        db.add(c)
        db.flush()
    else:
        if address.strip() and not c.address:
            c.address = address.strip()
        if name.strip() and c.name == c.phone:
            c.name = name.strip()
    return c


def _finish(db: Session, order: Order) -> OrderOut:
    recalc_order(order, get_app_settings(db))
    db.commit()
    db.expire_all()
    return order_out(_load_order(db, order.id))


# --------------------------------------------------------------------------- order CRUD

@router.get("/orders", response_model=list[OrderListOut])
def list_orders(
    status: str | None = None,
    order_type: str | None = None,
    delivery_status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    limit: int = 200,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = (
        select(Order)
        .options(joinedload(Order.table), joinedload(Order.created_by), selectinload(Order.items))
        .order_by(Order.id.desc())
        .limit(min(limit, 1000))
    )
    if status:
        stmt = stmt.where(Order.status.in_(status.split(",")))
    if order_type:
        stmt = stmt.where(Order.order_type == order_type)
    if delivery_status:
        stmt = stmt.where(Order.delivery_status.in_(delivery_status.split(",")))
    if date_from or date_to:
        start, end, *_ = day_range(date_from, date_to)
        stmt = stmt.where(Order.created_at >= start, Order.created_at < end)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(Order.order_no.ilike(like), Order.customer_name.ilike(like), Order.customer_phone.ilike(like))
        )
    result = []
    for o in db.scalars(stmt).unique():
        out = OrderListOut.model_validate(o)
        out.table_name = o.table.name if o.table else None
        out.created_by_name = o.created_by.full_name if o.created_by else None
        out.item_count = sum(i.quantity for i in o.items if i.status != "cancelled")
        result.append(out)
    return result


@router.get("/orders/{order_id}", response_model=OrderOut)
def get_order(order_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return order_out(_load_order(db, order_id))


@router.post("/orders", response_model=OrderOut, status_code=201)
def create_order(data: OrderCreate, db: Session = Depends(get_db), user: User = Depends(require_roles(*FRONT_OF_HOUSE))):
    settings = get_app_settings(db)
    order = Order(
        order_no="TMP",
        order_type=data.order_type,
        status="open",
        guests=data.guests,
        notes=data.notes,
        customer_name=data.customer_name.strip(),
        customer_phone=data.customer_phone.strip(),
        delivery_address=data.delivery_address.strip(),
        created_by_id=user.id,
        discount_type="amount",
        discount_value=0,
        kot_counter=0,
    )
    if data.order_type == "dine_in":
        if not data.table_id:
            raise HTTPException(status_code=400, detail="Select a table for dine-in orders")
        table = _check_table_free(db, data.table_id)
        order.table_id = table.id
        table.status = "occupied"
    if data.customer_id:
        c = get_or_404(db, Customer, data.customer_id, "Customer")
        order.customer_id = c.id
        order.customer_name = order.customer_name or c.name
        order.customer_phone = order.customer_phone or c.phone
        if data.order_type == "delivery":
            order.delivery_address = order.delivery_address or c.address
    elif order.customer_phone:
        c = _upsert_customer(db, order.customer_name, order.customer_phone, order.delivery_address)
        order.customer_id = c.id if c else None
    if data.order_type == "delivery":
        if not order.customer_phone or not order.delivery_address:
            raise HTTPException(status_code=400, detail="Delivery orders need a customer phone and address")
        order.delivery_status = "pending"
        order.delivery_fee = settings.default_delivery_fee

    db.add(order)
    db.flush()
    order.order_no = f"ORD-{order.id:06d}"
    _add_lines(db, order, data.items)
    if data.send_to_kitchen:
        _send_to_kitchen(order)
    return _finish(db, order)


@router.put("/orders/{order_id}", response_model=OrderOut)
def update_order(
    order_id: int, data: OrderUpdate, db: Session = Depends(get_db), _: User = Depends(require_roles(*FRONT_OF_HOUSE))
):
    order = _load_order(db, order_id, lock=True)
    _editable(order)
    values = data.model_dump(exclude_unset=True)
    if "table_id" in values and values["table_id"] != order.table_id:
        raise HTTPException(status_code=400, detail="Use the transfer action to change tables")
    for key in ("customer_name", "customer_phone", "delivery_address", "notes", "rider_name"):
        if values.get(key) is not None:
            setattr(order, key, values[key].strip())
    if values.get("guests"):
        order.guests = values["guests"]
    if values.get("customer_id"):
        c = get_or_404(db, Customer, values["customer_id"], "Customer")
        order.customer_id = c.id
    elif values.get("customer_phone"):
        c = _upsert_customer(db, order.customer_name, order.customer_phone, order.delivery_address)
        order.customer_id = c.id if c else order.customer_id
    if values.get("delivery_fee") is not None and order.order_type == "delivery":
        order.delivery_fee = values["delivery_fee"]
    if order.order_type == "delivery" and (not order.customer_phone or not order.delivery_address):
        raise HTTPException(status_code=400, detail="Delivery orders need a customer phone and address")
    return _finish(db, order)


# --------------------------------------------------------------------------- items

@router.post("/orders/{order_id}/items", response_model=OrderOut)
def add_items(
    order_id: int, data: OrderItemsAdd, db: Session = Depends(get_db), _: User = Depends(require_roles(*FRONT_OF_HOUSE))
):
    order = _load_order(db, order_id, lock=True)
    _editable(order)
    _add_lines(db, order, data.items)
    if data.send_to_kitchen:
        _send_to_kitchen(order)
    return _finish(db, order)


def _get_line(order: Order, item_id: int) -> OrderItem:
    line = next((i for i in order.items if i.id == item_id), None)
    if not line:
        raise HTTPException(status_code=404, detail="Order item not found")
    return line


@router.patch("/orders/{order_id}/items/{item_id}", response_model=OrderOut)
def update_item(
    order_id: int,
    item_id: int,
    data: OrderItemUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*FRONT_OF_HOUSE)),
):
    order = _load_order(db, order_id, lock=True)
    _editable(order)
    line = _get_line(order, item_id)
    if line.status != "new":
        raise HTTPException(
            status_code=400, detail="Item was already sent to the kitchen. Cancel it (void) and add a new one instead."
        )
    if data.quantity is not None:
        line.quantity = data.quantity
        line.line_total = q2(line.unit_price * line.quantity)
    if data.notes is not None:
        line.notes = data.notes.strip()
    return _finish(db, order)


@router.delete("/orders/{order_id}/items/{item_id}", response_model=OrderOut)
def remove_item(
    order_id: int, item_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*FRONT_OF_HOUSE))
):
    order = _load_order(db, order_id, lock=True)
    _editable(order)
    line = _get_line(order, item_id)
    if line.status != "new":
        raise HTTPException(status_code=400, detail="Item was already sent to the kitchen. Void it with a reason.")
    order.items.remove(line)
    return _finish(db, order)


@router.post("/orders/{order_id}/items/{item_id}/void", response_model=OrderOut)
def void_item(
    order_id: int,
    item_id: int,
    data: VoidIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*CASHIERS)),
):
    order = _load_order(db, order_id, lock=True)
    _editable(order)
    line = _get_line(order, item_id)
    if line.status == "cancelled":
        raise HTTPException(status_code=400, detail="Item is already cancelled")
    qty = data.quantity or line.quantity
    if qty > line.quantity:
        raise HTTPException(status_code=400, detail=f"Only {line.quantity} on this line")
    if qty < line.quantity:
        # split: keep the remaining quantity active and record the voided part as its own line
        line.quantity -= qty
        line.line_total = q2(line.unit_price * line.quantity)
        order.items.append(
            OrderItem(
                menu_item_id=line.menu_item_id, name=line.name, category_name=line.category_name, quantity=qty,
                unit_price=line.unit_price, line_total=q2(line.unit_price * qty), notes=line.notes,
                status="cancelled", kot_no=line.kot_no, sent_at=line.sent_at, cancel_reason=data.reason,
            )
        )
    else:
        line.status = "cancelled"
        line.cancel_reason = data.reason
    return _finish(db, order)


# --------------------------------------------------------------------------- actions

@router.post("/orders/{order_id}/send-to-kitchen", response_model=OrderOut)
def send_to_kitchen(order_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*FRONT_OF_HOUSE))):
    order = _load_order(db, order_id, lock=True)
    _editable(order)
    if _send_to_kitchen(order) is None:
        raise HTTPException(status_code=400, detail="No new items to send")
    return _finish(db, order)


@router.post("/orders/{order_id}/discount", response_model=OrderOut)
def apply_discount(
    order_id: int, data: DiscountIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*CASHIERS))
):
    order = _load_order(db, order_id, lock=True)
    _editable(order)
    if data.discount_type == "percent" and data.discount_value > 100:
        raise HTTPException(status_code=400, detail="Percent discount cannot exceed 100")
    order.discount_type = data.discount_type
    order.discount_value = data.discount_value
    return _finish(db, order)


@router.post("/orders/{order_id}/transfer", response_model=OrderOut)
def transfer_table(
    order_id: int, data: TransferIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*FRONT_OF_HOUSE))
):
    order = _load_order(db, order_id, lock=True)
    _editable(order)
    if order.order_type != "dine_in":
        raise HTTPException(status_code=400, detail="Only dine-in orders can be transferred between tables")
    if data.table_id == order.table_id:
        raise HTTPException(status_code=400, detail="Order is already on this table")
    target = _check_table_free(db, data.table_id, exclude_order_id=order.id)
    _release_table(db, order)
    order.table_id = target.id
    target.status = "occupied"
    db.flush()
    db.expire(order, ["table"])
    return _finish(db, order)


@router.post("/orders/{order_id}/payments", response_model=OrderOut)
def add_payment(
    order_id: int, data: PaymentIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*CASHIERS))
):
    order = _load_order(db, order_id, lock=True)
    _editable(order)
    recalc_order(order, get_app_settings(db))
    due = balance_due(order)
    if due <= 0:
        raise HTTPException(status_code=400, detail="Order is already fully paid")
    if data.amount > due:
        raise HTTPException(status_code=400, detail=f"Payment exceeds balance due ({due})")
    order.payments.append(
        Payment(method=data.method, amount=q2(data.amount), reference=data.reference, received_by_id=user.id)
    )
    return _finish(db, order)


@router.delete("/orders/{order_id}/payments/{payment_id}", response_model=OrderOut)
def remove_payment(
    order_id: int, payment_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*CASHIERS))
):
    order = _load_order(db, order_id, lock=True)
    _editable(order)
    p = next((p for p in order.payments if p.id == payment_id), None)
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    order.payments.remove(p)
    return _finish(db, order)


def _complete(db: Session, order: Order) -> None:
    recalc_order(order, get_app_settings(db))
    if not any(i.status != "cancelled" for i in order.items):
        raise HTTPException(status_code=400, detail="Order has no items. Cancel it instead.")
    if balance_due(order) > 0:
        raise HTTPException(status_code=400, detail=f"Balance due: {balance_due(order)}. Collect payment first.")
    _send_to_kitchen(order)  # quick-service: anything not yet fired goes to the kitchen now
    order.status = "completed"
    order.completed_at = now()
    _release_table(db, order)


@router.post("/orders/{order_id}/complete", response_model=OrderOut)
def complete_order(
    order_id: int, data: PayAndCloseIn | None = None, db: Session = Depends(get_db), user: User = Depends(require_roles(*CASHIERS))
):
    """Optionally take payments, then close the order. Fails if anything is still due."""
    order = _load_order(db, order_id, lock=True)
    _editable(order)
    if data and data.payments:
        recalc_order(order, get_app_settings(db))
        total_new = sum((p.amount for p in data.payments), Decimal(0))
        if total_new > balance_due(order):
            raise HTTPException(status_code=400, detail=f"Payments exceed balance due ({balance_due(order)})")
        for p in data.payments:
            order.payments.append(
                Payment(method=p.method, amount=q2(p.amount), reference=p.reference, received_by_id=user.id)
            )
    _complete(db, order)
    return _finish(db, order)


@router.post("/orders/{order_id}/cancel", response_model=OrderOut)
def cancel_order(order_id: int, data: CancelIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*CASHIERS))):
    order = _load_order(db, order_id, lock=True)
    _editable(order)
    if order.payments:
        raise HTTPException(status_code=400, detail="Order has payments. Remove/refund them before cancelling.")
    order.status = "cancelled"
    order.cancel_reason = data.reason
    order.completed_at = now()
    _release_table(db, order)
    return _finish(db, order)


@router.post("/orders/{order_id}/reopen", response_model=OrderOut)
def reopen_order(order_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGERS))):
    order = _load_order(db, order_id, lock=True)
    if order.status != "completed":
        raise HTTPException(status_code=400, detail="Only completed orders can be reopened")
    if order.table_id:
        table = _check_table_free(db, order.table_id, exclude_order_id=order.id)
        table.status = "occupied"
    order.status = "open"
    order.completed_at = None
    return _finish(db, order)


@router.post("/orders/{order_id}/delivery-status", response_model=OrderOut)
def set_delivery_status(
    order_id: int, data: DeliveryStatusIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*CASHIERS))
):
    order = _load_order(db, order_id, lock=True)
    if order.order_type != "delivery":
        raise HTTPException(status_code=400, detail="Not a delivery order")
    if order.status == "cancelled":
        raise HTTPException(status_code=400, detail="Order is cancelled")
    order.delivery_status = data.delivery_status
    if data.rider_name is not None:
        order.rider_name = data.rider_name.strip()
    if data.delivery_status == "delivered":
        for i in order.items:
            if i.status in ("sent", "preparing", "ready"):
                i.status = "served"
    return _finish(db, order)


# --------------------------------------------------------------------------- kitchen display

@router.get("/kitchen/tickets", response_model=list[KitchenTicket])
def kitchen_tickets(include_ready: bool = True, db: Session = Depends(get_db), _: User = Depends(require_roles(*KITCHEN))):
    states = ["sent", "preparing"] + (["ready"] if include_ready else [])
    rows = db.scalars(
        select(OrderItem)
        .join(OrderItem.order)
        .where(OrderItem.status.in_(states), Order.status != "cancelled")
        .options(joinedload(OrderItem.order).joinedload(Order.table))
        .order_by(OrderItem.sent_at, OrderItem.id)
    ).all()
    tickets: dict[tuple[int, int], KitchenTicket] = {}
    for item in rows:
        o = item.order
        key = (o.id, item.kot_no or 0)
        if key not in tickets:
            tickets[key] = KitchenTicket(
                order_id=o.id,
                order_no=o.order_no,
                order_type=o.order_type,
                table_name=o.table.name if o.table else None,
                customer_name=o.customer_name,
                kot_no=item.kot_no or 0,
                sent_at=item.sent_at,
                notes=o.notes,
                items=[],
            )
        tickets[key].items.append(OrderItemOut.model_validate(item))
    return list(tickets.values())


@router.patch("/kitchen/items/{item_id}", response_model=OrderItemOut)
def kitchen_item_status(
    item_id: int, data: KitchenStatusIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*KITCHEN))
):
    item = get_or_404(db, OrderItem, item_id, "Order item")
    if item.status in ("new", "cancelled"):
        raise HTTPException(status_code=400, detail=f"Item is {item.status}")
    item.status = data.status
    db.commit()
    return item


@router.patch("/kitchen/tickets/{order_id}/{kot_no}", response_model=list[OrderItemOut])
def kitchen_ticket_status(
    order_id: int,
    kot_no: int,
    data: KitchenStatusIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*KITCHEN)),
):
    items = db.scalars(
        select(OrderItem).where(
            OrderItem.order_id == order_id,
            OrderItem.kot_no == kot_no,
            OrderItem.status.in_(["sent", "preparing", "ready"]),
        )
    ).all()
    if not items:
        raise HTTPException(status_code=404, detail="Ticket not found")
    for i in items:
        i.status = data.status
    db.commit()
    return items
