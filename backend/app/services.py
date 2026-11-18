"""Business logic shared between routers: order totals and stock movements."""

from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import AppSetting, InventoryItem, Order, RecipeLine, StockMovement
from .utils import q2, today

ZERO = Decimal(0)
ACTIVE_ITEM_STATES = ("new", "sent", "preparing", "ready", "served")


# --------------------------------------------------------------------------- orders

def recalc_order(order: Order, settings: AppSetting) -> None:
    subtotal = sum((i.line_total for i in order.items if i.status != "cancelled"), ZERO)
    order.subtotal = q2(subtotal)

    if order.discount_type == "percent":
        pct = min(Decimal(order.discount_value or 0), Decimal(100))
        discount = subtotal * pct / Decimal(100)
    else:
        discount = Decimal(order.discount_value or 0)
    discount = min(discount, subtotal)
    order.discount_amount = q2(discount)

    net = subtotal - order.discount_amount
    service = net * Decimal(settings.service_charge_rate or 0) / 100 if order.order_type == "dine_in" else ZERO
    order.service_charge = q2(service)
    order.tax_amount = q2((net + order.service_charge) * Decimal(settings.tax_rate or 0) / 100)
    fee = Decimal(order.delivery_fee or 0) if order.order_type == "delivery" else ZERO
    order.delivery_fee = q2(fee)
    order.total = q2(net + order.service_charge + order.tax_amount + order.delivery_fee)
    order.paid_amount = q2(sum((p.amount for p in order.payments), ZERO))


def balance_due(order: Order) -> Decimal:
    return q2(max(Decimal(order.total) - Decimal(order.paid_amount), ZERO))


# --------------------------------------------------------------------------- inventory

def move_stock(
    db: Session,
    item: InventoryItem,
    location: str,
    qty: Decimal,
    movement_type: str,
    movement_date: date,
    unit_cost: Decimal | None = None,
    ref_type: str = "",
    ref_id: int | None = None,
    ref_no: str = "",
    notes: str = "",
    user_id: int | None = None,
    allow_negative: bool = False,
) -> StockMovement:
    """Apply a signed quantity change to one location of an item and write the ledger row."""
    qty = Decimal(qty)
    attr = "store_qty" if location == "store" else "kitchen_qty"
    current = Decimal(getattr(item, attr) or 0)
    new_balance = current + qty
    if new_balance < 0 and not allow_negative:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient {location} stock for '{item.name}': available {current.normalize():f}, "
            f"required {(-qty).normalize():f}",
        )
    setattr(item, attr, new_balance)
    mv = StockMovement(
        item_id=item.id,
        location=location,
        movement_type=movement_type,
        quantity=qty,
        unit_cost=unit_cost if unit_cost is not None else item.avg_cost,
        balance_after=new_balance,
        ref_type=ref_type,
        ref_id=ref_id,
        ref_no=ref_no,
        movement_date=movement_date,
        notes=notes[:255],
        created_by_id=user_id,
    )
    db.add(mv)
    return mv


def apply_purchase_cost(item: InventoryItem, qty: Decimal, unit_cost: Decimal) -> None:
    """Weighted-average costing across total (store + kitchen) on-hand quantity."""
    on_hand = max(Decimal(item.store_qty or 0) + Decimal(item.kitchen_qty or 0), ZERO)
    old_value = on_hand * Decimal(item.avg_cost or 0)
    new_qty = on_hand + qty
    if new_qty > 0:
        item.avg_cost = (old_value + qty * unit_cost) / new_qty
    item.last_purchase_price = unit_cost


# --------------------------------------------------------------------------- recipe mode

def deduct_recipe_stock(db: Session, order: Order, settings: AppSetting, user_id: int | None) -> None:
    """Recipe mode: take each sold dish's ingredients out of stock when the order is completed.

    Stock may go negative - a sale is never blocked by missing stock; negative balances show
    that purchases / issues were not recorded. Each line's ingredient cost is stored on the line.
    """
    if settings.inventory_mode != "recipe" or order.stock_deducted:
        return
    lines = [i for i in order.items if i.status != "cancelled"]
    menu_ids = {i.menu_item_id for i in lines}
    if not menu_ids:
        return
    recipes: dict[int, list[RecipeLine]] = {}
    for r in db.scalars(select(RecipeLine).where(RecipeLine.menu_item_id.in_(menu_ids))):
        recipes.setdefault(r.menu_item_id, []).append(r)
    needed: dict[int, Decimal] = {}
    for line in lines:
        for r in recipes.get(line.menu_item_id, []):
            needed[r.inventory_item_id] = needed.get(r.inventory_item_id, ZERO) + Decimal(r.quantity) * line.quantity
    if not needed:
        order.stock_deducted = True
        return
    # lock in id order so concurrent completions cannot deadlock
    items = {
        i.id: i
        for i in db.scalars(
            select(InventoryItem).where(InventoryItem.id.in_(needed)).order_by(InventoryItem.id).with_for_update()
        )
    }
    for line in lines:
        cost = sum(
            (Decimal(r.quantity) * line.quantity * Decimal(items[r.inventory_item_id].avg_cost or 0)
             for r in recipes.get(line.menu_item_id, [])),
            ZERO,
        )
        line.cost_amount = q2(cost)
    location = settings.recipe_stock_location if settings.recipe_stock_location in ("store", "kitchen") else "kitchen"
    for item_id in sorted(needed):
        move_stock(
            db, items[item_id], location, -needed[item_id], "sale", today(),
            ref_type="order", ref_id=order.id, ref_no=order.order_no, notes="Recipe deduction",
            user_id=user_id, allow_negative=True,
        )
    order.stock_deducted = True


def reverse_recipe_stock(db: Session, order: Order, user_id: int | None) -> None:
    """Put back everything deducted for this order (used when a completed order is reopened)."""
    if not order.stock_deducted:
        return
    net = db.execute(
        select(StockMovement.item_id, StockMovement.location, func.sum(StockMovement.quantity),
               func.sum(StockMovement.quantity * StockMovement.unit_cost))
        .where(StockMovement.ref_type == "order", StockMovement.ref_id == order.id)
        .group_by(StockMovement.item_id, StockMovement.location)
    ).all()
    to_reverse = [(item_id, loc, qty, value) for item_id, loc, qty, value in net if qty]
    if to_reverse:
        items = {
            i.id: i
            for i in db.scalars(
                select(InventoryItem).where(InventoryItem.id.in_([r[0] for r in to_reverse]))
                .order_by(InventoryItem.id).with_for_update()
            )
        }
        for item_id, loc, qty, value in sorted(to_reverse):
            move_stock(
                db, items[item_id], loc, -qty, "sale_reversal", today(),
                unit_cost=(value / qty) if qty else None,
                ref_type="order", ref_id=order.id, ref_no=order.order_no, notes="Order reopened",
                user_id=user_id, allow_negative=True,
            )
    for line in order.items:
        line.cost_amount = ZERO
    order.stock_deducted = False
