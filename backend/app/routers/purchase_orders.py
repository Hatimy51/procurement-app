from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app.security import get_current_user
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


SPEND_APPROVAL_THRESHOLD = Decimal("100000.00")  # ₹1,00,000 threshold for Manager approval


def _calc_receipt_pct(po: models.PurchaseOrder) -> float:
    total_ordered = sum(float(li.quantity) for li in po.line_items) if po.line_items else 0.0
    if total_ordered <= 0:
        return 0.0
    total_received = 0.0
    for grn in po.goods_receipt_notes:
        if grn.status == models.GRNStatus.received:
            total_received += sum(float(li.quantity_received) for li in grn.line_items)
    return round(min(100.0, (total_received / total_ordered) * 100.0), 1)


def _detail_out(po: models.PurchaseOrder) -> PurchaseOrderDetailOut:
    subtotal, total_gst, grand_total, missing = _totals(po.line_items)
    return PurchaseOrderDetailOut(
        id=po.id,
        po_number=po.po_number,
        status=po.status.value if hasattr(po.status, "value") else po.status,
        supplier_id=po.supplier_id,
        supplier_name=po.supplier.name if po.supplier else "Unknown supplier",
        supplier_email=po.supplier.email if po.supplier else None,
        supplier_phone=po.supplier.phone if po.supplier else None,
        store_location_id=po.store_location_id,
        store_location_name=po.store_location.name if po.store_location else None,
        customer_quote_number=po.customer_quote.quote_number if po.customer_quote else None,
        approval_status=po.approval_status,
        requires_manager_approval=po.requires_manager_approval or False,
        receipt_pct=_calc_receipt_pct(po),
        erp_payment_status=po.erp_payment_status or "pending",
        notes=po.notes,
        created_at=po.created_at,
        created_by=po.created_by,
        updated_by=po.updated_by,
        updated_at=po.updated_at,
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
            store_location_name=po.store_location.name if po.store_location else None,
            approval_status=po.approval_status,
            requires_manager_approval=po.requires_manager_approval or False,
            receipt_pct=_calc_receipt_pct(po),
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
        customer_quote_id=payload.customer_quote_id,
        store_location_id=payload.store_location_id,
        notes=payload.notes,
        status=models.POStatus.draft,
        created_by=user.name,
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

    db.flush()
    _, _, grand_total, _ = _totals(po.line_items)
    if grand_total >= SPEND_APPROVAL_THRESHOLD:
        po.requires_manager_approval = True
        po.approval_status = "pending_approval"

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
def update_purchase_order_draft(po_id: str, payload: PurchaseOrderDraftUpdate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
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

    po.updated_by = user.name
    po.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(po)
    return _detail_out(po)

@router.post("/{po_id}/mark-sent", response_model=PurchaseOrderDetailOut)
def mark_sent(po_id: str, db: Session = Depends(get_db)):
    """The manual 'send to supplier' step — same human-in-the-loop
    principle as Quotes. Blocked if any line is still missing a price,
    or if the PO requires manager approval and hasn't been approved yet.
    Once sent, the PO is locked."""
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(404, "Purchase order not found")
    if po.status != models.POStatus.draft:
        raise HTTPException(400, "Only draft purchase orders can be marked as sent.")

    if po.requires_manager_approval and po.approval_status != "approved":
        raise HTTPException(
            400,
            "This purchase order exceeds the ₹1,00,000 spend threshold and requires Manager approval before sending."
        )

    missing = sum(1 for li in po.line_items if li.unit_price is None)
    if missing:
        raise HTTPException(400, f"{missing} item(s) still have no price. Fill those in before sending.")

    po.status = models.POStatus.sent
    po.sent_at = datetime.utcnow()
    db.commit()
    db.refresh(po)
    return _detail_out(po)


@router.post("/{po_id}/approve", response_model=PurchaseOrderDetailOut)
def approve_purchase_order(po_id: str, db: Session = Depends(get_db)):
    """Manager-only approval for high-value POs."""
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(404, "Purchase order not found")
    po.approval_status = "approved"
    db.commit()
    db.refresh(po)
    return _detail_out(po)


@router.post("/{po_id}/reject", response_model=PurchaseOrderDetailOut)
def reject_purchase_order(po_id: str, db: Session = Depends(get_db)):
    """Manager rejects a high-value PO."""
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(404, "Purchase order not found")
    po.approval_status = "rejected"
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

@router.post("/{po_id}/create-grn")
@router.post("/{po_id}/create-delivery-challan")
def create_grn_from_po(po_id: str, db: Session = Depends(get_db)):
    """
    Creates a draft Goods Receipt Note (GRN) directly from a Purchase Order.
    All PO lines are pre-filled at their remaining outstanding quantity so
    warehouse staff can record the physical quantity received.
    """
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail=f"Purchase Order #{po_id} not found.")

    existing_grn = (
        db.query(models.GoodsReceiptNote)
        .filter(
            models.GoodsReceiptNote.po_id == po.id,
            models.GoodsReceiptNote.status == models.GRNStatus.draft,
        )
        .first()
    )
    if existing_grn:
        return {
            "message": "A draft GRN already exists for this PO.",
            "grn_id": existing_grn.id,
            "grn_number": existing_grn.grn_number,
            "challan_id": existing_grn.id,
            "dc_number": existing_grn.grn_number,
            "po_id": po.id,
            "po_number": po.po_number,
        }

    from sqlalchemy import func
    received_by_line = {}
    rows = (
        db.query(
            models.GoodsReceiptNoteLineItem.po_line_item_id,
            func.coalesce(func.sum(models.GoodsReceiptNoteLineItem.quantity_received), 0),
        )
        .join(models.GoodsReceiptNote)
        .filter(
            models.GoodsReceiptNote.po_id == po.id,
            models.GoodsReceiptNote.status == models.GRNStatus.received,
        )
        .group_by(models.GoodsReceiptNoteLineItem.po_line_item_id)
        .all()
    )
    for line_id, received in rows:
        received_by_line[line_id] = Decimal(received or 0)

    new_grn = models.GoodsReceiptNote(
        po_id=po.id,
        grn_number="",
        status=models.GRNStatus.draft,
        notes=f"GRN against {po.po_number}",
    )
    db.add(new_grn)
    db.flush()
    new_grn.grn_number = f"GRN-{new_grn.id.replace('-', '')[:8].upper()}"

    for item in po.line_items:
        outstanding = item.quantity - received_by_line.get(item.id, Decimal(0))
        if outstanding <= 0:
            continue
        db.add(models.GoodsReceiptNoteLineItem(
            grn_id=new_grn.id,
            po_line_item_id=item.id,
            description=item.description,
            spec=item.spec,
            unit=item.unit,
            quantity_received=outstanding,
        ))

    db.commit()
    db.refresh(new_grn)

    return {
        "message": "Goods Receipt Note (GRN) created successfully.",
        "grn_id": new_grn.id,
        "grn_number": new_grn.grn_number,
        "challan_id": new_grn.id,
        "dc_number": new_grn.grn_number,
        "po_id": po.id,
        "po_number": po.po_number,
        "items": [
            {
                "po_line_item_id": item.po_line_item_id,
                "description": item.description,
                "ordered_quantity": next(
                    (po_line.quantity for po_line in po.line_items if po_line.id == item.po_line_item_id),
                    0,
                ),
                "received_quantity": item.quantity_received,
                "unit": item.unit,
            }
            for item in new_grn.line_items
        ],
    }
