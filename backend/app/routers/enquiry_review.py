from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app.schemas_enquiry_review import (
    EnquiryItemUpdate, EnquiryDetailOut, EnquiryItemWithPrice
)
from app.matching import suggest_product_match, WEIGHT_PRESETS, DEFAULT_PRESET

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


def _item_out(db: Session, item: models.EnquiryItem):
    """Shared shape for returning a single enquiry item + its price status —
    used by several endpoints below so the frontend always sees the same
    structure whether an item was edited, linked, or newly created."""
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


def _create_product_from_item(db: Session, item: models.EnquiryItem) -> models.Product:
    """
    Creates a brand-new Product from an enquiry item's own fields — always a
    new product, no matching against existing ones by name (that's what the
    Import screen's dedupe-by-name does; this is the opposite: the Purchaser
    is explicitly saying "this is a new item we haven't priced before").
    """
    product = models.Product(
        name=item.description,
        category=None,
        spec=item.spec,
        unit=item.unit,
    )
    db.add(product)
    db.flush()
    item.product_id = product.id
    return product


@router.delete("/{enquiry_id}")
def delete_enquiry(enquiry_id: str, db: Session = Depends(get_db)):
    """Removes an enquiry entirely (its items go with it via cascade) —
    e.g. for test entries, duplicates, or ones entered by mistake."""
    enquiry = db.query(models.Enquiry).filter(models.Enquiry.id == enquiry_id).first()
    if not enquiry:
        raise HTTPException(404, "Enquiry not found")
    db.delete(enquiry)
    db.commit()
    return {"deleted": True, "id": enquiry_id}


@router.post("/{enquiry_id}/items/{item_id}/save-as-product")
def save_item_as_new_product(enquiry_id: str, item_id: str, db: Session = Depends(get_db)):
    """
    Saves ONE enquiry item as a brand-new Product (not linked to any
    existing one), then links this item to it — for when the Purchaser
    knows this is genuinely a new item, not a rename/variant of something
    already in the Product list.
    """
    item = (
        db.query(models.EnquiryItem)
        .filter(models.EnquiryItem.id == item_id, models.EnquiryItem.enquiry_id == enquiry_id)
        .first()
    )
    if not item:
        raise HTTPException(404, "Enquiry item not found")

    product = _create_product_from_item(db, item)
    db.commit()

    result = _item_out(db, item)
    result["created_product_id"] = product.id
    result["created_product_name"] = product.name
    return result


@router.post("/{enquiry_id}/save-all-as-products")
def save_all_items_as_products(enquiry_id: str, db: Session = Depends(get_db)):
    """
    Bulk version of the above — saves every item in the enquiry that isn't
    already linked to a product as a brand-new Product, in one action,
    instead of doing it one row at a time.
    """
    enquiry = db.query(models.Enquiry).filter(models.Enquiry.id == enquiry_id).first()
    if not enquiry:
        raise HTTPException(404, "Enquiry not found")

    created = 0
    skipped = 0
    for item in enquiry.items:
        if item.product_id:
            skipped += 1
            continue
        _create_product_from_item(db, item)
        created += 1
    db.commit()

    return {"products_created": created, "items_already_linked_skipped": skipped}


@router.get("/weight-presets")
def get_weight_presets():
    """So the frontend's priority dropdown always matches what the backend
    actually supports, instead of a hardcoded copy that could drift."""
    return {"presets": list(WEIGHT_PRESETS.keys()), "default": DEFAULT_PRESET}


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
def get_enquiry_detail(
    enquiry_id: str,
    weight_priority: str = Query(
        DEFAULT_PRESET,
        description=f"One of: {', '.join(WEIGHT_PRESETS.keys())}. Controls how the "
                    "name/spec/unit-priority suggestion is ranked for unmatched items.",
    ),
    db: Session = Depends(get_db),
):
    """Powers the review form: extracted items + editable fields + price status per item.
    For any item that ISN'T already linked to a product, also computes a
    suggested match (never auto-applied — the frontend shows it as a
    one-click confirm) using the chosen name/spec/unit weighting priority."""
    enquiry = db.query(models.Enquiry).filter(models.Enquiry.id == enquiry_id).first()
    if not enquiry:
        raise HTTPException(404, "Enquiry not found")

    items_out = []
    for item in enquiry.items:
        price, status = _price_status_for_item(db, item)
        suggestion = None
        if not item.product_id:
            suggestion = suggest_product_match(
                db, item.description, item.spec, item.unit, weight_preset=weight_priority
            )
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
            suggested_product_id=suggestion.product_id if suggestion else None,
            suggested_product_name=suggestion.product_name if suggestion else None,
            suggested_match_score=suggestion.score if suggestion else None,
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

    return _item_out(db, item)


@router.post("/{enquiry_id}/mark-reviewed")
def mark_reviewed(enquiry_id: str, db: Session = Depends(get_db)):
    """Advances the enquiry past the human-review gate once the Purchaser is satisfied."""
    enquiry = db.query(models.Enquiry).filter(models.Enquiry.id == enquiry_id).first()
    if not enquiry:
        raise HTTPException(404, "Enquiry not found")
    enquiry.status = models.EnquiryStatus.reviewed
    db.commit()
    return {"id": enquiry.id, "status": enquiry.status.value}
