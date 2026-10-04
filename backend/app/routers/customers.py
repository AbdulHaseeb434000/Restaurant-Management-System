from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Customer, Order, User
from ..schemas import CustomerIn, CustomerOut
from ..security import FRONT_OF_HOUSE, MANAGERS, get_current_user, require_roles
from ..utils import commit_or_409, get_or_404

router = APIRouter(prefix="/api/customers", tags=["customers"])


def _stats(db: Session, ids: list[int]) -> dict[int, tuple[int, float]]:
    if not ids:
        return {}
    rows = db.execute(
        select(Order.customer_id, func.count(Order.id), func.coalesce(func.sum(Order.total), 0))
        .where(Order.customer_id.in_(ids), Order.status == "completed")
        .group_by(Order.customer_id)
    ).all()
    return {r[0]: (r[1], r[2]) for r in rows}


def _out(c: Customer, stats) -> CustomerOut:
    out = CustomerOut.model_validate(c)
    if c.id in stats:
        out.order_count, out.total_spent = stats[c.id]
    return out


@router.get("", response_model=list[CustomerOut])
def list_customers(
    search: str | None = None, limit: int = 200, db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    stmt = select(Customer).order_by(Customer.name).limit(min(limit, 1000))
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(Customer.name.ilike(like) | Customer.phone.ilike(like))
    customers = db.scalars(stmt).all()
    stats = _stats(db, [c.id for c in customers])
    return [_out(c, stats) for c in customers]


@router.get("/by-phone/{phone}", response_model=CustomerOut)
def get_by_phone(phone: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    c = db.scalar(select(Customer).where(Customer.phone == phone.strip()))
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    return _out(c, _stats(db, [c.id]))


@router.post("", response_model=CustomerOut, status_code=201)
def create_customer(data: CustomerIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*FRONT_OF_HOUSE))):
    c = Customer(**data.model_dump())
    c.phone = c.phone.strip()
    db.add(c)
    commit_or_409(db, "A customer with this phone number already exists")
    return _out(c, {})


@router.put("/{customer_id}", response_model=CustomerOut)
def update_customer(
    customer_id: int, data: CustomerIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*FRONT_OF_HOUSE))
):
    c = get_or_404(db, Customer, customer_id, "Customer")
    for k, v in data.model_dump().items():
        setattr(c, k, v)
    c.phone = c.phone.strip()
    commit_or_409(db, "A customer with this phone number already exists")
    return _out(c, _stats(db, [c.id]))


@router.delete("/{customer_id}", status_code=204)
def delete_customer(customer_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGERS))):
    c = get_or_404(db, Customer, customer_id, "Customer")
    if db.scalar(select(func.count(Order.id)).where(Order.customer_id == customer_id)):
        raise HTTPException(status_code=400, detail="Customer has orders and cannot be deleted")
    db.delete(c)
    commit_or_409(db)
