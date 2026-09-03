"""
Vendor Self-Service Portal — public-facing endpoints.

Vendors log in with their registered Email OR GST number.
No internal session cookie needed — a short-lived JWT-style token is issued
and stored in the response for the portal session.
"""
import os
import secrets
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app import models

router = APIRouter(prefix="/api/vendor-portal", tags=["vendor-portal"])

# Vendor portal upload storage directory
UPLOAD_DIR = Path(os.getenv("VENDOR_UPLOAD_DIR", "vendor_uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# In-memory vendor portal sessions: token -> supplier_id
# For production, move to Redis or DB table. Fine for local deployment.
_vendor_sessions: dict[str, str] = {}


class VendorLoginRequest(BaseModel):
    identifier: str   # email OR gst number


class VendorLoginResponse(BaseModel):
    vendor_token: str
    supplier_id: str
    supplier_name: str


def _get_vendor_from_token(vendor_token: str, db: Session) -> models.Supplier:
    supplier_id = _vendor_sessions.get(vendor_token)
    if not supplier_id:
        raise HTTPException(401, "Vendor session expired or invalid. Please log in again.")
    supplier = db.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(404, "Supplier not found.")
    return supplier


@router.post("/login", response_model=VendorLoginResponse)
def vendor_login(payload: VendorLoginRequest, db: Session = Depends(get_db)):
    """
    Vendor logs in with their registered Email or GST number.
    Returns a portal token for subsequent requests.
    """
    identifier = payload.identifier.strip()
    supplier = db.query(models.Supplier).filter(
        (models.Supplier.email == identifier) | (models.Supplier.gst_number == identifier)
    ).first()

    if not supplier:
        raise HTTPException(
            401,
            "No supplier found with that email or GST number. "
            "Please contact your purchaser to verify your details are registered."
        )

    token = secrets.token_urlsafe(32)
    _vendor_sessions[token] = supplier.id
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

    # Save file
    safe_name = f"{po_id}_{supplier.id}_{secrets.token_hex(6)}_{file.filename}"
    file_path = UPLOAD_DIR / safe_name
    content = await file.read()
    file_path.write_bytes(content)

    doc = models.VendorPortalDocument(
        supplier_id=supplier.id,
        po_id=po_id,
        document_type=doc_type,
        file_name=file.filename,
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
    vendor_token: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Download/view a vendor-uploaded document.
    Accessible by the uploading vendor (via vendor_token) or internally
    by authenticated app users (no token needed if coming from internal app).
    """
    doc = db.query(models.VendorPortalDocument).filter(
        models.VendorPortalDocument.id == document_id
    ).first()
    if not doc:
        raise HTTPException(404, "Document not found.")

    file_path = Path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(404, "File no longer available on server.")

    return FileResponse(
        path=str(file_path),
        filename=doc.file_name,
        media_type="application/octet-stream",
    )


@router.get("/po-documents/{po_id}")
def get_po_documents_internal(
    po_id: str,
    db: Session = Depends(get_db),
):
    """
    Internal endpoint — returns all vendor-uploaded documents for a PO.
    Used by purchasers, store staff, and managers inside the main app.
    No vendor token required (internal session cookie handles auth via main app).
    """
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
            "download_url": f"/api/vendor-portal/download/{d.id}",
        }
        for d in docs
    ]
