from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app.schemas_purchase_orders import (
    PurchaseOrderCreate, PurchaseOrderDraftUpdate,
    PurchaseOrderListItemOut, PurchaseOrderDetailOut, POLineItemOut,
)

router = APIRouter(prefix="/api/purchase-orders", tags=["purchase-orders"])


def _po_number(po_id: str) -> str:
    return f"PO-{po_id.replace('-', '')[:8].upper()}"


def _totals(line_items: list[models.PurchaseOrderLineItem]):
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


def _detail_out(po: models.PurchaseOrder) -> PurchaseOrderDetailOut:
    subtotal, total_gst, grand_total, missing = _totals(po.line_items)
    return PurchaseOrderDetailOut(
        id=po.id,
        po_number=po.po_number,
        status=po.status.value if hasattr(po.status, "value") else po.status,
        supplier_name=po.supplier.name if po.supplier else "Unknown supplier",
        supplier_email=po.supplier.email if po.supplier else None,
        supplier_phone=po.supplier.phone if po.supplier else None,
        customer_quote_number=po.customer_quote.quote_number if po.customer_quote else None,
        notes=po.notes,
        created_at=po.created_at,
        sent_at=po.sent_at,
        items=[
            POLineItemOut(
                id=li.id, description=li.description, spec=li.spec,
                quantity=li.quantity, unit=li.unit, gst_percent=li.gst_percent,
                unit_price=li.unit_price,
            )
            for li in po.line_items
        ],
        subtotal=subtotal, total_gst=total_gst, grand_total=grand_total,
        items_price_missing=missing,
    )


@router.get("", response_model=list[PurchaseOrderListItemOut])
def list_purchase_orders(db: Session = Depends(get_db)):
    pos = db.query(models.PurchaseOrder).order_by(models.PurchaseOrder.created_at.desc()).all()
    out = []
    for po in pos:
        _, _, grand_total, _ = _totals(po.line_items)
        out.append(PurchaseOrderListItemOut(
            id=po.id,
            po_number=po.po_number,
            status=po.status.value if hasattr(po.status, "value") else po.status,
            supplier_name=po.supplier.name if po.supplier else "Unknown supplier",
            item_count=len(po.line_items),
            grand_total=grand_total,
            created_at=po.created_at,
        ))
    return out


@router.post("", response_model=PurchaseOrderDetailOut)
def create_purchase_order(payload: PurchaseOrderCreate, db: Session = Depends(get_db)):
    """Creates a draft PO straight to a chosen supplier — deliberately
    independent of any RFQ, so a repeat or off-process order doesn't need
    one first."""
    supplier = db.query(models.Supplier).filter(models.Supplier.id == payload.supplier_id).first()
    if not supplier:
        raise HTTPException(404, "Supplier not found")
    if not payload.items:
        raise HTTPException(400, "A purchase order needs at least one item.")

    if payload.customer_quote_id:
        quote = db.query(models.Quote).filter(models.Quote.id == payload.customer_quote_id).first()
        if not quote:
            raise HTTPException(404, "Linked customer quote not found")

    po = models.PurchaseOrder(
        po_number="", supplier_id=supplier.id,
        customer_quote_id=payload.customer_quote_id, notes=payload.notes,
        status=models.POStatus.draft,
    )
    db.add(po)
    db.flush()
    po.po_number = _po_number(po.id)

    for item in payload.items:
        db.add(models.PurchaseOrderLineItem(
            po_id=po.id,
            product_id=item.product_id,
            description=item.description,
            spec=item.spec,
            quantity=item.quantity,
            unit=item.unit,
            gst_percent=item.gst_percent,
            unit_price=item.unit_price,
        ))

    db.commit()
    db.refresh(po)
    return _detail_out(po)


@router.get("/{po_id}", response_model=PurchaseOrderDetailOut)
def get_purchase_order(po_id: str, db: Session = Depends(get_db)):
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(404, "Purchase order not found")
    return _detail_out(po)


@router.put("/{po_id}", response_model=PurchaseOrderDetailOut)
def update_purchase_order_draft(po_id: str, payload: PurchaseOrderDraftUpdate, db: Session = Depends(get_db)):
    """Save Draft — notes and the full item list are replaced together.
    Only allowed while still a draft. Items are replaced wholesale (delete
    + recreate) rather than diffed, since a PO builder lets you freely
    add/remove/edit lines before sending, unlike a Quote where only prices
    get edited after generation."""
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(404, "Purchase order not found")
    if po.status != models.POStatus.draft:
        raise HTTPException(400, "Only draft purchase orders can be edited.")
    if not payload.items:
        raise HTTPException(400, "A purchase order needs at least one item.")

    po.notes = payload.notes
    db.query(models.PurchaseOrderLineItem).filter(models.PurchaseOrderLineItem.po_id == po.id).delete()
    for item in payload.items:
        db.add(models.PurchaseOrderLineItem(
            po_id=po.id,
            product_id=item.product_id,
            description=item.description,
            spec=item.spec,
            quantity=item.quantity,
            unit=item.unit,
            gst_percent=item.gst_percent,
            unit_price=item.unit_price,
        ))

    db.commit()
    db.refresh(po)
    return _detail_out(po)


@router.post("/{po_id}/mark-sent", response_model=PurchaseOrderDetailOut)
def mark_sent(po_id: str, db: Session = Depends(get_db)):
    """The manual 'send to supplier' step — same human-in-the-loop
    principle as Quotes. Blocked if any line is still missing a price,
    since a supplier shouldn't receive an order with unagreed pricing.
    Once sent, the PO is locked."""
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(404, "Purchase order not found")
    if po.status != models.POStatus.draft:
        raise HTTPException(400, "Only draft purchase orders can be marked as sent.")

    missing = sum(1 for li in po.line_items if li.unit_price is None)
    if missing:
        raise HTTPException(400, f"{missing} item(s) still have no price. Fill those in before sending.")

    po.status = models.POStatus.sent
    po.sent_at = datetime.utcnow()
    db.commit()
    db.refresh(po)
    return _detail_out(po)


@router.delete("/{po_id}")
def delete_purchase_order(po_id: str, db: Session = Depends(get_db)):
    """Draft only — a sent PO is a real document sent to a real supplier
    and is protected, same pattern as sent Quotes."""
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(404, "Purchase order not found")
    if po.status != models.POStatus.draft:
        raise HTTPException(400, "Only draft purchase orders can be deleted.")

    db.delete(po)
    db.commit()
    return {"deleted": True, "id": po_id}
