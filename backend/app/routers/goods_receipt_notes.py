from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app import models
from app.security import get_current_user
from app.schemas_goods_receipt_notes import (
    ReadyPOForGRNOut, POLineGRNStatus, GRNCreate, GRNDraftUpdate,
    GRNListItemOut, GRNDetailOut, GRNLineItemOut,
)

router = APIRouter(prefix="/api/grns", tags=["Goods Receipt Notes"])

ELIGIBLE_PO_STATUSES = (models.POStatus.sent,)


def _grn_number(grn_id: str) -> str:
    return f"GRN-{grn_id.replace('-', '')[:8].upper()}"


def _received_so_far(db: Session, po_line_item_id: str) -> Decimal:
    """Only RECEIVED GRNs count against remaining quantity — a draft
    hasn't been verified/received at the warehouse dock yet."""
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


def _line_status(db: Session, pli: models.PurchaseOrderLineItem) -> POLineGRNStatus:
    received = _received_so_far(db, pli.id)
    return POLineGRNStatus(
        po_line_item_id=pli.id,
        description=pli.description,
        spec=pli.spec,
        unit=pli.unit,
        quantity_ordered=pli.quantity,
        quantity_already_received=received,
        quantity_remaining=pli.quantity - received,
    )


def _ensure_grn_access(po: models.PurchaseOrder, user: models.User):
    if user.role == models.UserRole.store and po.store_location_id != user.store_location_id:
        raise HTTPException(403, "This PO is not assigned to your store location.")


def _detail_out(grn: models.GoodsReceiptNote) -> GRNDetailOut:
    po = grn.purchase_order
    supplier = po.supplier if po else None
    return GRNDetailOut(
        id=grn.id,
        grn_number=grn.grn_number,
        status=grn.status.value if hasattr(grn.status, "value") else grn.status,
        po_id=po.id if po else "",
        po_number=po.po_number if po else "—",
        supplier_name=supplier.name if supplier else "Unknown supplier",
        vehicle_number=grn.vehicle_number,
        driver_name=grn.driver_name,
        challan_number=grn.challan_number,
        notes=grn.notes,
        created_at=grn.created_at,
        received_at=grn.received_at,
        items=[
            GRNLineItemOut(
                id=li.id,
                po_line_item_id=li.po_line_item_id,
                description=li.description,
                spec=li.spec,
                unit=li.unit,
                quantity_received=li.quantity_received,
            )
            for li in grn.line_items
        ],
    )


@router.get("/ready-pos", response_model=list[ReadyPOForGRNOut])
def list_ready_pos(
    request: Request,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Sent Purchase Orders that still have unreceived quantity on at least one line.
    For store-role users, only POs assigned to their store location are shown."""
    query = db.query(models.PurchaseOrder).filter(
        models.PurchaseOrder.status.in_(ELIGIBLE_PO_STATUSES)
    )

    # Store users only see their own location's POs
    if user.role == models.UserRole.store:
        if not user.store_location_id:
            return []  # store user with no location assigned — show nothing
        query = query.filter(
            models.PurchaseOrder.store_location_id == user.store_location_id
        )

    pos = query.order_by(models.PurchaseOrder.created_at.desc()).all()
    out = []
    for po in pos:
        remaining_count = sum(
            1 for li in po.line_items if (li.quantity - _received_so_far(db, li.id)) > 0
        )
        if remaining_count == 0:
            continue
        out.append(ReadyPOForGRNOut(
            id=po.id,
            po_number=po.po_number,
            supplier_name=po.supplier.name if po.supplier else "Unknown supplier",
            lines_remaining=remaining_count,
            store_location=po.store_location.name if po.store_location else None,
        ))
    return out


@router.get("/po/{po_id}/lines", response_model=list[POLineGRNStatus])
def get_po_receipt_status(
    po_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Shows ordered/received/remaining per line for a given PO.
    For store users, quantity_prefill is set to PO ordered quantity
    so the GRN form pre-fills with the full ordered amount."""
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(404, "Purchase Order not found")

    # Store users can only view POs for their location
    if user.role == models.UserRole.store:
        if po.store_location_id != user.store_location_id:
            raise HTTPException(403, "This PO is not assigned to your store location.")

    return [_line_status(db, li) for li in po.line_items]


@router.get("/po/{po_id}/challans")
def get_po_vendor_challans(
    po_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Returns vendor-uploaded Delivery Challans for a PO.
    Accessible by store-role users for their location's POs."""
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(404, "Purchase Order not found")

    # Store users can only view challans for their location's POs
    if user.role == models.UserRole.store:
        if po.store_location_id != user.store_location_id:
            raise HTTPException(403, "This PO is not assigned to your store location.")

    docs = db.query(models.VendorPortalDocument).filter(
        models.VendorPortalDocument.po_id == po_id,
        models.VendorPortalDocument.document_type == models.VendorDocumentType.delivery_challan,
    ).order_by(models.VendorPortalDocument.uploaded_at.desc()).all()

    return [
        {
            "id": d.id,
            "file_name": d.file_name,
            "file_size": float(d.file_size) if d.file_size else None,
            "notes": d.notes,
            "uploaded_at": d.uploaded_at,
            "download_url": f"/api/vendor-portal/internal/download/{d.id}",
        }
        for d in docs
    ]


def _validate_items_against_remaining(db: Session, po: models.PurchaseOrder, items: list):
    if not items:
        raise HTTPException(400, "A GRN needs at least one item.")

    pli_by_id = {li.id: li for li in po.line_items}
    for item in items:
        pli = pli_by_id.get(item.po_line_item_id)
        if not pli:
            raise HTTPException(400, "One of the items doesn't belong to this purchase order.")
        if item.quantity_received <= 0:
            raise HTTPException(400, f"Quantity for '{pli.description}' must be greater than zero.")
        remaining = pli.quantity - _received_so_far(db, pli.id)
        if item.quantity_received > remaining:
            raise HTTPException(
                400,
                f"'{pli.description}': trying to receive {item.quantity_received} {pli.unit}, "
                f"but only {remaining} {pli.unit} remains outstanding on this PO.",
            )


@router.get("", response_model=list[GRNListItemOut])
def list_grns(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    query = db.query(models.GoodsReceiptNote).order_by(models.GoodsReceiptNote.created_at.desc())
    if user.role == models.UserRole.store:
        query = query.join(models.PurchaseOrder).filter(models.PurchaseOrder.store_location_id == user.store_location_id)
    grns = query.all()
    out = []
    for grn in grns:
        po = grn.purchase_order
        supplier = po.supplier if po else None
        out.append(GRNListItemOut(
            id=grn.id,
            grn_number=grn.grn_number,
            status=grn.status.value if hasattr(grn.status, "value") else grn.status,
            po_number=po.po_number if po else "—",
            supplier_name=supplier.name if supplier else "Unknown supplier",
            item_count=len(grn.line_items),
            created_at=grn.created_at,
        ))
    return out


@router.post("", response_model=GRNDetailOut)
def create_grn(payload: GRNCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == payload.po_id).first()
    if not po:
        raise HTTPException(404, "Purchase Order not found")
    _ensure_grn_access(po, user)
    if po.status not in ELIGIBLE_PO_STATUSES:
        raise HTTPException(400, "Only sent purchase orders can have a GRN raised against them.")

    # Idempotency check 1: Prevent duplicate draft GRNs on the same PO
    existing_draft = (
        db.query(models.GoodsReceiptNote)
        .filter(
            models.GoodsReceiptNote.po_id == po.id,
            models.GoodsReceiptNote.status == models.GRNStatus.draft,
        )
        .first()
    )
    if existing_draft:
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"A draft Goods Receipt Note (#{existing_draft.grn_number}) is already open for this Purchase Order.",
                "error_code": "DRAFT_ALREADY_EXISTS",
                "existing_id": existing_draft.id,
                "existing_number": existing_draft.grn_number,
                "document_type": "grn",
            },
        )

    # Idempotency check 2: Prevent duplicate supplier challan/docket number for the same PO
    if payload.challan_number and payload.challan_number.strip():
        existing_challan = (
            db.query(models.GoodsReceiptNote)
            .filter(
                models.GoodsReceiptNote.po_id == po.id,
                models.GoodsReceiptNote.challan_number == payload.challan_number.strip(),
            )
            .first()
        )
        if existing_challan:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": f"A Goods Receipt Note with Supplier Challan #{payload.challan_number.strip()} has already been recorded for this PO (#{existing_challan.grn_number}).",
                    "error_code": "DUPLICATE_CHALLAN_NUMBER",
                    "existing_id": existing_challan.id,
                    "existing_number": existing_challan.grn_number,
                    "document_type": "grn",
                },
            )

    # Check if PO is already fully received
    total_remaining = sum(
        max(Decimal(0), li.quantity - _received_so_far(db, li.id))
        for li in po.line_items
    )
    if total_remaining <= 0:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "All items on this Purchase Order have already been fully received.",
                "error_code": "FULLY_FULFILLED",
            },
        )

    _validate_items_against_remaining(db, po, payload.items)

    pli_by_id = {li.id: li for li in po.line_items}
    grn = models.GoodsReceiptNote(
        grn_number="",
        po_id=po.id,
        vehicle_number=payload.vehicle_number,
        driver_name=payload.driver_name,
        challan_number=payload.challan_number,
        notes=payload.notes,
        status=models.GRNStatus.draft,
    )
    db.add(grn)
    db.flush()
    grn.grn_number = _grn_number(grn.id)

    for item in payload.items:
        pli = pli_by_id[item.po_line_item_id]
        db.add(models.GoodsReceiptNoteLineItem(
            grn_id=grn.id,
            po_line_item_id=pli.id,
            description=pli.description,
            spec=pli.spec,
            unit=pli.unit,
            quantity_received=item.quantity_received,
        ))

    db.commit()
    db.refresh(grn)
    return _detail_out(grn)


@router.get("/{grn_id}", response_model=GRNDetailOut)
def get_grn(grn_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    grn = db.query(models.GoodsReceiptNote).filter(models.GoodsReceiptNote.id == grn_id).first()
    if not grn:
        raise HTTPException(404, "Goods Receipt Note not found")
    _ensure_grn_access(grn.purchase_order, user)
    return _detail_out(grn)


@router.put("/{grn_id}", response_model=GRNDetailOut)
def update_grn_draft(grn_id: str, payload: GRNDraftUpdate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    grn = db.query(models.GoodsReceiptNote).filter(models.GoodsReceiptNote.id == grn_id).first()
    if not grn:
        raise HTTPException(404, "Goods Receipt Note not found")
    if grn.status != models.GRNStatus.draft:
        raise HTTPException(400, "Only draft GRNs can be edited.")

    po = grn.purchase_order
    _ensure_grn_access(po, user)
    _validate_items_against_remaining(db, po, payload.items)

    grn.vehicle_number = payload.vehicle_number
    grn.driver_name = payload.driver_name
    grn.challan_number = payload.challan_number
    grn.notes = payload.notes
    db.query(models.GoodsReceiptNoteLineItem).filter(models.GoodsReceiptNoteLineItem.grn_id == grn.id).delete()

    pli_by_id = {li.id: li for li in po.line_items}
    for item in payload.items:
        pli = pli_by_id[item.po_line_item_id]
        db.add(models.GoodsReceiptNoteLineItem(
            grn_id=grn.id,
            po_line_item_id=pli.id,
            description=pli.description,
            spec=pli.spec,
            unit=pli.unit,
            quantity_received=item.quantity_received,
        ))

    db.commit()
    db.refresh(grn)
    return _detail_out(grn)


@router.post("/{grn_id}/mark-received", response_model=GRNDetailOut)
def mark_received(grn_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    grn = db.query(models.GoodsReceiptNote).filter(models.GoodsReceiptNote.id == grn_id).first()
    if not grn:
        raise HTTPException(404, "Goods Receipt Note not found")
    if grn.status != models.GRNStatus.draft:
        raise HTTPException(400, "Only draft GRNs can be marked as received.")
    _ensure_grn_access(grn.purchase_order, user)

    for li in grn.line_items:
        remaining = li.purchase_order_line_item.quantity - _received_so_far(db, li.po_line_item_id)
        if li.quantity_received > remaining:
            raise HTTPException(
                400,
                f"'{li.description}': only {remaining} {li.unit} remains outstanding now — "
                f"another receipt may have been posted since this draft was created. Please adjust before receiving.",
            )

    grn.status = models.GRNStatus.received
    grn.received_at = datetime.utcnow()
    db.commit()
    db.refresh(grn)
    return _detail_out(grn)


@router.delete("/{grn_id}")
def delete_grn(grn_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    grn = db.query(models.GoodsReceiptNote).filter(models.GoodsReceiptNote.id == grn_id).first()
    if not grn:
        raise HTTPException(404, "Goods Receipt Note not found")
    if grn.status != models.GRNStatus.draft:
        raise HTTPException(400, "Only draft GRNs can be deleted.")
    _ensure_grn_access(grn.purchase_order, user)

    db.delete(grn)
    db.commit()
    return {"deleted": True, "id": grn_id}
