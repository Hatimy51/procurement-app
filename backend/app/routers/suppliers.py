from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app import models

router = APIRouter(prefix="/api/suppliers", tags=["suppliers"])


class SupplierCreate(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None


class SupplierOut(BaseModel):
    id: str
    name: str
    email: str | None
    phone: str | None

    class Config:
        from_attributes = True


@router.get("", response_model=list[SupplierOut])
def list_suppliers(db: Session = Depends(get_db)):
    return db.query(models.Supplier).order_by(models.Supplier.name).all()


@router.post("", response_model=SupplierOut)
def create_supplier(payload: SupplierCreate, db: Session = Depends(get_db)):
    supplier = models.Supplier(**payload.model_dump())
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.put("/{supplier_id}", response_model=SupplierOut)
def update_supplier(supplier_id: str, payload: SupplierCreate, db: Session = Depends(get_db)):
    supplier = db.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(404, "Supplier not found")
    for field, value in payload.model_dump().items():
        setattr(supplier, field, value)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.delete("/{supplier_id}")
def delete_supplier(supplier_id: str, db: Session = Depends(get_db)):
    """
    Deletes a supplier along with any RFQs sent to them and those RFQs'
    supplier-quote replies. Products and their price history are
    untouched — a price a supplier once quoted stays on record even after
    the supplier itself is removed.
    """
    supplier = db.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(404, "Supplier not found")

    rfq_ids = [
        r.id for r in db.query(models.RFQ).filter(models.RFQ.supplier_id == supplier_id).all()
    ]
    if rfq_ids:
        db.query(models.SupplierQuote).filter(
            models.SupplierQuote.rfq_id.in_(rfq_ids)
        ).delete(synchronize_session=False)
        db.query(models.RFQ).filter(models.RFQ.id.in_(rfq_ids)).delete(synchronize_session=False)

    db.delete(supplier)
    db.commit()
    return {"deleted": True, "id": supplier_id, "rfqs_removed": len(rfq_ids)}
