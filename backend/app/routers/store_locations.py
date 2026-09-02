from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from app.database import get_db
from app import models
from app.security import get_current_user

router = APIRouter(prefix="/api/store-locations", tags=["store-locations"])


class StoreLocationCreate(BaseModel):
    name: str
    area: Optional[str] = None
    address: Optional[str] = None


class StoreLocationUpdate(BaseModel):
    name: Optional[str] = None
    area: Optional[str] = None
    address: Optional[str] = None
    linked_user_id: Optional[str] = None   # assign a store-role user to this location


class StoreLocationOut(BaseModel):
    id: str
    name: str
    area: Optional[str]
    address: Optional[str]
    created_at: datetime
    linked_users: list[dict]

    class Config:
        from_attributes = True


def _sl_out(sl: models.StoreLocation) -> dict:
    return {
        "id": sl.id,
        "name": sl.name,
        "area": sl.area,
        "address": sl.address,
        "created_at": sl.created_at,
        "linked_users": [
            {"id": u.id, "name": u.name, "email": u.email}
            for u in sl.users
        ],
    }


def _require_purchase_or_manager(user: models.User = Depends(get_current_user)) -> models.User:
    if user.role.value not in ("purchase", "manager"):
        raise HTTPException(403, "Only Purchase or Manager can manage store locations.")
    return user


@router.get("")
def list_store_locations(
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns all store locations. Accessible by all authenticated roles
    so the store dropdown on PO form works for purchase users."""
    locations = db.query(models.StoreLocation).order_by(models.StoreLocation.name).all()
    return [_sl_out(sl) for sl in locations]


@router.post("")
def create_store_location(
    payload: StoreLocationCreate,
    user: models.User = Depends(_require_purchase_or_manager),
    db: Session = Depends(get_db),
):
    """Create a new store location. Name must be unique (case-insensitive check)."""
    # Case-insensitive duplicate check
    existing = db.query(models.StoreLocation).filter(
        models.StoreLocation.name.ilike(payload.name.strip())
    ).first()
    if existing:
        return _sl_out(existing)   # return existing match rather than duplicating

    sl = models.StoreLocation(
        name=payload.name.strip(),
        area=payload.area,
        address=payload.address,
    )
    db.add(sl)
    db.commit()
    db.refresh(sl)
    return _sl_out(sl)


@router.patch("/{location_id}")
def update_store_location(
    location_id: str,
    payload: StoreLocationUpdate,
    user: models.User = Depends(_require_purchase_or_manager),
    db: Session = Depends(get_db),
):
    """Update store location details or link a store-role user to this location."""
    sl = db.query(models.StoreLocation).filter(models.StoreLocation.id == location_id).first()
    if not sl:
        raise HTTPException(404, "Store location not found.")

    if payload.name is not None:
        sl.name = payload.name.strip()
    if payload.area is not None:
        sl.area = payload.area
    if payload.address is not None:
        sl.address = payload.address

    # Link a store user to this location
    if payload.linked_user_id is not None:
        store_user = db.query(models.User).filter(models.User.id == payload.linked_user_id).first()
        if not store_user:
            raise HTTPException(404, "User not found.")
        if store_user.role != models.UserRole.store:
            raise HTTPException(400, "Only store-role users can be linked to a store location.")
        store_user.store_location_id = location_id

    db.commit()
    db.refresh(sl)
    return _sl_out(sl)


@router.delete("/{location_id}")
def delete_store_location(
    location_id: str,
    user: models.User = Depends(_require_purchase_or_manager),
    db: Session = Depends(get_db),
):
    sl = db.query(models.StoreLocation).filter(models.StoreLocation.id == location_id).first()
    if not sl:
        raise HTTPException(404, "Store location not found.")
    # Unlink any store users first
    db.query(models.User).filter(models.User.store_location_id == location_id).update(
        {"store_location_id": None}
    )
    db.delete(sl)
    db.commit()
    return {"deleted": True, "id": location_id}
