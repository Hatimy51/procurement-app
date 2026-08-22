from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app.schemas_enquiry_review import (
    EnquiryItemUpdate, EnquiryDetailOut, EnquiryItemWithPrice
)

router = APIRouter(prefix="/api/enquiries", tags=["enquiry-review"])


def _price_status_for_item(db: Session, item: models.EnquiryItem):
    """
    Mirrors the v1 flow's price-lookup rule: matched to a product + price
    found -> suggest it; matched but no price -> Price Missing; not matched
    to any product yet -> unmatched (can't price it until it's linked).
    """
    if not item.product_id:
        return None, "unmatched"

    latest = (
        db.query(models.PriceEntry)
        .filter(models.PriceEntry.product_id == item.product_id)
        .order_by(models.PriceEntry.date.desc())
        .first()
    )
    if latest and latest.selling_price is not None:
        return latest.selling_price, "matched"
    return None, "price_missing"


@router.get("/list")
def list_enquiries(db: Session = Depends(get_db)):
    """Powers the Enquiry Review screen's list/inbox view."""
    enquiries = db.query(models.Enquiry).order_by(models.Enquiry.created_at.desc()).all()
    out = []
    for e in enquiries:
        site = e.site
        out.append({
            "id": e.id,
            "status": e.status.value if hasattr(e.status, "value") else e.status,
            "site_name": site.name if site else "Unknown site",
            "customer_name": site.customer.name if site and site.customer else "Unknown customer",
            "item_count": len(e.items),
            "created_at": e.created_at,
        })
    return out


@router.get("/{enquiry_id}/detail", response_model=EnquiryDetailOut)
def get_enquiry_detail(enquiry_id: str, db: Session = Depends(get_db)):
    """Powers the review form: extracted items + editable fields + price status per item."""
    enquiry = db.query(models.Enquiry).filter(models.Enquiry.id == enquiry_id).first()
    if not enquiry:
        raise HTTPException(404, "Enquiry not found")

    items_out = []
    for item in enquiry.items:
        price, status = _price_status_for_item(db, item)
        items_out.append(EnquiryItemWithPrice(
            id=item.id,
            description=item.description,
            spec=item.spec,
            brand=item.brand,
            quantity=item.quantity,
            unit=item.unit,
            product_id=item.product_id,
            suggested_price=price,
            price_status=status,
        ))

    return EnquiryDetailOut(
        id=enquiry.id,
        status=enquiry.status.value if hasattr(enquiry.status, "value") else enquiry.status,
        site_name=enquiry.site.name if enquiry.site else "Unknown site",
        customer_name=enquiry.site.customer.name if enquiry.site and enquiry.site.customer else "Unknown customer",
        extraction_confidence=enquiry.extraction_confidence,
        raw_source=enquiry.raw_source or "",
        items=items_out,
    )


@router.put("/{enquiry_id}/items/{item_id}")
def update_enquiry_item(
    enquiry_id: str, item_id: str, payload: EnquiryItemUpdate, db: Session = Depends(get_db)
):
    """
    The human-correction step (v1 flow step 3) — Purchaser fixes whatever the
    extraction got wrong before anything downstream (pricing, quoting) happens.
    Also where an item gets linked to a Product (product_id) so pricing can work.
    """
    item = (
        db.query(models.EnquiryItem)
        .filter(models.EnquiryItem.id == item_id, models.EnquiryItem.enquiry_id == enquiry_id)
        .first()
    )
    if not item:
        raise HTTPException(404, "Enquiry item not found")

    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    db.commit()

    price, status = _price_status_for_item(db, item)
    return {
        "id": item.id,
        "description": item.description,
        "spec": item.spec,
        "brand": item.brand,
        "quantity": item.quantity,
        "unit": item.unit,
        "product_id": item.product_id,
        "suggested_price": price,
        "price_status": status,
    }


@router.post("/{enquiry_id}/mark-reviewed")
def mark_reviewed(enquiry_id: str, db: Session = Depends(get_db)):
    """Advances the enquiry past the human-review gate once the Purchaser is satisfied."""
    enquiry = db.query(models.Enquiry).filter(models.Enquiry.id == enquiry_id).first()
    if not enquiry:
        raise HTTPException(404, "Enquiry not found")
    enquiry.status = models.EnquiryStatus.reviewed
    db.commit()
    return {"id": enquiry.id, "status": enquiry.status.value}
