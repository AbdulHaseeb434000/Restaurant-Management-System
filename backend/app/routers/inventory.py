from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from ..database import get_db
from ..models import (
    InventoryItem,
    ItemCategory,
    Purchase,
    PurchaseItem,
    StockAdjustment,
    StockIssue,
    StockIssueItem,
    StockMovement,
    Supplier,
    Unit,
    User,
)
from ..schemas import (
    AdjustmentIn,
    AdjustmentOut,
    CancelIn,
    InventoryItemIn,
    InventoryItemOut,
    IssueIn,
    IssueOut,
    LineOut,
    MovementOut,
    NamedIn,
    NamedOut,
    PurchaseIn,
    PurchaseOut,
    PurchasePaymentIn,
    SupplierIn,
    SupplierOut,
    UnitIn,
    UnitOut,
)
from ..security import STORE, get_current_user, require_roles
from ..services import apply_purchase_cost, move_stock
from ..utils import commit_or_409, get_or_404, q2

router = APIRouter(prefix="/api/inventory", tags=["inventory"])

store_user = require_roles(*STORE)
store_reader = require_roles(*STORE, "kitchen")


# --------------------------------------------------------------------------- units & categories

@router.get("/units", response_model=list[UnitOut])
def list_units(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.scalars(select(Unit).order_by(Unit.name)).all()


@router.post("/units", response_model=UnitOut, status_code=201)
def create_unit(data: UnitIn, db: Session = Depends(get_db), _: User = Depends(store_user)):
    u = Unit(**data.model_dump())
    db.add(u)
    commit_or_409(db, "Unit already exists")
    return u


@router.put("/units/{unit_id}", response_model=UnitOut)
def update_unit(unit_id: int, data: UnitIn, db: Session = Depends(get_db), _: User = Depends(store_user)):
    u = get_or_404(db, Unit, unit_id, "Unit")
    u.name, u.abbreviation = data.name, data.abbreviation
    commit_or_409(db, "Unit already exists")
    return u


@router.delete("/units/{unit_id}", status_code=204)
def delete_unit(unit_id: int, db: Session = Depends(get_db), _: User = Depends(store_user)):
    db.delete(get_or_404(db, Unit, unit_id, "Unit"))
    commit_or_409(db)


@router.get("/categories", response_model=list[NamedOut])
def list_item_categories(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.scalars(select(ItemCategory).order_by(ItemCategory.name)).all()


@router.post("/categories", response_model=NamedOut, status_code=201)
def create_item_category(data: NamedIn, db: Session = Depends(get_db), _: User = Depends(store_user)):
    c = ItemCategory(name=data.name)
    db.add(c)
    commit_or_409(db, "Category already exists")
    return c


@router.put("/categories/{cat_id}", response_model=NamedOut)
def update_item_category(cat_id: int, data: NamedIn, db: Session = Depends(get_db), _: User = Depends(store_user)):
    c = get_or_404(db, ItemCategory, cat_id, "Category")
    c.name = data.name
    commit_or_409(db, "Category already exists")
    return c


@router.delete("/categories/{cat_id}", status_code=204)
def delete_item_category(cat_id: int, db: Session = Depends(get_db), _: User = Depends(store_user)):
    db.delete(get_or_404(db, ItemCategory, cat_id, "Category"))
    commit_or_409(db)


# --------------------------------------------------------------------------- inventory items

def item_out(i: InventoryItem) -> InventoryItemOut:
    out = InventoryItemOut.model_validate(i)
    out.category_name = i.category.name if i.category else None
    out.unit_name = i.unit.abbreviation if i.unit else ""
    total = Decimal(i.store_qty or 0) + Decimal(i.kitchen_qty or 0)
    out.stock_value = q2(total * Decimal(i.avg_cost or 0))
    out.is_low = Decimal(i.reorder_level or 0) > 0 and Decimal(i.store_qty or 0) <= Decimal(i.reorder_level)
    return out


@router.get("/items", response_model=list[InventoryItemOut])
def list_items(
    search: str | None = None,
    category_id: int | None = None,
    low_stock: bool = False,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = (
        select(InventoryItem)
        .options(joinedload(InventoryItem.category), joinedload(InventoryItem.unit))
        .order_by(InventoryItem.name)
    )
    if not include_inactive:
        stmt = stmt.where(InventoryItem.is_active.is_(True))
    if category_id:
        stmt = stmt.where(InventoryItem.category_id == category_id)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(or_(InventoryItem.name.ilike(like), InventoryItem.sku.ilike(like)))
    if low_stock:
        stmt = stmt.where(InventoryItem.reorder_level > 0, InventoryItem.store_qty <= InventoryItem.reorder_level)
    return [item_out(i) for i in db.scalars(stmt)]


@router.get("/items/{item_id}", response_model=InventoryItemOut)
def get_item(item_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return item_out(get_or_404(db, InventoryItem, item_id, "Item"))


def _validate_item_refs(db: Session, data: InventoryItemIn) -> dict:
    get_or_404(db, Unit, data.unit_id, "Unit")
    if data.category_id:
        get_or_404(db, ItemCategory, data.category_id, "Category")
    payload = data.model_dump()
    payload["sku"] = (payload["sku"] or "").strip() or None
    return payload


@router.post("/items", response_model=InventoryItemOut, status_code=201)
def create_item(data: InventoryItemIn, db: Session = Depends(get_db), _: User = Depends(store_user)):
    item = InventoryItem(**_validate_item_refs(db, data))
    db.add(item)
    commit_or_409(db, "An item with this name or SKU already exists")
    db.refresh(item)
    return item_out(item)


@router.put("/items/{item_id}", response_model=InventoryItemOut)
def update_item(item_id: int, data: InventoryItemIn, db: Session = Depends(get_db), _: User = Depends(store_user)):
    item = get_or_404(db, InventoryItem, item_id, "Item")
    for k, v in _validate_item_refs(db, data).items():
        setattr(item, k, v)
    commit_or_409(db, "An item with this name or SKU already exists")
    db.refresh(item)
    return item_out(item)


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db), _: User = Depends(store_user)):
    item = get_or_404(db, InventoryItem, item_id, "Item")
    if db.scalar(select(func.count(StockMovement.id)).where(StockMovement.item_id == item_id)):
        item.is_active = False  # has history, soft delete
    else:
        db.delete(item)
    commit_or_409(db)


def _lock_item(db: Session, item_id: int) -> InventoryItem:
    item = db.scalars(select(InventoryItem).where(InventoryItem.id == item_id).with_for_update()).first()
    if not item:
        raise HTTPException(status_code=400, detail=f"Inventory item #{item_id} not found")
    if not item.is_active:
        raise HTTPException(status_code=400, detail=f"Inventory item '{item.name}' is inactive")
    return item


# --------------------------------------------------------------------------- suppliers

@router.get("/suppliers", response_model=list[SupplierOut])
def list_suppliers(include_inactive: bool = False, db: Session = Depends(get_db), _: User = Depends(store_reader)):
    stats = {
        r[0]: (r[1], r[2])
        for r in db.execute(
            select(Purchase.supplier_id, func.sum(Purchase.total), func.sum(Purchase.total - Purchase.paid_amount))
            .where(Purchase.status == "received")
            .group_by(Purchase.supplier_id)
        )
    }
    stmt = select(Supplier).order_by(Supplier.name)
    if not include_inactive:
        stmt = stmt.where(Supplier.is_active.is_(True))
    result = []
    for s in db.scalars(stmt):
        out = SupplierOut.model_validate(s)
        if s.id in stats:
            out.total_purchases, out.balance_due = stats[s.id]
        result.append(out)
    return result


@router.post("/suppliers", response_model=SupplierOut, status_code=201)
def create_supplier(data: SupplierIn, db: Session = Depends(get_db), _: User = Depends(store_user)):
    s = Supplier(**data.model_dump())
    db.add(s)
    commit_or_409(db, "Supplier already exists")
    return s


@router.put("/suppliers/{supplier_id}", response_model=SupplierOut)
def update_supplier(supplier_id: int, data: SupplierIn, db: Session = Depends(get_db), _: User = Depends(store_user)):
    s = get_or_404(db, Supplier, supplier_id, "Supplier")
    for k, v in data.model_dump().items():
        setattr(s, k, v)
    commit_or_409(db, "Supplier already exists")
    return s


@router.delete("/suppliers/{supplier_id}", status_code=204)
def delete_supplier(supplier_id: int, db: Session = Depends(get_db), _: User = Depends(store_user)):
    s = get_or_404(db, Supplier, supplier_id, "Supplier")
    if db.scalar(select(func.count(Purchase.id)).where(Purchase.supplier_id == supplier_id)):
        s.is_active = False
    else:
        db.delete(s)
    commit_or_409(db)


# --------------------------------------------------------------------------- purchases (GRN)

def _line_out(line) -> LineOut:
    out = LineOut.model_validate(line)
    out.item_name = line.item.name
    out.unit_name = line.item.unit.abbreviation if line.item.unit else ""
    return out


def purchase_out(p: Purchase) -> PurchaseOut:
    out = PurchaseOut.model_validate(p)
    out.supplier_name = p.supplier.name
    out.created_by_name = p.created_by.full_name if p.created_by else None
    out.items = [_line_out(i) for i in p.items]
    return out


def _purchase_query():
    return select(Purchase).options(
        joinedload(Purchase.supplier),
        joinedload(Purchase.created_by),
        selectinload(Purchase.items).joinedload(PurchaseItem.item).joinedload(InventoryItem.unit),
    )


@router.get("/purchases", response_model=list[PurchaseOut])
def list_purchases(
    date_from: date | None = None,
    date_to: date | None = None,
    supplier_id: int | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(store_reader),
):
    stmt = _purchase_query().order_by(Purchase.purchase_date.desc(), Purchase.id.desc()).limit(500)
    if date_from:
        stmt = stmt.where(Purchase.purchase_date >= date_from)
    if date_to:
        stmt = stmt.where(Purchase.purchase_date <= date_to)
    if supplier_id:
        stmt = stmt.where(Purchase.supplier_id == supplier_id)
    if status:
        stmt = stmt.where(Purchase.status == status)
    return [purchase_out(p) for p in db.scalars(stmt).unique()]


@router.get("/purchases/{purchase_id}", response_model=PurchaseOut)
def get_purchase(purchase_id: int, db: Session = Depends(get_db), _: User = Depends(store_reader)):
    p = db.scalars(_purchase_query().where(Purchase.id == purchase_id)).unique().first()
    if not p:
        raise HTTPException(status_code=404, detail="Purchase not found")
    return purchase_out(p)


@router.post("/purchases", response_model=PurchaseOut, status_code=201)
def create_purchase(data: PurchaseIn, db: Session = Depends(get_db), user: User = Depends(store_user)):
    supplier = get_or_404(db, Supplier, data.supplier_id, "Supplier")
    if not supplier.is_active:
        raise HTTPException(status_code=400, detail="Supplier is inactive")
    p = Purchase(
        purchase_no="TMP",
        supplier_id=supplier.id,
        purchase_date=data.purchase_date,
        invoice_no=data.invoice_no.strip(),
        notes=data.notes,
        status="received",
        created_by_id=user.id,
    )
    db.add(p)
    db.flush()
    p.purchase_no = f"PUR-{p.id:06d}"
    total = Decimal(0)
    for line in data.items:
        item = _lock_item(db, line.item_id)
        line_total = q2(line.quantity * line.unit_cost)
        total += line_total
        p.items.append(PurchaseItem(item_id=item.id, quantity=line.quantity, unit_cost=line.unit_cost, line_total=line_total))
        apply_purchase_cost(item, line.quantity, line.unit_cost)
        move_stock(
            db, item, "store", line.quantity, "purchase", data.purchase_date,
            unit_cost=line.unit_cost, ref_type="purchase", ref_id=p.id, ref_no=p.purchase_no,
            notes=f"From {supplier.name}", user_id=user.id,
        )
    p.total = q2(total)
    if data.paid_amount > p.total:
        raise HTTPException(status_code=400, detail="Paid amount cannot exceed purchase total")
    p.paid_amount = q2(data.paid_amount)
    db.commit()
    return get_purchase(p.id, db, user)


@router.post("/purchases/{purchase_id}/payment", response_model=PurchaseOut)
def update_purchase_payment(
    purchase_id: int, data: PurchasePaymentIn, db: Session = Depends(get_db), user: User = Depends(store_user)
):
    p = get_or_404(db, Purchase, purchase_id, "Purchase")
    if p.status != "received":
        raise HTTPException(status_code=400, detail="Purchase is cancelled")
    if data.paid_amount > p.total:
        raise HTTPException(status_code=400, detail="Paid amount cannot exceed purchase total")
    p.paid_amount = q2(data.paid_amount)
    db.commit()
    return get_purchase(p.id, db, user)


@router.post("/purchases/{purchase_id}/cancel", response_model=PurchaseOut)
def cancel_purchase(purchase_id: int, data: CancelIn, db: Session = Depends(get_db), user: User = Depends(store_user)):
    p = db.scalars(_purchase_query().where(Purchase.id == purchase_id)).unique().first()
    if not p:
        raise HTTPException(status_code=404, detail="Purchase not found")
    if p.status != "received":
        raise HTTPException(status_code=400, detail="Purchase is already cancelled")
    for line in p.items:
        item = _lock_item(db, line.item_id)
        # reverse cost contribution
        on_hand = Decimal(item.store_qty) + Decimal(item.kitchen_qty)
        remaining = on_hand - line.quantity
        if remaining > 0:
            item.avg_cost = max((on_hand * item.avg_cost - line.quantity * line.unit_cost) / remaining, Decimal(0))
        move_stock(
            db, item, "store", -line.quantity, "purchase_cancel", p.purchase_date,
            unit_cost=line.unit_cost, ref_type="purchase", ref_id=p.id, ref_no=p.purchase_no,
            notes=f"Cancelled: {data.reason}", user_id=user.id,
        )
    p.status = "cancelled"
    p.notes = (p.notes + f"\nCancelled: {data.reason}").strip()
    db.commit()
    return get_purchase(p.id, db, user)


# --------------------------------------------------------------------------- store -> kitchen issues

def issue_out(i: StockIssue) -> IssueOut:
    out = IssueOut.model_validate(i)
    out.created_by_name = i.created_by.full_name if i.created_by else None
    out.items = [_line_out(line) for line in i.items]
    return out


def _issue_query():
    return select(StockIssue).options(
        joinedload(StockIssue.created_by),
        selectinload(StockIssue.items).joinedload(StockIssueItem.item).joinedload(InventoryItem.unit),
    )


@router.get("/issues", response_model=list[IssueOut])
def list_issues(
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(store_reader),
):
    stmt = _issue_query().order_by(StockIssue.issue_date.desc(), StockIssue.id.desc()).limit(500)
    if date_from:
        stmt = stmt.where(StockIssue.issue_date >= date_from)
    if date_to:
        stmt = stmt.where(StockIssue.issue_date <= date_to)
    return [issue_out(i) for i in db.scalars(stmt).unique()]


@router.get("/issues/{issue_id}", response_model=IssueOut)
def get_issue(issue_id: int, db: Session = Depends(get_db), _: User = Depends(store_reader)):
    i = db.scalars(_issue_query().where(StockIssue.id == issue_id)).unique().first()
    if not i:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue_out(i)


@router.post("/issues", response_model=IssueOut, status_code=201)
def create_issue(data: IssueIn, db: Session = Depends(get_db), user: User = Depends(store_user)):
    issue = StockIssue(
        issue_no="TMP",
        issue_date=data.issue_date,
        issued_to=data.issued_to.strip() or "Kitchen",
        notes=data.notes,
        created_by_id=user.id,
    )
    db.add(issue)
    db.flush()
    issue.issue_no = f"ISS-{issue.id:06d}"
    total = Decimal(0)
    for line in data.items:
        item = _lock_item(db, line.item_id)
        cost = Decimal(item.avg_cost or 0)
        line_total = q2(line.quantity * cost)
        total += line_total
        issue.items.append(StockIssueItem(item_id=item.id, quantity=line.quantity, unit_cost=cost, line_total=line_total))
        common = dict(unit_cost=cost, ref_type="issue", ref_id=issue.id, ref_no=issue.issue_no, user_id=user.id)
        move_stock(db, item, "store", -line.quantity, "issue_out", data.issue_date, notes=f"To {issue.issued_to}", **common)
        move_stock(db, item, "kitchen", line.quantity, "issue_in", data.issue_date, notes="From store", **common)
    issue.total_value = q2(total)
    db.commit()
    return get_issue(issue.id, db, user)


# --------------------------------------------------------------------------- adjustments

def adjustment_out(a: StockAdjustment) -> AdjustmentOut:
    out = AdjustmentOut.model_validate(a)
    out.item_name = a.item.name
    out.unit_name = a.item.unit.abbreviation if a.item.unit else ""
    out.created_by_name = a.created_by.full_name if a.created_by else None
    return out


@router.get("/adjustments", response_model=list[AdjustmentOut])
def list_adjustments(
    date_from: date | None = None,
    date_to: date | None = None,
    location: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(store_reader),
):
    stmt = (
        select(StockAdjustment)
        .options(
            joinedload(StockAdjustment.item).joinedload(InventoryItem.unit),
            joinedload(StockAdjustment.created_by),
        )
        .order_by(StockAdjustment.adjustment_date.desc(), StockAdjustment.id.desc())
        .limit(500)
    )
    if date_from:
        stmt = stmt.where(StockAdjustment.adjustment_date >= date_from)
    if date_to:
        stmt = stmt.where(StockAdjustment.adjustment_date <= date_to)
    if location:
        stmt = stmt.where(StockAdjustment.location == location)
    return [adjustment_out(a) for a in db.scalars(stmt)]


@router.post("/adjustments", response_model=AdjustmentOut, status_code=201)
def create_adjustment(
    data: AdjustmentIn, db: Session = Depends(get_db), user: User = Depends(require_roles(*STORE, "kitchen"))
):
    if data.quantity == 0:
        raise HTTPException(status_code=400, detail="Quantity cannot be zero")
    if data.reason in ("wastage", "damage", "consumption") and data.quantity > 0:
        raise HTTPException(status_code=400, detail=f"{data.reason.title()} must be a negative quantity")
    if user.role == "kitchen" and data.location != "kitchen":
        raise HTTPException(status_code=403, detail="Kitchen staff can only adjust kitchen stock")
    item = _lock_item(db, data.item_id)
    if data.quantity > 0 and data.unit_cost is not None and data.unit_cost > 0:
        apply_purchase_cost(item, data.quantity, data.unit_cost)
    cost = Decimal(item.avg_cost or 0)
    adj = StockAdjustment(
        adjustment_date=data.adjustment_date,
        item_id=item.id,
        location=data.location,
        reason=data.reason,
        quantity=data.quantity,
        unit_cost=cost,
        value=q2(data.quantity * cost),
        notes=data.notes,
        created_by_id=user.id,
    )
    db.add(adj)
    db.flush()
    move_stock(
        db, item, data.location, data.quantity, "adjustment", data.adjustment_date,
        unit_cost=cost, ref_type="adjustment", ref_id=adj.id, ref_no=f"ADJ-{adj.id:06d}",
        notes=f"{data.reason}: {data.notes}".strip(": "), user_id=user.id,
    )
    db.commit()
    db.refresh(adj)
    return adjustment_out(adj)


# --------------------------------------------------------------------------- ledger

@router.get("/movements", response_model=list[MovementOut])
def list_movements(
    item_id: int | None = None,
    location: str | None = None,
    movement_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 500,
    db: Session = Depends(get_db),
    _: User = Depends(store_reader),
):
    stmt = (
        select(StockMovement)
        .options(joinedload(StockMovement.item).joinedload(InventoryItem.unit))
        .order_by(StockMovement.id.desc())
        .limit(min(limit, 2000))
    )
    if item_id:
        stmt = stmt.where(StockMovement.item_id == item_id)
    if location:
        stmt = stmt.where(StockMovement.location == location)
    if movement_type:
        stmt = stmt.where(StockMovement.movement_type == movement_type)
    if date_from:
        stmt = stmt.where(StockMovement.movement_date >= date_from)
    if date_to:
        stmt = stmt.where(StockMovement.movement_date <= date_to)
    result = []
    for m in db.scalars(stmt):
        out = MovementOut.model_validate(m)
        out.item_name = m.item.name
        out.unit_name = m.item.unit.abbreviation if m.item.unit else ""
        result.append(out)
    return result
