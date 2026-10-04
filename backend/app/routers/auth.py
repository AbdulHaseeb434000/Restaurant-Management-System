from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..schemas import PasswordChange, Token, UserCreate, UserOut, UserUpdate
from ..security import (
    create_access_token,
    get_current_user,
    hash_password,
    require_roles,
    verify_password,
)
from ..utils import commit_or_409, get_or_404

router = APIRouter(prefix="/api", tags=["auth"])


@router.post("/auth/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == form.username.strip().lower()))
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is disabled")
    return Token(access_token=create_access_token(user), user=UserOut.model_validate(user))


@router.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/auth/change-password", status_code=204)
def change_password(data: PasswordChange, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(data.new_password)
    db.commit()


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(require_roles())):
    return db.scalars(select(User).order_by(User.id)).all()


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(data: UserCreate, db: Session = Depends(get_db), _: User = Depends(require_roles())):
    user = User(
        username=data.username.strip().lower(),
        full_name=data.full_name,
        password_hash=hash_password(data.password),
        role=data.role,
        is_active=data.is_active,
    )
    db.add(user)
    commit_or_409(db, "Username already exists")
    return user


@router.put("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int, data: UserUpdate, db: Session = Depends(get_db), current: User = Depends(require_roles())
):
    user = get_or_404(db, User, user_id, "User")
    if user.id == current.id and (data.is_active is False or (data.role and data.role != "admin")):
        raise HTTPException(status_code=400, detail="You cannot deactivate or demote your own account")
    if data.full_name is not None:
        user.full_name = data.full_name
    if data.role is not None:
        user.role = data.role
    if data.is_active is not None:
        user.is_active = data.is_active
    if data.password:
        user.password_hash = hash_password(data.password)
    db.commit()
    return user
