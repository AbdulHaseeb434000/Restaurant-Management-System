from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..schemas import SettingsBase, SettingsOut
from ..security import get_current_user, require_roles
from ..utils import get_app_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=SettingsOut)
def read_settings(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    s = get_app_settings(db)
    db.commit()
    return s


@router.put("", response_model=SettingsOut)
def update_settings(data: SettingsBase, db: Session = Depends(get_db), _: User = Depends(require_roles("manager"))):
    s = get_app_settings(db)
    for key, value in data.model_dump().items():
        setattr(s, key, value)
    db.commit()
    return s
