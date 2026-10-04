from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import DiningArea, DiningTable, Order, User
from ..schemas import AreaIn, AreaOut, TableIn, TableOut, TableStatusIn
from ..security import FRONT_OF_HOUSE, MANAGERS, get_current_user, require_roles
from ..utils import commit_or_409, get_or_404

router = APIRouter(prefix="/api", tags=["tables"])


def _open_orders_by_table(db: Session) -> dict[int, Order]:
    orders = db.scalars(
        select(Order).where(Order.status == "open", Order.table_id.is_not(None)).order_by(Order.id)
    ).all()
    return {o.table_id: o for o in orders}


def _table_out(t: DiningTable, order: Order | None) -> TableOut:
    out = TableOut.model_validate(t)
    out.area_name = t.area.name if t.area else None
    if order:
        out.open_order_id = order.id
        out.open_order_no = order.order_no
        out.open_order_total = order.total
        out.open_since = order.created_at
    return out


# ---------------------------------------------------------------- areas

@router.get("/areas", response_model=list[AreaOut])
def list_areas(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.scalars(select(DiningArea).order_by(DiningArea.name)).all()


@router.post("/areas", response_model=AreaOut, status_code=201)
def create_area(data: AreaIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGERS))):
    area = DiningArea(name=data.name)
    db.add(area)
    commit_or_409(db, "Area already exists")
    return area


@router.put("/areas/{area_id}", response_model=AreaOut)
def update_area(area_id: int, data: AreaIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGERS))):
    area = get_or_404(db, DiningArea, area_id, "Area")
    area.name = data.name
    commit_or_409(db, "Area already exists")
    return area


@router.delete("/areas/{area_id}", status_code=204)
def delete_area(area_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGERS))):
    area = get_or_404(db, DiningArea, area_id, "Area")
    if db.scalar(select(func.count(DiningTable.id)).where(DiningTable.area_id == area_id)):
        raise HTTPException(status_code=400, detail="Area has tables. Move or delete them first.")
    db.delete(area)
    commit_or_409(db)


# ---------------------------------------------------------------- tables

@router.get("/tables", response_model=list[TableOut])
def list_tables(include_inactive: bool = False, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    stmt = select(DiningTable).options(joinedload(DiningTable.area)).order_by(DiningTable.area_id, DiningTable.id)
    if not include_inactive:
        stmt = stmt.where(DiningTable.is_active.is_(True))
    open_orders = _open_orders_by_table(db)
    return [_table_out(t, open_orders.get(t.id)) for t in db.scalars(stmt)]


@router.post("/tables", response_model=TableOut, status_code=201)
def create_table(data: TableIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGERS))):
    if data.area_id:
        get_or_404(db, DiningArea, data.area_id, "Area")
    table = DiningTable(**data.model_dump())
    db.add(table)
    commit_or_409(db, "A table with this name already exists")
    db.refresh(table)
    return _table_out(table, None)


@router.put("/tables/{table_id}", response_model=TableOut)
def update_table(
    table_id: int, data: TableIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGERS))
):
    table = get_or_404(db, DiningTable, table_id, "Table")
    if data.area_id:
        get_or_404(db, DiningArea, data.area_id, "Area")
    for k, v in data.model_dump().items():
        setattr(table, k, v)
    commit_or_409(db, "A table with this name already exists")
    db.refresh(table)
    return _table_out(table, _open_orders_by_table(db).get(table.id))


@router.patch("/tables/{table_id}/status", response_model=TableOut)
def set_table_status(
    table_id: int,
    data: TableStatusIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*FRONT_OF_HOUSE)),
):
    table = get_or_404(db, DiningTable, table_id, "Table")
    order = _open_orders_by_table(db).get(table.id)
    if order:
        raise HTTPException(status_code=400, detail=f"Table has an open order ({order.order_no})")
    table.status = data.status
    db.commit()
    return _table_out(table, None)


@router.delete("/tables/{table_id}", status_code=204)
def delete_table(table_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGERS))):
    table = get_or_404(db, DiningTable, table_id, "Table")
    if db.scalar(select(func.count(Order.id)).where(Order.table_id == table_id)):
        table.is_active = False  # keep order history
    else:
        db.delete(table)
    commit_or_409(db)
