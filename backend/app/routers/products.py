from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.database import get_db
from app import models, schemas

router = APIRouter(prefix="/api/products", tags=["products"])


@router.get("", response_model=list[schemas.ProductOut])
def list_products(
    search: str | None = Query(None, description="Search by name, category, or spec"),
    db: Session = Depends(get_db),
):
    """Powers the Product/Price List screen: view + search."""
    q = db.query(models.Product)
    if search:
        like = f"%{search}%"
        q = q.filter(
            or_(
                models.Product.name.ilike(like),
                models.Product.category.ilike(like),
                models.Product.spec.ilike(like),
            )
        )
    return q.order_by(models.Product.name).all()


@router.post("", response_model=schemas.ProductOut)
def create_product(payload: schemas.ProductCreate, db: Session = Depends(get_db)):
    product = models.Product(**payload.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.get("/{product_id}", response_model=schemas.ProductOut)
def get_product(product_id: str, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(404, "Product not found")
    return product


@router.put("/{product_id}", response_model=schemas.ProductOut)
def update_product(product_id: str, payload: schemas.ProductCreate, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(404, "Product not found")
    for field, value in payload.model_dump().items():
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return product


@router.delete("/{product_id}")
def delete_product(product_id: str, db: Session = Depends(get_db)):
    """
    Deletes a product along with its price history. Any enquiry items that
    were linked to it get unlinked (not deleted) rather than left pointing
    at something that no longer exists — they'll show as "not linked" again,
    same as before they were ever matched.

    Also cleans up product_supplier_links and rfqs for this product — both
    have a required (non-nullable) foreign key to products, so leaving them
    in place made every delete fail with a foreign-key violation for any
    product that had ever been linked to a supplier or had an RFQ sent for
    it. Supplier links are just a preference and are safe to drop outright.
    RFQs are deleted too, same as when a Supplier is deleted (see
    suppliers.py) — an RFQ record makes no sense once the product it was
    asking about no longer exists.
    """
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(404, "Product not found")

    db.query(models.EnquiryItem).filter(
        models.EnquiryItem.product_id == product_id
    ).update({"product_id": None})
    db.query(models.PriceEntry).filter(
        models.PriceEntry.product_id == product_id
    ).delete()
    db.query(models.ProductSupplierLink).filter(
        models.ProductSupplierLink.product_id == product_id
    ).delete()
    db.query(models.RFQ).filter(
        models.RFQ.product_id == product_id
    ).delete()

    db.delete(product)
    db.commit()
    return {"deleted": True, "id": product_id}
