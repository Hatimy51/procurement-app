from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app.security import get_current_user
from app.schemas_quotes import (
    ReadyEnquiryOut, QuoteListItemOut, QuoteDetailOut, QuoteLineItemOut,
    QuoteDraftUpdate,
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
def approve_quote(quote_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Manager sign-off — enforced by the router-level access dependency
    in main.py (any request to a path ending in /approve requires the
    Manager role), so by the time we're here the caller is guaranteed to
    be a Manager. Records who approved it from their real login, not a
    free-text field anyone could type into."""
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(404, "Quote not found")
    if quote.status != models.QuoteStatus.draft:
        raise HTTPException(400, "Only draft quotes can be approved.")

    missing = sum(1 for li in quote.line_items if li.unit_price is None)
    if missing:
        raise HTTPException(400, f"{missing} item(s) still have no price. Fill those in before approving.")

    quote.status = models.QuoteStatus.approved
    quote.approved_by_name = user.name
    quote.approved_by_user_id = user.id
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

# ---------------------------------------------------------------------------
# Vendor Quote Comparison Engine
# ---------------------------------------------------------------------------
from pydantic import BaseModel as _QuoteComparisonBaseModel, Field as _QuoteComparisonField
from typing import Dict as _QuoteComparisonDict, List as _QuoteComparisonList, Optional as _QuoteComparisonOptional

quote_comparison_router = APIRouter(
    prefix="/api/quote-comparison",
    tags=["Quote Comparison"],
)


class QuoteComparisonItem(_QuoteComparisonBaseModel):
    description: str
    quantity: float = _QuoteComparisonField(..., gt=0)
    unit_price: float = _QuoteComparisonField(..., ge=0)
    unit_of_measure: _QuoteComparisonOptional[str] = "unit"


class VendorQuoteComparisonInput(_QuoteComparisonBaseModel):
    supplier_name: str
    items: _QuoteComparisonList[QuoteComparisonItem]
    payment_terms: _QuoteComparisonOptional[str] = None
    estimated_delivery_days: _QuoteComparisonOptional[int] = None


class ComparisonRequest(_QuoteComparisonBaseModel):
    quotes: _QuoteComparisonList[VendorQuoteComparisonInput]


@quote_comparison_router.post("/analyze")
def analyze_vendor_quotes(payload: ComparisonRequest):
    """
    Compares two or more supplier quotes and returns:
      - total cost per supplier,
      - the cheapest complete single-supplier option,
      - the optimal split-award total by line item,
      - potential savings from splitting the award.
    """
    if len(payload.quotes) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least 2 vendor quotes are required for comparison.",
        )

    vendor_totals: _QuoteComparisonDict[str, float] = {}
    item_best_prices: _QuoteComparisonDict[str, dict] = {}
    reference_items = None

    for quote in payload.quotes:
        vendor = quote.supplier_name.strip()
        if not vendor:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Each vendor quote must have a supplier name.",
            )
        if vendor in vendor_totals:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Duplicate supplier name: {vendor}.",
            )

        vendor_totals[vendor] = 0.0

        current_items = {}
        for item in quote.items:
            item_key = item.description.strip().lower()
            if item_key in current_items:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Supplier '{vendor}' has a duplicate line item: {item.description.strip()}.",
                )
            current_items[item_key] = item

        if reference_items is None:
            reference_items = current_items
        elif set(current_items) != set(reference_items):
            missing = sorted(set(reference_items) - set(current_items))
            extra = sorted(set(current_items) - set(reference_items))
            detail = []
            if missing:
                detail.append(f"missing from '{vendor}': {', '.join(missing)}")
            if extra:
                detail.append(f"extra in '{vendor}': {', '.join(extra)}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Supplier quotes must contain the same line items; " + "; ".join(detail),
            )

        for item in quote.items:
            item_key = item.description.strip().lower()
            if not item_key:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Quote item descriptions cannot be empty.",
                )

            reference = reference_items[item_key]
            if item.quantity != reference.quantity or (item.unit_of_measure or "unit") != (reference.unit_of_measure or "unit"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Quantity/unit mismatch for '{item.description.strip()}'. "
                        "All suppliers must quote the same quantity and unit of measure."
                    ),
                )

            total_item_cost = item.unit_price * reference.quantity
            vendor_totals[vendor] += total_item_cost

            existing = item_best_prices.get(item_key)
            if existing is None or item.unit_price < existing["unit_price"]:
                item_best_prices[item_key] = {
                    "item_name": item.description.strip(),
                    "cheapest_vendor": vendor,
                    "unit_price": round(item.unit_price, 2),
                    "quantity": item.quantity,
                    "unit_of_measure": item.unit_of_measure or "unit",
                    "total_line_cost": round(total_item_cost, 2),
                }

    lowest_vendor = min(vendor_totals, key=vendor_totals.get)
    lowest_single_total = round(vendor_totals[lowest_vendor], 2)
    optimal_split_total = round(
        sum(i["total_line_cost"] for i in item_best_prices.values()), 2
    )
    potential_savings = round(
        max(0.0, lowest_single_total - optimal_split_total), 2
    )

    return {
        "status": "success",
        "vendor_totals": {v: round(amt, 2) for v, amt in vendor_totals.items()},
        "lowest_single_vendor": {
            "supplier_name": lowest_vendor,
            "total_cost": lowest_single_total,
        },
        "optimal_split_award": {
            "total_cost": optimal_split_total,
            "potential_savings": potential_savings,
            "item_breakdown": list(item_best_prices.values()),
        },
    }
