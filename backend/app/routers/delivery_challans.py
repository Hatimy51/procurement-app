from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app import models
from app.security import get_current_user
from app.schemas_delivery_challans import (
    ReadyQuoteOut, QuoteLineDeliveryStatus, DeliveryChallanCreate,
    DeliveryChallanDraftUpdate, DeliveryChallanListItemOut, DeliveryChallanDetailOut,
    DCLineItemOut,
)

router = APIRouter(prefix="/api/delivery-challans", tags=["delivery-challans"])

ELIGIBLE_QUOTE_STATUSES = (models.QuoteStatus.approved, models.QuoteStatus.sent)


def _dc_number(dc_id: str) -> str:
    return f"DC-{dc_id.replace('-', '')[:8].upper()}"


def _delivered_so_far(db: Session, quote_line_item_id: str) -> Decimal:
    """Only DISPATCHED challans count against remaining quantity — a draft
    hasn't actually left the building yet, so it shouldn't block someone
    else's delivery in the meantime."""
    total = (
        db.query(func.coalesce(func.sum(models.DeliveryChallanLineItem.quantity_delivered), 0))
        .join(models.DeliveryChallan)
        .filter(
            models.DeliveryChallanLineItem.quote_line_item_id == quote_line_item_id,
            models.DeliveryChallan.status == models.DCStatus.dispatched,
        )
        .scalar()
    )
    return Decimal(total or 0)


def _line_status(db: Session, qli: models.QuoteLineItem) -> QuoteLineDeliveryStatus:
    delivered = _delivered_so_far(db, qli.id)
    return QuoteLineDeliveryStatus(
        quote_line_item_id=qli.id,
        description=qli.description,
        spec=qli.spec,
        unit=qli.unit,
        quantity_quoted=qli.quantity,
        quantity_already_delivered=delivered,
        quantity_remaining=qli.quantity - delivered,
    )


def _detail_out(dc: models.DeliveryChallan) -> DeliveryChallanDetailOut:
    return DeliveryChallanDetailOut(
        id=dc.id,
        dc_number=dc.dc_number,
        status=dc.status.value if hasattr(dc.status, 'value') else dc.status,
        customer_quote_id=dc.customer_quote_id,
        quote_number=dc.customer_quote.quote_number if dc.customer_quote else None,
        customer_name=dc.customer_quote.customer.name if dc.customer_quote and dc.customer_quote.customer else None,
        site_name=dc.customer_quote.site.name if dc.customer_quote and dc.customer_quote.site else None,
        notes=dc.notes,
        created_at=dc.created_at,
        created_by=dc.created_by,
        updated_by=dc.updated_by,
        updated_at=dc.updated_at,
        dispatched_at=dc.dispatched_at,
        items=[
            DCLineItemOut(
                id=li.id,
                quote_line_item_id=li.quote_line_item_id,
                description=li.description,
                spec=li.spec,
                unit=li.unit,
                quantity_delivered=li.quantity_delivered,
            )
            for li in dc.line_items
        ],
    )


@router.get("/ready-quotes", response_model=list[ReadyQuoteOut])
def list_ready_quotes(db: Session = Depends(get_db)):
    """Approved/sent quotes that still have undelivered quantity on at
    least one line."""
    quotes = (
        db.query(models.Quote)
        .filter(models.Quote.status.in_(ELIGIBLE_QUOTE_STATUSES))
        .order_by(models.Quote.created_at.desc())
        .all()
    )
    out = []
    for q in quotes:
        remaining_count = sum(
            1 for li in q.line_items if (li.quantity - _delivered_so_far(db, li.id)) > 0
        )
        if remaining_count == 0:
            continue
        enquiry = q.enquiry
        out.append(ReadyQuoteOut(
            id=q.id,
            quote_number=q.quote_number,
            customer_name=enquiry.site.customer.name if enquiry and enquiry.site and enquiry.site.customer else "Unknown customer",
            site_name=enquiry.site.name if enquiry and enquiry.site else "Unknown site",
            lines_remaining=remaining_count,
        ))
    return out


@router.get("/quote/{quote_id}/lines", response_model=list[QuoteLineDeliveryStatus])
def get_quote_delivery_status(quote_id: str, db: Session = Depends(get_db)):
    """Powers the 'New Delivery Challan' form: shows quoted/delivered/
    remaining per line so the Purchaser knows what's left before typing
    this batch's quantity."""
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(404, "Quote not found")
    return [_line_status(db, li) for li in quote.line_items]


def _validate_items_against_remaining(db: Session, quote: models.Quote, items: list):
    """Shared validation for create + draft-update: every submitted line
    must belong to this quote and not exceed what's actually still
    remaining right now."""
    if not items:
        raise HTTPException(400, "A delivery challan needs at least one item.")

    qli_by_id = {li.id: li for li in quote.line_items}
    for item in items:
        qli = qli_by_id.get(item.quote_line_item_id)
        if not qli:
            raise HTTPException(400, "One of the items doesn't belong to this quote.")
        if item.quantity_delivered <= 0:
            raise HTTPException(400, f"Quantity for '{qli.description}' must be greater than zero.")
        remaining = qli.quantity - _delivered_so_far(db, qli.id)
        if item.quantity_delivered > remaining:
            raise HTTPException(
                400,
                f"'{qli.description}': trying to deliver {item.quantity_delivered} {qli.unit}, "
                f"but only {remaining} {qli.unit} remains undelivered on this quote.",
            )


@router.get("", response_model=list[DeliveryChallanListItemOut])
def list_delivery_challans(db: Session = Depends(get_db)):
    dcs = db.query(models.DeliveryChallan).order_by(models.DeliveryChallan.created_at.desc()).all()
    out = []
    for dc in dcs:
        quote = dc.customer_quote
        enquiry = quote.enquiry if quote else None
        out.append(DeliveryChallanListItemOut(
            id=dc.id,
            dc_number=dc.dc_number,
            status=dc.status.value if hasattr(dc.status, "value") else dc.status,
            quote_number=quote.quote_number if quote else "—",
            customer_name=enquiry.site.customer.name if enquiry and enquiry.site and enquiry.site.customer else "Unknown customer",
            site_name=enquiry.site.name if enquiry and enquiry.site else "Unknown site",
            item_count=len(dc.line_items),
            created_at=dc.created_at,
        ))
    return out


@router.post("", response_model=DeliveryChallanDetailOut)
def create_delivery_challan(payload: DeliveryChallanCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    quote = db.query(models.Quote).filter(models.Quote.id == payload.customer_quote_id).first()
    if not quote:
        raise HTTPException(404, "Quote not found")
    if quote.status not in ELIGIBLE_QUOTE_STATUSES:
        raise HTTPException(400, "Only approved or sent quotes can have a delivery challan raised against them.")

    # Idempotency check: prevent duplicate draft Delivery Challans on the same quote
    existing_draft = (
        db.query(models.DeliveryChallan)
        .filter(
            models.DeliveryChallan.customer_quote_id == quote.id,
            models.DeliveryChallan.status == models.DCStatus.draft,
        )
        .first()
    )
    if existing_draft:
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"A draft Delivery Challan (#{existing_draft.dc_number}) is already open for this Quote.",
                "error_code": "DRAFT_ALREADY_EXISTS",
                "existing_id": existing_draft.id,
                "existing_number": existing_draft.dc_number,
                "document_type": "delivery_challan",
            },
        )

    # Check if quote is already fully delivered
    total_remaining = sum(
        max(Decimal(0), li.quantity - _delivered_so_far(db, li.id))
        for li in quote.line_items
    )
    if total_remaining <= 0:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "All items on this Quote have already been fully delivered.",
                "error_code": "FULLY_FULFILLED",
            },
        )

    _validate_items_against_remaining(db, quote, payload.items)

    qli_by_id = {li.id: li for li in quote.line_items}
    dc = models.DeliveryChallan(
        dc_number="",
        customer_quote_id=quote.id,
        vehicle_number=payload.vehicle_number,
        driver_name=payload.driver_name,
        notes=payload.notes,
        status=models.DCStatus.draft,
        created_by=user.name,
    )
    db.add(dc)
    db.flush()
    dc.dc_number = _dc_number(dc.id)

    for item in payload.items:
        qli = qli_by_id[item.quote_line_item_id]
        db.add(models.DeliveryChallanLineItem(
            dc_id=dc.id,
            quote_line_item_id=qli.id,
            description=qli.description,
            spec=qli.spec,
            unit=qli.unit,
            quantity_delivered=item.quantity_delivered,
        ))

    db.commit()
    db.refresh(dc)
    return _detail_out(dc)


@router.get("/{dc_id}", response_model=DeliveryChallanDetailOut)
def get_delivery_challan(dc_id: str, db: Session = Depends(get_db)):
    dc = db.query(models.DeliveryChallan).filter(models.DeliveryChallan.id == dc_id).first()
    if not dc:
        raise HTTPException(404, "Delivery challan not found")
    return _detail_out(dc)


@router.put("/{dc_id}", response_model=DeliveryChallanDetailOut)
def update_delivery_challan_draft(dc_id: str, payload: DeliveryChallanDraftUpdate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    dc = db.query(models.DeliveryChallan).filter(models.DeliveryChallan.id == dc_id).first()
    if not dc:
        raise HTTPException(404, "Delivery challan not found")
    if dc.status != models.DCStatus.draft:
        raise HTTPException(400, "Only draft delivery challans can be edited.")

    quote = dc.customer_quote
    _validate_items_against_remaining(db, quote, payload.items)

    dc.vehicle_number = payload.vehicle_number
    dc.driver_name = payload.driver_name
    dc.notes = payload.notes
    dc.updated_by = user.name
    dc.updated_at = datetime.utcnow()
    db.query(models.DeliveryChallanLineItem).filter(models.DeliveryChallanLineItem.dc_id == dc.id).delete()

    qli_by_id = {li.id: li for li in quote.line_items}
    for item in payload.items:
        qli = qli_by_id[item.quote_line_item_id]
        db.add(models.DeliveryChallanLineItem(
            dc_id=dc.id,
            quote_line_item_id=qli.id,
            description=qli.description,
            spec=qli.spec,
            unit=qli.unit,
            quantity_delivered=item.quantity_delivered,
        ))

    db.commit()
    db.refresh(dc)
    return _detail_out(dc)


@router.post("/{dc_id}/mark-dispatched", response_model=DeliveryChallanDetailOut)
def mark_dispatched(dc_id: str, db: Session = Depends(get_db)):
    """Re-validates against remaining quantity at the moment of dispatch —
    not just at creation — since another challan for the same quote could
    have been dispatched in between, consuming the stock this one is
    counting on."""
    dc = db.query(models.DeliveryChallan).filter(models.DeliveryChallan.id == dc_id).first()
    if not dc:
        raise HTTPException(404, "Delivery challan not found")
    if dc.status != models.DCStatus.draft:
        raise HTTPException(400, "Only draft delivery challans can be marked as dispatched.")

    for li in dc.line_items:
        remaining = li.quote_line_item.quantity - _delivered_so_far(db, li.quote_line_item_id)
        if li.quantity_delivered > remaining:
            raise HTTPException(
                400,
                f"'{li.description}': only {remaining} {li.unit} remains undelivered now — "
                f"another delivery may have gone out since this draft was created. Please adjust before dispatching.",
            )

    dc.status = models.DCStatus.dispatched
    dc.dispatched_at = datetime.utcnow()
    db.commit()
    db.refresh(dc)
    return _detail_out(dc)


@router.delete("/{dc_id}")
def delete_delivery_challan(dc_id: str, db: Session = Depends(get_db)):
    dc = db.query(models.DeliveryChallan).filter(models.DeliveryChallan.id == dc_id).first()
    if not dc:
        raise HTTPException(404, "Delivery challan not found")
    if dc.status != models.DCStatus.draft:
        raise HTTPException(400, "Only draft delivery challans can be deleted.")

    db.delete(dc)
    db.commit()
    return {"deleted": True, "id": dc_id}
