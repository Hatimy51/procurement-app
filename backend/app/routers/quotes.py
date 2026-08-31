from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app.schemas_quotes import (
    ReadyEnquiryOut, QuoteListItemOut, QuoteDetailOut, QuoteLineItemOut,
    QuoteDraftUpdate, QuoteApproveRequest,
)

router = APIRouter(prefix="/api/quotes", tags=["quotes"])


def _latest_selling_price(db: Session, product_id: str | None) -> Decimal | None:
    if not product_id:
        return None
    latest = (
        db.query(models.PriceEntry)
        .filter(models.PriceEntry.product_id == product_id)
        .order_by(models.PriceEntry.date.desc())
        .first()
    )
    return latest.selling_price if latest else None


def _quote_number(quote_id: str) -> str:
    return f"Q-{quote_id.replace('-', '')[:8].upper()}"


def _totals(line_items: list[models.QuoteLineItem]):
    subtotal = Decimal(0)
    total_gst = Decimal(0)
    missing = 0
    for li in line_items:
        if li.unit_price is None:
            missing += 1
            continue
        line_total = li.unit_price * li.quantity
        subtotal += line_total
        if li.gst_percent:
            total_gst += line_total * (li.gst_percent / Decimal(100))
    return subtotal, total_gst, subtotal + total_gst, missing


def _detail_out(db: Session, quote: models.Quote) -> QuoteDetailOut:
    enquiry = quote.enquiry
    subtotal, total_gst, grand_total, missing = _totals(quote.line_items)
    return QuoteDetailOut(
        id=quote.id,
        quote_number=quote.quote_number,
        status=quote.status.value if hasattr(quote.status, "value") else quote.status,
        site_name=enquiry.site.name if enquiry.site else "Unknown site",
        customer_name=enquiry.site.customer.name if enquiry.site and enquiry.site.customer else "Unknown customer",
        notes=quote.notes,
        created_at=quote.created_at,
        approved_by_name=quote.approved_by_name,
        approved_at=quote.approved_at,
        sent_at=quote.sent_at,
        items=[
            QuoteLineItemOut(
                id=li.id, description=li.description, spec=li.spec,
                quantity=li.quantity, unit=li.unit, gst_percent=li.gst_percent,
                unit_price=li.unit_price,
            )
            for li in quote.line_items
        ],
        subtotal=subtotal, total_gst=total_gst, grand_total=grand_total,
        items_price_missing=missing,
    )


@router.get("/ready-enquiries", response_model=list[ReadyEnquiryOut])
def list_ready_enquiries(db: Session = Depends(get_db)):
    """Reviewed enquiries that don't have a quote yet — the 'ready to
    quote' queue. Once an enquiry has a quote, it drops off this list and
    shows up in the quotes list instead (via its status: quoted/approved/sent)."""
    quoted_enquiry_ids = {q.enquiry_id for q in db.query(models.Quote.enquiry_id).all()}
    enquiries = (
        db.query(models.Enquiry)
        .filter(models.Enquiry.status == models.EnquiryStatus.reviewed)
        .order_by(models.Enquiry.created_at.desc())
        .all()
    )
    out = []
    for e in enquiries:
        if e.id in quoted_enquiry_ids:
            continue
        missing = sum(1 for i in e.items if _latest_selling_price(db, i.product_id) is None)
        out.append(ReadyEnquiryOut(
            id=e.id,
            site_name=e.site.name if e.site else "Unknown site",
            customer_name=e.site.customer.name if e.site and e.site.customer else "Unknown customer",
            item_count=len(e.items),
            items_price_missing=missing,
            created_at=e.created_at,
        ))
    return out


@router.get("", response_model=list[QuoteListItemOut])
def list_quotes(db: Session = Depends(get_db)):
    """Powers the Customer Quotes list — every quote ever generated,
    across all statuses."""
    quotes = db.query(models.Quote).order_by(models.Quote.created_at.desc()).all()
    out = []
    for q in quotes:
        _, _, grand_total, _ = _totals(q.line_items)
        enquiry = q.enquiry
        out.append(QuoteListItemOut(
            id=q.id,
            quote_number=q.quote_number,
            status=q.status.value if hasattr(q.status, "value") else q.status,
            site_name=enquiry.site.name if enquiry and enquiry.site else "Unknown site",
            customer_name=enquiry.site.customer.name if enquiry and enquiry.site and enquiry.site.customer else "Unknown customer",
            item_count=len(q.line_items),
            grand_total=grand_total,
            created_at=q.created_at,
        ))
    return out


@router.post("/generate", response_model=QuoteDetailOut)
def generate_quote(enquiry_id: str, db: Session = Depends(get_db)):
    """Turns a reviewed Enquiry into a draft Quote — snapshotting each item's
    description/spec/qty/unit, current price (if any), and GST % at this
    moment. Idempotent: if a quote already exists for this enquiry, returns
    that one instead of creating a duplicate."""
    existing = db.query(models.Quote).filter(models.Quote.enquiry_id == enquiry_id).first()
    if existing:
        return _detail_out(db, existing)

    enquiry = db.query(models.Enquiry).filter(models.Enquiry.id == enquiry_id).first()
    if not enquiry:
        raise HTTPException(404, "Enquiry not found")
    if not enquiry.items:
        raise HTTPException(400, "This enquiry has no items to quote.")

    quote = models.Quote(enquiry_id=enquiry.id, quote_number="", status=models.QuoteStatus.draft)
    db.add(quote)
    db.flush()
    quote.quote_number = _quote_number(quote.id)

    for item in enquiry.items:
        db.add(models.QuoteLineItem(
            quote_id=quote.id,
            enquiry_item_id=item.id,
            description=item.description,
            spec=item.spec,
            quantity=item.quantity,
            unit=item.unit,
            gst_percent=item.product.gst_percent if item.product_id and item.product else None,
            unit_price=_latest_selling_price(db, item.product_id),
        ))

    enquiry.status = models.EnquiryStatus.quoted
    db.commit()
    db.refresh(quote)
    return _detail_out(db, quote)


@router.get("/{quote_id}", response_model=QuoteDetailOut)
def get_quote_detail(quote_id: str, db: Session = Depends(get_db)):
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(404, "Quote not found")
    return _detail_out(db, quote)


@router.put("/{quote_id}", response_model=QuoteDetailOut)
def update_quote_draft(quote_id: str, payload: QuoteDraftUpdate, db: Session = Depends(get_db)):
    """The 'Save Draft' action — updates notes and any edited line-item
    prices in one call. Only allowed while the quote is still a draft;
    approved/sent quotes are locked (use revert-to-draft first)."""
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(404, "Quote not found")
    if quote.status != models.QuoteStatus.draft:
        raise HTTPException(400, "Only draft quotes can be edited. Revert to draft first.")

    quote.notes = payload.notes

    by_id = {li.id: li for li in quote.line_items}
    for item in payload.items:
        li = by_id.get(item.id)
        if not li:
            continue  # skip silently, same pattern as Quote History's bulk update
        li.unit_price = item.unit_price

    db.commit()
    db.refresh(quote)
    return _detail_out(db, quote)


@router.post("/{quote_id}/approve", response_model=QuoteDetailOut)
def approve_quote(quote_id: str, payload: QuoteApproveRequest, db: Session = Depends(get_db)):
    """Approver sign-off. Blocked if any line item is still missing a price
    — a quote shouldn't go out the door with unpriced items."""
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(404, "Quote not found")
    if quote.status != models.QuoteStatus.draft:
        raise HTTPException(400, "Only draft quotes can be approved.")
    if not payload.approved_by_name.strip():
        raise HTTPException(400, "Approver name is required.")

    missing = sum(1 for li in quote.line_items if li.unit_price is None)
    if missing:
        raise HTTPException(400, f"{missing} item(s) still have no price. Fill those in before approving.")

    quote.status = models.QuoteStatus.approved
    quote.approved_by_name = payload.approved_by_name.strip()
    quote.approved_at = datetime.utcnow()
    quote.enquiry.status = models.EnquiryStatus.approved
    db.commit()
    db.refresh(quote)
    return _detail_out(db, quote)


@router.post("/{quote_id}/revert-to-draft", response_model=QuoteDetailOut)
def revert_to_draft(quote_id: str, db: Session = Depends(get_db)):
    """Sends an approved (but not yet sent) quote back to draft — e.g. the
    Approver found something that needs fixing first."""
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(404, "Quote not found")
    if quote.status != models.QuoteStatus.approved:
        raise HTTPException(400, "Only approved (not yet sent) quotes can be reverted to draft.")

    quote.status = models.QuoteStatus.draft
    quote.approved_by_name = None
    quote.approved_at = None
    quote.enquiry.status = models.EnquiryStatus.quoted
    db.commit()
    db.refresh(quote)
    return _detail_out(db, quote)


@router.post("/{quote_id}/mark-sent", response_model=QuoteDetailOut)
def mark_sent(quote_id: str, db: Session = Depends(get_db)):
    """The manual 'Send' step (v1 keeps this human-triggered, not automated
    email dispatch — see spec's safety principle on binding documents).
    Once sent, a quote is locked: no more edits, no delete."""
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(404, "Quote not found")
    if quote.status != models.QuoteStatus.approved:
        raise HTTPException(400, "Only approved quotes can be marked as sent.")

    quote.status = models.QuoteStatus.sent
    quote.sent_at = datetime.utcnow()
    quote.enquiry.status = models.EnquiryStatus.sent
    db.commit()
    db.refresh(quote)
    return _detail_out(db, quote)


@router.delete("/{quote_id}")
def delete_quote(quote_id: str, db: Session = Depends(get_db)):
    """Draft quotes only — approved/sent quotes are real documents and are
    protected the same way price history and sent records are elsewhere in
    the app. Deleting a draft sends its enquiry back to 'reviewed' so it
    reappears in the ready-to-quote queue."""
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(404, "Quote not found")
    if quote.status != models.QuoteStatus.draft:
        raise HTTPException(400, "Only draft quotes can be deleted.")

    enquiry = quote.enquiry
    db.delete(quote)
    if enquiry:
        enquiry.status = models.EnquiryStatus.reviewed
    db.commit()
    return {"deleted": True, "id": quote_id}
