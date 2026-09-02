from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app import models
from app.schemas_invoices import (
    ReadyQuoteOut, QuoteLineInvoiceStatus, InvoiceCreate, InvoiceDraftUpdate,
    InvoiceListItemOut, InvoiceDetailOut, InvoiceLineItemOut,
)

router = APIRouter(prefix="/api/invoices", tags=["invoices"])

ELIGIBLE_QUOTE_STATUSES = (models.QuoteStatus.approved, models.QuoteStatus.sent)


def _invoice_number(invoice_id: str) -> str:
    return f"INV-{invoice_id.replace('-', '')[:8].upper()}"


def _dispatched_so_far(db: Session, quote_line_item_id: str) -> Decimal:
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


def _invoiced_so_far(db: Session, quote_line_item_id: str) -> Decimal:
    """Only ISSUED invoices count — a draft hasn't actually been billed
    yet, same reasoning as draft Delivery Challans not counting against
    remaining quantity."""
    total = (
        db.query(func.coalesce(func.sum(models.InvoiceLineItem.quantity_invoiced), 0))
        .join(models.Invoice)
        .filter(
            models.InvoiceLineItem.quote_line_item_id == quote_line_item_id,
            models.Invoice.status == models.InvoiceStatus.issued,
        )
        .scalar()
    )
    return Decimal(total or 0)


def _line_status(db: Session, qli: models.QuoteLineItem) -> QuoteLineInvoiceStatus:
    dispatched = _dispatched_so_far(db, qli.id)
    invoiced = _invoiced_so_far(db, qli.id)
    return QuoteLineInvoiceStatus(
        quote_line_item_id=qli.id,
        description=qli.description,
        spec=qli.spec,
        unit=qli.unit,
        unit_price=qli.unit_price,
        gst_percent=qli.gst_percent,
        quantity_quoted=qli.quantity,
        quantity_dispatched=dispatched,
        quantity_already_invoiced=invoiced,
        quantity_available_to_invoice=dispatched - invoiced,
    )


def _totals(line_items: list[models.InvoiceLineItem]):
    subtotal = Decimal(0)
    total_gst = Decimal(0)
    missing = 0
    for li in line_items:
        if li.unit_price is None:
            missing += 1
            continue
        line_total = li.unit_price * li.quantity_invoiced
        subtotal += line_total
        if li.gst_percent:
            total_gst += line_total * (li.gst_percent / Decimal(100))
    return subtotal, total_gst, subtotal + total_gst, missing


def _detail_out(invoice: models.Invoice) -> InvoiceDetailOut:
    quote = invoice.customer_quote
    enquiry = quote.enquiry if quote else None
    subtotal, total_gst, grand_total, missing = _totals(invoice.line_items)
    return InvoiceDetailOut(
        id=invoice.id,
        invoice_number=invoice.invoice_number,
        status=invoice.status.value if hasattr(invoice.status, "value") else invoice.status,
        quote_number=quote.quote_number if quote else "—",
        customer_name=enquiry.site.customer.name if enquiry and enquiry.site and enquiry.site.customer else "Unknown customer",
        site_name=enquiry.site.name if enquiry and enquiry.site else "Unknown site",
        notes=invoice.notes,
        created_at=invoice.created_at,
        issued_at=invoice.issued_at,
        items=[
            InvoiceLineItemOut(
                id=li.id, quote_line_item_id=li.quote_line_item_id,
                description=li.description, spec=li.spec, unit=li.unit,
                quantity_invoiced=li.quantity_invoiced,
                unit_price=li.unit_price, gst_percent=li.gst_percent,
            )
            for li in invoice.line_items
        ],
        subtotal=subtotal, total_gst=total_gst, grand_total=grand_total,
        items_price_missing=missing,
        erp_external_id=invoice.erp_external_id,
        erp_sync_status=invoice.erp_sync_status,
        erp_payment_status=invoice.erp_payment_status,
        erp_synced_at=invoice.erp_synced_at,
    )


@router.get("/ready-quotes", response_model=list[ReadyQuoteOut])
def list_ready_quotes(db: Session = Depends(get_db)):
    """Approved/sent quotes with dispatched-but-not-yet-invoiced quantity
    on at least one line."""
    quotes = (
        db.query(models.Quote)
        .filter(models.Quote.status.in_(ELIGIBLE_QUOTE_STATUSES))
        .order_by(models.Quote.created_at.desc())
        .all()
    )
    out = []
    for q in quotes:
        available_count = sum(
            1 for li in q.line_items
            if (_dispatched_so_far(db, li.id) - _invoiced_so_far(db, li.id)) > 0
        )
        if available_count == 0:
            continue
        enquiry = q.enquiry
        out.append(ReadyQuoteOut(
            id=q.id,
            quote_number=q.quote_number,
            customer_name=enquiry.site.customer.name if enquiry and enquiry.site and enquiry.site.customer else "Unknown customer",
            site_name=enquiry.site.name if enquiry and enquiry.site else "Unknown site",
            lines_available=available_count,
        ))
    return out


@router.get("/quote/{quote_id}/lines", response_model=list[QuoteLineInvoiceStatus])
def get_quote_invoice_status(quote_id: str, db: Session = Depends(get_db)):
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(404, "Quote not found")
    return [_line_status(db, li) for li in quote.line_items]


def _validate_items_against_available(db: Session, quote: models.Quote, items: list):
    if not items:
        raise HTTPException(400, "An invoice needs at least one item.")

    qli_by_id = {li.id: li for li in quote.line_items}
    for item in items:
        qli = qli_by_id.get(item.quote_line_item_id)
        if not qli:
            raise HTTPException(400, "One of the items doesn't belong to this quote.")
        if item.quantity_invoiced <= 0:
            raise HTTPException(400, f"Quantity for '{qli.description}' must be greater than zero.")
        available = _dispatched_so_far(db, qli.id) - _invoiced_so_far(db, qli.id)
        if item.quantity_invoiced > available:
            raise HTTPException(
                400,
                f"'{qli.description}': trying to invoice {item.quantity_invoiced} {qli.unit}, "
                f"but only {available} {qli.unit} has been dispatched and not yet invoiced.",
            )


@router.get("", response_model=list[InvoiceListItemOut])
def list_invoices(db: Session = Depends(get_db)):
    invoices = db.query(models.Invoice).order_by(models.Invoice.created_at.desc()).all()
    out = []
    for inv in invoices:
        _, _, grand_total, _ = _totals(inv.line_items)
        quote = inv.customer_quote
        enquiry = quote.enquiry if quote else None
        out.append(InvoiceListItemOut(
            id=inv.id,
            invoice_number=inv.invoice_number,
            status=inv.status.value if hasattr(inv.status, "value") else inv.status,
            quote_number=quote.quote_number if quote else "—",
            customer_name=enquiry.site.customer.name if enquiry and enquiry.site and enquiry.site.customer else "Unknown customer",
            grand_total=grand_total,
            created_at=inv.created_at,
        ))
    return out


@router.post("", response_model=InvoiceDetailOut)
def create_invoice(payload: InvoiceCreate, db: Session = Depends(get_db)):
    quote = db.query(models.Quote).filter(models.Quote.id == payload.customer_quote_id).first()
    if not quote:
        raise HTTPException(404, "Quote not found")
    if quote.status not in ELIGIBLE_QUOTE_STATUSES:
        raise HTTPException(400, "Only approved or sent quotes can be invoiced.")

    # Idempotency check: prevent duplicate draft invoices on the same quote
    existing_draft = (
        db.query(models.Invoice)
        .filter(
            models.Invoice.customer_quote_id == quote.id,
            models.Invoice.status == models.InvoiceStatus.draft,
        )
        .first()
    )
    if existing_draft:
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"A draft Invoice (#{existing_draft.invoice_number}) is already open for this Quote.",
                "error_code": "DRAFT_ALREADY_EXISTS",
                "existing_id": existing_draft.id,
                "existing_number": existing_draft.invoice_number,
                "document_type": "invoice",
            },
        )

    # Check if there is dispatched quantity available to invoice
    total_available = sum(
        max(Decimal(0), _dispatched_so_far(db, li.id) - _invoiced_so_far(db, li.id))
        for li in quote.line_items
    )
    if total_available <= 0:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "All dispatched items on this Quote have already been fully invoiced.",
                "error_code": "FULLY_FULFILLED",
            },
        )

    _validate_items_against_available(db, quote, payload.items)

    qli_by_id = {li.id: li for li in quote.line_items}
    invoice = models.Invoice(invoice_number="", customer_quote_id=quote.id, notes=payload.notes, status=models.InvoiceStatus.draft)
    db.add(invoice)
    db.flush()
    invoice.invoice_number = _invoice_number(invoice.id)

    for item in payload.items:
        qli = qli_by_id[item.quote_line_item_id]
        db.add(models.InvoiceLineItem(
            invoice_id=invoice.id,
            quote_line_item_id=qli.id,
            description=qli.description,
            spec=qli.spec,
            unit=qli.unit,
            quantity_invoiced=item.quantity_invoiced,
            unit_price=item.unit_price if item.unit_price is not None else qli.unit_price,
            gst_percent=item.gst_percent if item.gst_percent is not None else qli.gst_percent,
        ))

    db.commit()
    db.refresh(invoice)
    return _detail_out(invoice)


@router.get("/{invoice_id}", response_model=InvoiceDetailOut)
def get_invoice(invoice_id: str, db: Session = Depends(get_db)):
    invoice = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    return _detail_out(invoice)


@router.put("/{invoice_id}", response_model=InvoiceDetailOut)
def update_invoice_draft(invoice_id: str, payload: InvoiceDraftUpdate, db: Session = Depends(get_db)):
    invoice = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    if invoice.status != models.InvoiceStatus.draft:
        raise HTTPException(400, "Only draft invoices can be edited.")

    quote = invoice.customer_quote
    _validate_items_against_available(db, quote, payload.items)

    invoice.notes = payload.notes
    db.query(models.InvoiceLineItem).filter(models.InvoiceLineItem.invoice_id == invoice.id).delete()

    qli_by_id = {li.id: li for li in quote.line_items}
    for item in payload.items:
        qli = qli_by_id[item.quote_line_item_id]
        db.add(models.InvoiceLineItem(
            invoice_id=invoice.id,
            quote_line_item_id=qli.id,
            description=qli.description,
            spec=qli.spec,
            unit=qli.unit,
            quantity_invoiced=item.quantity_invoiced,
            unit_price=item.unit_price if item.unit_price is not None else qli.unit_price,
            gst_percent=item.gst_percent if item.gst_percent is not None else qli.gst_percent,
        ))

    db.commit()
    db.refresh(invoice)
    return _detail_out(invoice)


@router.post("/{invoice_id}/issue", response_model=InvoiceDetailOut)
def issue_invoice(invoice_id: str, db: Session = Depends(get_db)):
    """Re-validates against what's currently available to invoice — same
    'someone else may have consumed the pool since this draft was made'
    protection used for Delivery Challans. Also blocks if any line is
    still missing a price."""
    invoice = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    if invoice.status != models.InvoiceStatus.draft:
        raise HTTPException(400, "Only draft invoices can be issued.")

    missing = sum(1 for li in invoice.line_items if li.unit_price is None)
    if missing:
        raise HTTPException(400, f"{missing} item(s) still have no price. Fill those in before issuing.")

    for li in invoice.line_items:
        available = _dispatched_so_far(db, li.quote_line_item_id) - _invoiced_so_far(db, li.quote_line_item_id)
        if li.quantity_invoiced > available:
            raise HTTPException(
                400,
                f"'{li.description}': only {available} {li.unit} is available to invoice now — "
                f"another invoice may have been issued since this draft was created. Please adjust before issuing.",
            )

    invoice.status = models.InvoiceStatus.issued
    invoice.issued_at = datetime.utcnow()
    db.commit()
    db.refresh(invoice)
    return _detail_out(invoice)


@router.delete("/{invoice_id}")
def delete_invoice(invoice_id: str, db: Session = Depends(get_db)):
    invoice = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    if invoice.status != models.InvoiceStatus.draft:
        raise HTTPException(400, "Only draft invoices can be deleted.")

    db.delete(invoice)
    db.commit()
    return {"deleted": True, "id": invoice_id}
