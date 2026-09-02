from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app import models
from app.schemas_vendor_invoices import (
    ReadyPOForVendorInvoiceOut, POLineVendorInvoiceStatus, VendorInvoiceCreate,
    VendorInvoiceDraftUpdate, VendorInvoiceListItemOut, VendorInvoiceDetailOut,
    VendorInvoiceLineItemOut,
)

router = APIRouter(prefix="/api/vendor-invoices", tags=["Vendor Invoices"])


def _received_so_far(db: Session, po_line_item_id: str) -> Decimal:
    total = (
        db.query(func.coalesce(func.sum(models.GoodsReceiptNoteLineItem.quantity_received), 0))
        .join(models.GoodsReceiptNote)
        .filter(
            models.GoodsReceiptNoteLineItem.po_line_item_id == po_line_item_id,
            models.GoodsReceiptNote.status == models.GRNStatus.received,
        )
        .scalar()
    )
    return Decimal(total or 0)


def _invoiced_so_far(db: Session, po_line_item_id: str) -> Decimal:
    total = (
        db.query(func.coalesce(func.sum(models.VendorInvoiceLineItem.quantity_invoiced), 0))
        .join(models.VendorInvoice)
        .filter(
            models.VendorInvoiceLineItem.po_line_item_id == po_line_item_id,
            models.VendorInvoice.status.in_((models.VendorInvoiceStatus.verified, models.VendorInvoiceStatus.paid)),
        )
        .scalar()
    )
    return Decimal(total or 0)


def _line_status(db: Session, pli: models.PurchaseOrderLineItem) -> POLineVendorInvoiceStatus:
    received = _received_so_far(db, pli.id)
    invoiced = _invoiced_so_far(db, pli.id)
    return POLineVendorInvoiceStatus(
        po_line_item_id=pli.id,
        description=pli.description,
        spec=pli.spec,
        unit=pli.unit,
        unit_price=pli.unit_price,
        gst_percent=pli.gst_percent,
        quantity_ordered=pli.quantity,
        quantity_received=received,
        quantity_already_invoiced=invoiced,
        quantity_available_to_invoice=received - invoiced,
    )


def _totals(line_items: list[models.VendorInvoiceLineItem]):
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


def _detail_out(inv: models.VendorInvoice) -> VendorInvoiceDetailOut:
    po = inv.purchase_order
    supplier = inv.supplier or (po.supplier if po else None)
    subtotal, total_gst, grand_total, missing = _totals(inv.line_items)
    return VendorInvoiceDetailOut(
        id=inv.id,
        invoice_number=inv.invoice_number,
        status=inv.status.value if hasattr(inv.status, "value") else inv.status,
        po_id=po.id if po else "",
        po_number=po.po_number if po else "—",
        supplier_id=supplier.id if supplier else "",
        supplier_name=supplier.name if supplier else "Unknown supplier",
        grn_id=inv.grn_id,
        invoice_date=inv.invoice_date,
        received_at=inv.received_at,
        notes=inv.notes,
        created_at=inv.created_at,
        items=[
            VendorInvoiceLineItemOut(
                id=li.id,
                po_line_item_id=li.po_line_item_id,
                grn_line_item_id=li.grn_line_item_id,
                description=li.description,
                spec=li.spec,
                unit=li.unit,
                quantity_invoiced=li.quantity_invoiced,
                unit_price=li.unit_price,
                gst_percent=li.gst_percent,
            )
            for li in inv.line_items
        ],
        subtotal=subtotal,
        total_gst=total_gst,
        grand_total=grand_total,
        items_price_missing=missing,
    )


@router.get("/ready-pos", response_model=list[ReadyPOForVendorInvoiceOut])
def list_ready_pos_for_vendor_invoice(db: Session = Depends(get_db)):
    """Sent POs that have received-but-not-invoiced goods on at least one line."""
    pos = (
        db.query(models.PurchaseOrder)
        .filter(models.PurchaseOrder.status == models.POStatus.sent)
        .order_by(models.PurchaseOrder.created_at.desc())
        .all()
    )
    out = []
    for po in pos:
        available_count = sum(
            1 for li in po.line_items
            if (_received_so_far(db, li.id) - _invoiced_so_far(db, li.id)) > 0
        )
        if available_count == 0:
            continue
        out.append(ReadyPOForVendorInvoiceOut(
            id=po.id,
            po_number=po.po_number,
            supplier_name=po.supplier.name if po.supplier else "Unknown supplier",
            lines_available=available_count,
        ))
    return out


@router.get("/po/{po_id}/lines", response_model=list[POLineVendorInvoiceStatus])
def get_po_vendor_invoice_status(po_id: str, db: Session = Depends(get_db)):
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(404, "Purchase order not found")
    return [_line_status(db, li) for li in po.line_items]


def _validate_items_against_received(db: Session, po: models.PurchaseOrder, items: list):
    if not items:
        raise HTTPException(400, "A vendor invoice needs at least one item.")

    pli_by_id = {li.id: li for li in po.line_items}
    for item in items:
        if not item.po_line_item_id:
            raise HTTPException(400, "po_line_item_id is required for each item.")
        pli = pli_by_id.get(item.po_line_item_id)
        if not pli:
            raise HTTPException(400, "One of the items doesn't belong to this purchase order.")
        if item.quantity_invoiced <= 0:
            raise HTTPException(400, f"Quantity for '{pli.description}' must be greater than zero.")
        available = _received_so_far(db, pli.id) - _invoiced_so_far(db, pli.id)
        if item.quantity_invoiced > available:
            raise HTTPException(
                400,
                f"'{pli.description}': trying to invoice {item.quantity_invoiced} {pli.unit}, "
                f"but only {available} {pli.unit} has been received and not yet invoiced.",
            )


@router.get("", response_model=list[VendorInvoiceListItemOut])
def list_vendor_invoices(db: Session = Depends(get_db)):
    invoices = db.query(models.VendorInvoice).order_by(models.VendorInvoice.created_at.desc()).all()
    out = []
    for inv in invoices:
        _, _, grand_total, _ = _totals(inv.line_items)
        po = inv.purchase_order
        supplier = inv.supplier or (po.supplier if po else None)
        out.append(VendorInvoiceListItemOut(
            id=inv.id,
            invoice_number=inv.invoice_number,
            status=inv.status.value if hasattr(inv.status, "value") else inv.status,
            po_number=po.po_number if po else "—",
            supplier_name=supplier.name if supplier else "Unknown supplier",
            grand_total=grand_total,
            created_at=inv.created_at,
        ))
    return out


@router.post("", response_model=VendorInvoiceDetailOut)
def create_vendor_invoice(payload: VendorInvoiceCreate, db: Session = Depends(get_db)):
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == payload.po_id).first()
    if not po:
        raise HTTPException(404, "Purchase Order not found")
    if po.status != models.POStatus.sent:
        raise HTTPException(400, "Only sent purchase orders can be invoiced.")

    supplier = db.query(models.Supplier).filter(models.Supplier.id == payload.supplier_id).first()
    if not supplier:
        raise HTTPException(404, "Supplier not found")

    # Idempotency check 1: Prevent duplicate invoice number for the same supplier
    if payload.invoice_number and payload.invoice_number.strip():
        existing_inv = (
            db.query(models.VendorInvoice)
            .filter(
                models.VendorInvoice.supplier_id == supplier.id,
                models.VendorInvoice.invoice_number == payload.invoice_number.strip(),
            )
            .first()
        )
        if existing_inv:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": f"Invoice #{payload.invoice_number.strip()} has already been recorded for this supplier ({supplier.name}).",
                    "error_code": "DUPLICATE_INVOICE_NUMBER",
                    "existing_id": existing_inv.id,
                    "existing_number": existing_inv.invoice_number,
                    "document_type": "vendor_invoice",
                },
            )

    # Idempotency check 2: Prevent duplicate draft vendor invoices on the same PO
    existing_draft = (
        db.query(models.VendorInvoice)
        .filter(
            models.VendorInvoice.po_id == po.id,
            models.VendorInvoice.status == models.VendorInvoiceStatus.draft,
        )
        .first()
    )
    if existing_draft:
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"A draft Vendor Invoice (#{existing_draft.invoice_number}) is already open for this Purchase Order.",
                "error_code": "DRAFT_ALREADY_EXISTS",
                "existing_id": existing_draft.id,
                "existing_number": existing_draft.invoice_number,
                "document_type": "vendor_invoice",
            },
        )

    # Check if there is received quantity available to invoice
    total_available = sum(
        max(Decimal(0), _received_so_far(db, li.id) - _invoiced_so_far(db, li.id))
        for li in po.line_items
    )
    if total_available <= 0:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "All received items on this Purchase Order have already been fully invoiced.",
                "error_code": "FULLY_FULFILLED",
            },
        )

    _validate_items_against_received(db, po, payload.items)

    pli_by_id = {li.id: li for li in po.line_items}
    inv = models.VendorInvoice(
        invoice_number=payload.invoice_number,
        supplier_id=supplier.id,
        po_id=po.id,
        grn_id=payload.grn_id,
        invoice_date=payload.invoice_date,
        notes=payload.notes,
        status=models.VendorInvoiceStatus.draft,
    )
    db.add(inv)
    db.flush()

    for item in payload.items:
        pli = pli_by_id[item.po_line_item_id]
        db.add(models.VendorInvoiceLineItem(
            vendor_invoice_id=inv.id,
            po_line_item_id=pli.id,
            grn_line_item_id=item.grn_line_item_id,
            description=pli.description,
            spec=pli.spec,
            unit=pli.unit,
            quantity_invoiced=item.quantity_invoiced,
            unit_price=item.unit_price if item.unit_price is not None else pli.unit_price,
            gst_percent=item.gst_percent if item.gst_percent is not None else pli.gst_percent,
        ))

    db.commit()
    db.refresh(inv)
    return _detail_out(inv)


@router.get("/{invoice_id}", response_model=VendorInvoiceDetailOut)
def get_vendor_invoice(invoice_id: str, db: Session = Depends(get_db)):
    inv = db.query(models.VendorInvoice).filter(models.VendorInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(404, "Vendor invoice not found")
    return _detail_out(inv)


@router.put("/{invoice_id}", response_model=VendorInvoiceDetailOut)
def update_vendor_invoice_draft(invoice_id: str, payload: VendorInvoiceDraftUpdate, db: Session = Depends(get_db)):
    inv = db.query(models.VendorInvoice).filter(models.VendorInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(404, "Vendor invoice not found")
    if inv.status != models.VendorInvoiceStatus.draft:
        raise HTTPException(400, "Only draft vendor invoices can be edited.")

    po = inv.purchase_order
    _validate_items_against_received(db, po, payload.items)

    if payload.invoice_number:
        inv.invoice_number = payload.invoice_number
    if payload.invoice_date:
        inv.invoice_date = payload.invoice_date
    inv.notes = payload.notes

    db.query(models.VendorInvoiceLineItem).filter(models.VendorInvoiceLineItem.vendor_invoice_id == inv.id).delete()
    pli_by_id = {li.id: li for li in po.line_items}
    for item in payload.items:
        pli = pli_by_id[item.po_line_item_id]
        db.add(models.VendorInvoiceLineItem(
            vendor_invoice_id=inv.id,
            po_line_item_id=pli.id,
            grn_line_item_id=item.grn_line_item_id,
            description=pli.description,
            spec=pli.spec,
            unit=pli.unit,
            quantity_invoiced=item.quantity_invoiced,
            unit_price=item.unit_price if item.unit_price is not None else pli.unit_price,
            gst_percent=item.gst_percent if item.gst_percent is not None else pli.gst_percent,
        ))

    db.commit()
    db.refresh(inv)
    return _detail_out(inv)


@router.post("/{invoice_id}/verify", response_model=VendorInvoiceDetailOut)
def verify_vendor_invoice(invoice_id: str, db: Session = Depends(get_db)):
    inv = db.query(models.VendorInvoice).filter(models.VendorInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(404, "Vendor invoice not found")
    if inv.status != models.VendorInvoiceStatus.draft:
        raise HTTPException(400, "Only draft vendor invoices can be verified.")

    missing = sum(1 for li in inv.line_items if li.unit_price is None)
    if missing:
        raise HTTPException(400, f"{missing} item(s) still have no price. Fill those in before verifying.")

    for li in inv.line_items:
        available = _received_so_far(db, li.po_line_item_id) - _invoiced_so_far(db, li.po_line_item_id)
        if li.quantity_invoiced > available:
            raise HTTPException(
                400,
                f"'{li.description}': only {available} {li.unit} is available to invoice now.",
            )

    inv.status = models.VendorInvoiceStatus.verified
    inv.received_at = datetime.utcnow()
    db.commit()
    db.refresh(inv)
    return _detail_out(inv)


@router.delete("/{invoice_id}")
def delete_vendor_invoice(invoice_id: str, db: Session = Depends(get_db)):
    inv = db.query(models.VendorInvoice).filter(models.VendorInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(404, "Vendor invoice not found")
    if inv.status != models.VendorInvoiceStatus.draft:
        raise HTTPException(400, "Only draft vendor invoices can be deleted.")

    db.delete(inv)
    db.commit()
    return {"deleted": True, "id": invoice_id}
