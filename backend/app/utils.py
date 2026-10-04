from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .models import AppSetting

TWO = Decimal("0.01")
TZ = ZoneInfo(settings.timezone)


def today() -> date:
    return datetime.now(TZ).date()


def q2(value) -> Decimal:
    return Decimal(value).quantize(TWO, rounding=ROUND_HALF_UP)


def get_or_404(db: Session, model, obj_id: int, label: str | None = None):
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(status_code=404, detail=f"{label or model.__name__} not found")
    return obj


def get_app_settings(db: Session) -> AppSetting:
    s = db.get(AppSetting, 1)
    if s is None:
        s = AppSetting(id=1)
        db.add(s)
        db.flush()
    return s


def commit_or_409(db: Session, message: str = "Record conflicts with an existing one"):
    """Commit, translating unique / FK violations into a 409 for the client."""
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        detail = message
        text = str(exc.orig).lower()
        if "foreign key" in text:
            detail = "This record is referenced by other data and cannot be changed/removed"
        raise HTTPException(status_code=409, detail=detail)


def day_range(date_from: date | None, date_to: date | None, default_days: int = 0):
    """Return (start_dt, end_dt_exclusive, date_from, date_to) for inclusive date filters."""
    if date_to is None:
        date_to = today()
    if date_from is None:
        date_from = date_to - timedelta(days=default_days)
    if date_from > date_to:
        raise HTTPException(status_code=400, detail="date_from must be on or before date_to")
    start = datetime.combine(date_from, time.min, tzinfo=TZ)
    end = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=TZ)
    return start, end, date_from, date_to
