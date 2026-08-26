from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app import models
from app.linking import replace_supplier_links, get_linked_supplier_ids_for_products

router = APIRouter(prefix="/api/suppliers", tags=["suppliers"])


class SupplierCreate(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None
    linked_product_ids: list[str] = []
    linked_categories: list[str] = []


def _supplier_out(db: Session, supplier: models.Supplier):
    product_links = (
        db.query(models.ProductSupplierLink)
        .filter(models.ProductSupplierLink.supplier_id == supplier.id)
        .all()
    )
    category_links = (
        db.query(models.CategorySupplierLink)
        .filter(models.CategorySupplierLink.supplier_id == supplier.id)
        .all()
    )
    return {
        "id": supplier.id,
        "name": supplier.name,
        "email": supplier.email,
        "phone": supplier.phone,
        "linked_product_ids": [link.product_id for link in product_links],
        "linked_categories": [link.category for link in category_links],
    }


@router.get("")
def list_suppliers(db: Session = Depends(get_db)):
    suppliers = db.query(models.Supplier).order_by(models.Supplier.name).all()
    return [_supplier_out(db, s) for s in suppliers]


@router.post("")
def create_supplier(payload: SupplierCreate, db: Session = Depends(get_db)):
    supplier = models.Supplier(name=payload.name, email=payload.email, phone=payload.phone)
    db.add(supplier)
    db.flush()  # get supplier.id before creating links
    replace_supplier_links(db, supplier.id, payload.linked_product_ids, payload.linked_categories)
    db.commit()
    db.refresh(supplier)
    return _supplier_out(db, supplier)


@router.put("/{supplier_id}")
def update_supplier(supplier_id: str, payload: SupplierCreate, db: Session = Depends(get_db)):
    supplier = db.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(404, "Supplier not found")
    supplier.name = payload.name
    supplier.email = payload.email
    supplier.phone = payload.phone
    replace_supplier_links(db, supplier_id, payload.linked_product_ids, payload.linked_categories)
    db.commit()
    db.refresh(supplier)
    return _supplier_out(db, supplier)


@router.delete("/{supplier_id}")
def delete_supplier(supplier_id: str, db: Session = Depends(get_db)):
    """
    Deletes a supplier along with any RFQs sent to them, those RFQs'
    supplier-quote replies, and this supplier's product/category links.
    Products and their price history are untouched — a price a supplier
    once quoted stays on record even after the supplier itself is removed.
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

    db.query(models.ProductSupplierLink).filter_by(supplier_id=supplier_id).delete()
    db.query(models.CategorySupplierLink).filter_by(supplier_id=supplier_id).delete()

    db.delete(supplier)
    db.commit()
    return {"deleted": True, "id": supplier_id, "rfqs_removed": len(rfq_ids)}


@router.get("/suggested")
def suggested_suppliers(
    product_ids: str = Query(..., description="Comma-separated product IDs"),
    db: Session = Depends(get_db),
):
    """
    Powers the RFQ wizard's supplier picker: suppliers linked (directly or
    via category) to any of the given products come first, everyone else
    after — both groups alphabetical within themselves.
    """
    ids = [pid for pid in product_ids.split(",") if pid]
    linked_ids = get_linked_supplier_ids_for_products(db, ids)

    suppliers = db.query(models.Supplier).order_by(models.Supplier.name).all()
    linked = [s for s in suppliers if s.id in linked_ids]
    unlinked = [s for s in suppliers if s.id not in linked_ids]

    def out(s, is_linked):
        return {"id": s.id, "name": s.name, "email": s.email, "phone": s.phone, "linked": is_linked}

    return [out(s, True) for s in linked] + [out(s, False) for s in unlinked]
