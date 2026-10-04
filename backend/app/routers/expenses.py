from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Expense, ExpenseCategory, User
from ..schemas import ExpenseIn, ExpenseOut, NamedIn, NamedOut
from ..security import MANAGERS, require_roles
from ..utils import commit_or_409, get_or_404

router = APIRouter(prefix="/api/expenses", tags=["expenses"])
manager = require_roles(*MANAGERS)


def _out(e: Expense) -> ExpenseOut:
    out = ExpenseOut.model_validate(e)
    out.category_name = e.category.name if e.category else ""
    return out


@router.get("/categories", response_model=list[NamedOut])
def list_categories(db: Session = Depends(get_db), _: User = Depends(manager)):
    return db.scalars(select(ExpenseCategory).order_by(ExpenseCategory.name)).all()


@router.post("/categories", response_model=NamedOut, status_code=201)
def create_category(data: NamedIn, db: Session = Depends(get_db), _: User = Depends(manager)):
    c = ExpenseCategory(name=data.name)
    db.add(c)
    commit_or_409(db, "Category already exists")
    return c


@router.put("/categories/{cat_id}", response_model=NamedOut)
def update_category(cat_id: int, data: NamedIn, db: Session = Depends(get_db), _: User = Depends(manager)):
    c = get_or_404(db, ExpenseCategory, cat_id, "Category")
    c.name = data.name
    commit_or_409(db, "Category already exists")
    return c


@router.delete("/categories/{cat_id}", status_code=204)
def delete_category(cat_id: int, db: Session = Depends(get_db), _: User = Depends(manager)):
    db.delete(get_or_404(db, ExpenseCategory, cat_id, "Category"))
    commit_or_409(db)


@router.get("", response_model=list[ExpenseOut])
def list_expenses(
    date_from: date | None = None,
    date_to: date | None = None,
    category_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(manager),
):
    stmt = (
        select(Expense)
        .options(joinedload(Expense.category))
        .order_by(Expense.expense_date.desc(), Expense.id.desc())
        .limit(1000)
    )
    if date_from:
        stmt = stmt.where(Expense.expense_date >= date_from)
    if date_to:
        stmt = stmt.where(Expense.expense_date <= date_to)
    if category_id:
        stmt = stmt.where(Expense.category_id == category_id)
    return [_out(e) for e in db.scalars(stmt)]


@router.post("", response_model=ExpenseOut, status_code=201)
def create_expense(data: ExpenseIn, db: Session = Depends(get_db), user: User = Depends(manager)):
    get_or_404(db, ExpenseCategory, data.category_id, "Category")
    e = Expense(**data.model_dump(), created_by_id=user.id)
    db.add(e)
    commit_or_409(db)
    db.refresh(e)
    return _out(e)


@router.put("/{expense_id}", response_model=ExpenseOut)
def update_expense(expense_id: int, data: ExpenseIn, db: Session = Depends(get_db), _: User = Depends(manager)):
    e = get_or_404(db, Expense, expense_id, "Expense")
    get_or_404(db, ExpenseCategory, data.category_id, "Category")
    for k, v in data.model_dump().items():
        setattr(e, k, v)
    commit_or_409(db)
    db.refresh(e)
    return _out(e)


@router.delete("/{expense_id}", status_code=204)
def delete_expense(expense_id: int, db: Session = Depends(get_db), _: User = Depends(manager)):
    db.delete(get_or_404(db, Expense, expense_id, "Expense"))
    commit_or_409(db)
