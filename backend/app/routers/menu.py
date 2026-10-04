from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import MenuCategory, MenuItem, OrderItem, User
from ..schemas import MenuCategoryIn, MenuCategoryOut, MenuItemIn, MenuItemOut
from ..security import MANAGERS, get_current_user, require_roles
from ..utils import commit_or_409, get_or_404

router = APIRouter(prefix="/api/menu", tags=["menu"])


def _item_out(item: MenuItem) -> MenuItemOut:
    out = MenuItemOut.model_validate(item)
    out.category_name = item.category.name if item.category else ""
    return out


# ---------------------------------------------------------------- categories

@router.get("/categories", response_model=list[MenuCategoryOut])
def list_categories(
    include_inactive: bool = False, db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    counts = dict(
        db.execute(
            select(MenuItem.category_id, func.count(MenuItem.id))
            .where(MenuItem.is_active.is_(True))
            .group_by(MenuItem.category_id)
        ).all()
    )
    stmt = select(MenuCategory).order_by(MenuCategory.sort_order, MenuCategory.name)
    if not include_inactive:
        stmt = stmt.where(MenuCategory.is_active.is_(True))
    result = []
    for c in db.scalars(stmt):
        out = MenuCategoryOut.model_validate(c)
        out.item_count = counts.get(c.id, 0)
        result.append(out)
    return result


@router.post("/categories", response_model=MenuCategoryOut, status_code=201)
def create_category(data: MenuCategoryIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGERS))):
    cat = MenuCategory(**data.model_dump())
    db.add(cat)
    commit_or_409(db, "A category with this name already exists")
    return cat


@router.put("/categories/{cat_id}", response_model=MenuCategoryOut)
def update_category(
    cat_id: int, data: MenuCategoryIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGERS))
):
    cat = get_or_404(db, MenuCategory, cat_id, "Category")
    for k, v in data.model_dump().items():
        setattr(cat, k, v)
    commit_or_409(db, "A category with this name already exists")
    return cat


@router.delete("/categories/{cat_id}", status_code=204)
def delete_category(cat_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGERS))):
    cat = get_or_404(db, MenuCategory, cat_id, "Category")
    if db.scalar(select(func.count(MenuItem.id)).where(MenuItem.category_id == cat_id)):
        raise HTTPException(status_code=400, detail="Category has menu items. Move or delete them first.")
    db.delete(cat)
    commit_or_409(db)


# ---------------------------------------------------------------- items

@router.get("/items", response_model=list[MenuItemOut])
def list_items(
    category_id: int | None = None,
    search: str | None = None,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(MenuItem).options(joinedload(MenuItem.category)).join(MenuItem.category)
    if category_id:
        stmt = stmt.where(MenuItem.category_id == category_id)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(MenuItem.name.ilike(like) | MenuItem.code.ilike(like))
    if not include_inactive:
        stmt = stmt.where(MenuItem.is_active.is_(True), MenuCategory.is_active.is_(True))
    stmt = stmt.order_by(MenuCategory.sort_order, MenuCategory.name, MenuItem.name)
    return [_item_out(i) for i in db.scalars(stmt)]


@router.post("/items", response_model=MenuItemOut, status_code=201)
def create_item(data: MenuItemIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGERS))):
    get_or_404(db, MenuCategory, data.category_id, "Category")
    payload = data.model_dump()
    payload["code"] = (payload["code"] or "").strip() or None
    item = MenuItem(**payload)
    db.add(item)
    commit_or_409(db, "Item code already in use")
    db.refresh(item)
    return _item_out(item)


@router.put("/items/{item_id}", response_model=MenuItemOut)
def update_item(
    item_id: int, data: MenuItemIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGERS))
):
    item = get_or_404(db, MenuItem, item_id, "Menu item")
    get_or_404(db, MenuCategory, data.category_id, "Category")
    payload = data.model_dump()
    payload["code"] = (payload["code"] or "").strip() or None
    for k, v in payload.items():
        setattr(item, k, v)
    commit_or_409(db, "Item code already in use")
    db.refresh(item)
    return _item_out(item)


@router.patch("/items/{item_id}/availability", response_model=MenuItemOut)
def toggle_availability(
    item_id: int,
    is_available: bool,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("manager", "kitchen", "cashier")),
):
    """Quick 86'ing of an item from POS / kitchen."""
    item = get_or_404(db, MenuItem, item_id, "Menu item")
    item.is_available = is_available
    db.commit()
    return _item_out(item)


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGERS))):
    item = get_or_404(db, MenuItem, item_id, "Menu item")
    if db.scalar(select(func.count(OrderItem.id)).where(OrderItem.menu_item_id == item_id)):
        # keep history intact: soft delete
        item.is_active = False
        item.is_available = False
    else:
        db.delete(item)
    commit_or_409(db)
