"""
Vendor Self-Service Portal — public-facing endpoints.

Vendors log in with their registered Email OR GST number.
No internal session cookie needed — a short-lived token is issued and stored
in the vendor_sessions DB table for the portal session. Sessions survive
server restarts and scale across multiple workers.
"""
import os
import secrets
from datetime import datetime, timedelta
from pathlib import Path
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.security import get_current_user
from app import models
from app.routers.auth import limiter

router = APIRouter(prefix="/api/vendor-portal", tags=["vendor-portal"])

# Vendor portal upload storage directory
UPLOAD_DIR = Path(os.getenv("VENDOR_UPLOAD_DIR", "vendor_uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

VENDOR_SESSION_HOURS = int(os.getenv("VENDOR_SESSION_HOURS", "8"))


class VendorLoginRequest(BaseModel):
    identifier: str
    gst_number: Optional[str] = None


class VendorLoginResponse(BaseModel):
    vendor_token: str
    supplier_id: str
    supplier_name: str


def _get_vendor_from_token(vendor_token: str, db: Session) -> models.Supplier:
    """Validate the vendor token against the DB and return the Supplier."""
    session = db.query(models.VendorSession).filter(models.VendorSession.token == vendor_token).first()
    if not session:
        raise HTTPException(401, "Vendor session expired or invalid. Please log in again.")
    if datetime.utcnow() >= session.expires_at:
        db.delete(session)
        db.commit()
        raise HTTPException(401, "Vendor session expired. Please log in again.")
    supplier = db.query(models.Supplier).filter(models.Supplier.id == session.supplier_id).first()
    if not supplier:
        raise HTTPException(404, "Supplier not found.")
    return supplier


@router.post("/login", response_model=VendorLoginResponse)
@limiter.limit("10/minute")
def vendor_login(request: Request, payload: VendorLoginRequest, db: Session = Depends(get_db)):
    """
    Vendor logs in with their registered Email or GST number.
    Returns a portal token for subsequent requests. Max 10 attempts/min/IP.
    """
    identifier = payload.identifier.strip()
    query = db.query(models.Supplier).filter(models.Supplier.email == identifier)
    supplier = query.first()
    if supplier and supplier.gst_number:
        supplied_gst = (payload.gst_number or "").strip()
        if not supplied_gst or supplied_gst.lower() != supplier.gst_number.lower():
            raise HTTPException(401, "Email found, but the GST number does not match the supplier record.")
    if supplier is None:
        # Backward-compatible GST login is retained only for suppliers without a registered email.
        if payload.gst_number and payload.gst_number.strip():
            supplier = db.query(models.Supplier).filter(models.Supplier.gst_number == payload.gst_number.strip()).first()
        else:
            supplier = db.query(models.Supplier).filter(models.Supplier.gst_number == identifier).first()

    if not supplier:
        raise HTTPException(
            401,
            "No supplier found with that email or GST number. "
            "Please contact your purchaser to verify your details are registered.",
        )

    token = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(hours=VENDOR_SESSION_HOURS)

    # Persist the session to the database so it survives restarts
    vendor_session = models.VendorSession(
        token=token,
        supplier_id=supplier.id,
        expires_at=expires_at,
    )
    db.add(vendor_session)
    db.commit()

    return VendorLoginResponse(
        vendor_token=token,
        supplier_id=supplier.id,
        supplier_name=supplier.name,
    )



@router.get("/orders")
def get_vendor_orders(
    vendor_token: str,
    db: Session = Depends(get_db),
):
    """
    Returns all POs assigned to this vendor with full lifecycle status:
    PO Sent → Goods Received % → Vendor Invoice Uploaded → ERP Payment Status.
    """
    supplier = _get_vendor_from_token(vendor_token, db)

    pos = (
        db.query(models.PurchaseOrder)
        .filter(models.PurchaseOrder.supplier_id == supplier.id)
        .filter(models.PurchaseOrder.status != models.POStatus.draft)
        .order_by(models.PurchaseOrder.created_at.desc())
        .all()
    )

    result = []
    for po in pos:
        # Calculate GRN received % per line item
        total_ordered = sum(float(li.quantity) for li in po.line_items) if po.line_items else 0
        total_received = 0.0
        for grn in po.goods_receipt_notes:
            if grn.status == models.GRNStatus.received:
                total_received += sum(float(li.quantity_received) for li in grn.line_items)

        receipt_pct = round((total_received / total_ordered * 100), 1) if total_ordered > 0 else 0.0

        # Check if vendor has uploaded an invoice via portal
        vendor_docs = db.query(models.VendorPortalDocument).filter(
            models.VendorPortalDocument.po_id == po.id,
            models.VendorPortalDocument.supplier_id == supplier.id,
        ).all()

        invoice_docs = [d for d in vendor_docs if d.document_type == models.VendorDocumentType.invoice]
        challan_docs = [d for d in vendor_docs if d.document_type == models.VendorDocumentType.delivery_challan]

        result.append({
            "po_id": po.id,
            "po_number": po.po_number,
            "status": po.status.value,
            "store_location": po.store_location.name if po.store_location else None,
            "created_at": po.created_at,
            "sent_at": po.sent_at,
            "line_items": [
                {
                    "description": li.description,
                    "spec": li.spec,
                    "quantity": float(li.quantity),
                    "unit": li.unit,
                }
                for li in po.line_items
            ],
            "lifecycle": {
                "po_sent": po.status == models.POStatus.sent or po.sent_at is not None,
                "receipt_pct": receipt_pct,
                "invoice_uploaded": len(invoice_docs) > 0,
                "payment_status": po.erp_payment_status or "pending",
            },
            "documents": {
                "challans": [
                    {"id": d.id, "file_name": d.file_name, "uploaded_at": d.uploaded_at}
                    for d in challan_docs
                ],
                "invoices": [
                    {"id": d.id, "file_name": d.file_name, "uploaded_at": d.uploaded_at}
                    for d in invoice_docs
                ],
            },
        })

    return {"supplier_name": supplier.name, "orders": result}


@router.post("/upload")
async def upload_vendor_document(
    vendor_token: str = Form(...),
    po_id: str = Form(...),
    document_type: str = Form(...),   # "delivery_challan" | "invoice" | "other"
    notes: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Vendor uploads a Delivery Challan or Invoice for a specific PO.
    The file is stored server-side and linked to the PO.
    """
    supplier = _get_vendor_from_token(vendor_token, db)

    # Validate PO belongs to this supplier
    po = db.query(models.PurchaseOrder).filter(
        models.PurchaseOrder.id == po_id,
        models.PurchaseOrder.supplier_id == supplier.id,
    ).first()
    if not po:
        raise HTTPException(404, "Purchase Order not found for your account.")

    # Validate document type
    try:
        doc_type = models.VendorDocumentType(document_type)
    except ValueError:
        raise HTTPException(400, "document_type must be: delivery_challan, invoice, or other.")

    # Save file safely: never allow a client-supplied filename to escape UPLOAD_DIR.
    raw_name = Path(file.filename or "upload").name
    safe_original = re.sub(r"[^A-Za-z0-9._-]", "_", raw_name)[:180] or "upload"
    max_bytes = int(os.getenv("VENDOR_UPLOAD_MAX_BYTES", str(10 * 1024 * 1024)))
    content = await file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(413, f"File is too large. Maximum allowed size is {max_bytes // (1024 * 1024)} MB.")
    safe_name = f"{po_id}_{supplier.id}_{secrets.token_hex(6)}_{safe_original}"
    file_path = (UPLOAD_DIR / safe_name).resolve()
    upload_root = UPLOAD_DIR.resolve()
    if upload_root not in file_path.parents:
        raise HTTPException(400, "Invalid file name.")
    file_path.write_bytes(content)

    doc = models.VendorPortalDocument(
        supplier_id=supplier.id,
        po_id=po_id,
        document_type=doc_type,
        file_name=safe_original,  # sanitized name — never the raw client filename
        file_path=str(file_path),
        file_size=len(content),
        notes=notes,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    return {
        "id": doc.id,
        "file_name": doc.file_name,
        "document_type": doc_type.value,
        "uploaded_at": doc.uploaded_at,
    }


@router.get("/download/{document_id}")
def download_vendor_document(
    document_id: str,
    vendor_token: str,
    db: Session = Depends(get_db),
):
    """Vendor-only document download. The token must belong to the uploader's supplier."""
    supplier = _get_vendor_from_token(vendor_token, db)
    doc = db.query(models.VendorPortalDocument).filter(models.VendorPortalDocument.id == document_id).first()
    if not doc:
        raise HTTPException(404, "Document not found.")
    if doc.supplier_id != supplier.id:
        raise HTTPException(403, "You are not allowed to access this document.")
    file_path = Path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(404, "File no longer available on server.")
    return FileResponse(path=str(file_path), filename=doc.file_name, media_type="application/octet-stream")


@router.get("/internal/download/{document_id}")
def download_vendor_document_internal(
    document_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Internal authenticated download for purchasers, managers, and accounts."""
    if user.role not in (models.UserRole.purchase, models.UserRole.manager, models.UserRole.accounts, models.UserRole.store):
        raise HTTPException(403, "You don't have access to vendor documents.")
    doc = db.query(models.VendorPortalDocument).filter(models.VendorPortalDocument.id == document_id).first()
    if not doc:
        raise HTTPException(404, "Document not found.")
    if user.role == models.UserRole.store:
        po = doc.purchase_order
        if not po or po.store_location_id != user.store_location_id:
            raise HTTPException(403, "This document is not assigned to your store location.")
    file_path = Path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(404, "File no longer available on server.")
    return FileResponse(path=str(file_path), filename=doc.file_name, media_type="application/octet-stream")


@router.get("/po-documents/{po_id}")
def get_po_documents_internal(
    po_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """
    Internal endpoint — returns all vendor-uploaded documents for a PO.
    Used by purchasers, store staff, and managers inside the main app.
    No vendor token required (internal session cookie handles auth via main app).
    """
    if user.role not in (models.UserRole.purchase, models.UserRole.manager, models.UserRole.accounts, models.UserRole.store):
        raise HTTPException(403, "You don't have access to vendor documents.")
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(404, "Purchase Order not found.")
    if user.role == models.UserRole.store and po.store_location_id != user.store_location_id:
        raise HTTPException(403, "This PO is not assigned to your store location.")
    docs = db.query(models.VendorPortalDocument).filter(
        models.VendorPortalDocument.po_id == po_id
    ).order_by(models.VendorPortalDocument.uploaded_at.desc()).all()

    return [
        {
            "id": d.id,
            "supplier_id": d.supplier_id,
            "document_type": d.document_type.value,
            "file_name": d.file_name,
            "file_size": float(d.file_size) if d.file_size else None,
            "notes": d.notes,
            "uploaded_at": d.uploaded_at,
            "download_url": f"/api/vendor-portal/internal/download/{d.id}",
        }
        for d in docs
    ]
