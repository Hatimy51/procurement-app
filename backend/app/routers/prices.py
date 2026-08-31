from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas

router = APIRouter(prefix="/api/prices", tags=["prices"])


@router.post("", response_model=schemas.PriceEntryOut)
def add_price_entry(payload: schemas.PriceEntryCreate, db: Session = Depends(get_db)):
    """
    Adds a new Price Entry for a product — either a manual entry (Purchaser
    override) or the result of a supplier quote being ingested. This is the
    action that makes the master price list "self-building" per the spec.
    """
    product = db.query(models.Product).filter(models.Product.id == payload.product_id).first()
    if not product:
        raise HTTPException(404, "Product not found")

    entry = models.PriceEntry(**payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/product/{product_id}", response_model=list[schemas.PriceEntryOut])
def price_history(product_id: str, db: Session = Depends(get_db)):
    return (
        db.query(models.PriceEntry)
        .filter(models.PriceEntry.product_id == product_id)
        .order_by(models.PriceEntry.date.desc())
        .all()
    )


@router.get("/product/{product_id}/latest", response_model=schemas.PriceEntryOut | None)
def latest_price(product_id: str, db: Session = Depends(get_db)):
    """
    Used by the enquiry-pricing flow: found -> suggest last price,
    not found -> the caller flags the item as 'Price Missing'.
    """
    return (
        db.query(models.PriceEntry)
        .filter(models.PriceEntry.product_id == product_id)
        .order_by(models.PriceEntry.date.desc())
        .first()
    )


@router.put("/{price_entry_id}", response_model=schemas.PriceEntryOut)
def update_price_entry(price_entry_id: str, payload: schemas.PriceEntryUpdate, db: Session = Depends(get_db)):
    """
    Corrects a SPECIFIC existing price entry in place, rather than adding
    a new one — used right after RFQ reply ingestion, where a supplier's
    sheet may have given a cost price but no selling price, so the
    Purchaser fills that gap in on the same entry instead of leaving a
    second, disconnected record behind.
    """
    entry = db.query(models.PriceEntry).filter(models.PriceEntry.id == price_entry_id).first()
    if not entry:
        raise HTTPException(404, "Price entry not found")
    if payload.cost_price is not None:
        entry.cost_price = payload.cost_price
    if payload.selling_price is not None:
        entry.selling_price = payload.selling_price
    db.commit()
    db.refresh(entry)
    return entry
