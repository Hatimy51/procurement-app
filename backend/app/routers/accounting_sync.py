import os
from typing import Any, Dict, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.integrations.factory import get_erp_adapter
from app.security import get_current_user

router = APIRouter(prefix="/api/accounting", tags=["Accounting Sync"])


from datetime import datetime

class SyncRequest(BaseModel):
    erp_type: Literal["tally", "zoho"]
    record_type: Literal["po", "invoice", "vendor_invoice"]
    data: Dict[str, Any]
    record_id: Optional[str] = None


class RefreshStatusRequest(BaseModel):
    erp_type: Literal["tally", "zoho"] = "zoho"
    record_type: Literal["po", "invoice", "vendor_invoice"]
    record_id: Optional[str] = None


def _server_config(erp_type: str) -> dict:
    """Resolve credentials/config strictly on the server from environment variables."""
    if erp_type == "zoho":
        return {
            "zoho_api_key": os.getenv("ZOHO_API_KEY", ""),
            "zoho_org_id": os.getenv("ZOHO_ORG_ID", ""),
        }
    return {"tally_url": os.getenv("TALLY_URL", "http://localhost:9000")}


def _load_record(db: Session, record_type: str, record_id: Optional[str]):
    if not record_id:
        return None
    model = {
        "po": models.PurchaseOrder,
        "invoice": models.Invoice,
        "vendor_invoice": models.VendorInvoice,
    }[record_type]
    return db.query(model).filter(model.id == record_id).first()


def _record_display_id(record, record_type: str):
    return getattr(record, "po_number", None) or getattr(record, "invoice_number", None) or record.id


@router.post("/sync")
def sync_to_accounting(
    req: SyncRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    if user.role == models.UserRole.manager:
        raise HTTPException(status_code=403, detail="Managers cannot push records to accounting.")
    if req.record_type == "po" and user.role != models.UserRole.purchase:
        raise HTTPException(status_code=403, detail="Only Purchase users can sync purchase orders.")
    if req.record_type in ("invoice", "vendor_invoice") and user.role != models.UserRole.accounts:
        raise HTTPException(status_code=403, detail="Only Accounts users can sync invoices.")

    record = _load_record(db, req.record_type, req.record_id)
    if req.record_id and not record:
        raise HTTPException(status_code=404, detail=f"{req.record_type} record not found.")
    if record and record.erp_external_id and record.erp_sync_status == "synced":
        return {
            "status": "already_synced",
            "result": {
                "success": True,
                "external_id": record.erp_external_id,
                "message": f"{req.record_type} {_record_display_id(record, req.record_type)} is already synced to ERP."
            }
        }

    config = _server_config(req.erp_type)

    try:
        adapter = get_erp_adapter(req.erp_type, config)
        sync_data = dict(req.data or {})
        sync_data["_record_type"] = req.record_type
        result = (
            adapter.push_purchase_order(sync_data)
            if req.record_type == "po"
            else adapter.push_invoice(sync_data)
        )
        if not result.get("success"):
            raise HTTPException(
                status_code=502,
                detail=result.get("error", "ERP Sync Failed"),
            )

        external_id = result.get("external_id")
        if record:
            if external_id:
                record.erp_external_id = str(external_id)
                record.erp_sync_status = "synced"
                record.erp_synced_at = datetime.utcnow()
            else:
                record.erp_sync_status = "synced_no_external_id"
                record.erp_synced_at = datetime.utcnow()
            db.commit()

        return {"status": "synced", "result": result}
    except HTTPException:
        if record:
            record.erp_sync_status = "failed"
            record.erp_synced_at = datetime.utcnow()
            db.commit()
        raise
    except ValueError as exc:
        if record:
            record.erp_sync_status = "failed"
            record.erp_synced_at = datetime.utcnow()
            db.commit()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        if record:
            record.erp_sync_status = "failed"
            record.erp_synced_at = datetime.utcnow()
            db.commit()
        raise HTTPException(status_code=502, detail=f"ERP sync failed: {exc}") from exc


@router.post("/refresh-status")
def refresh_erp_status(
    req: RefreshStatusRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    if user.role == models.UserRole.manager:
        raise HTTPException(status_code=403, detail="Managers cannot trigger ERP status sync.")
    if req.record_type == "po" and user.role != models.UserRole.purchase:
        raise HTTPException(status_code=403, detail="Only Purchase users can sync PO statuses.")
    if req.record_type in ("invoice", "vendor_invoice") and user.role != models.UserRole.accounts:
        raise HTTPException(status_code=403, detail="Only Accounts users can sync invoice statuses.")

    config = _server_config(req.erp_type)
    adapter = get_erp_adapter(req.erp_type, config)

    records = []
    if req.record_type == "po":
        q = db.query(models.PurchaseOrder)
        records = [q.filter(models.PurchaseOrder.id == req.record_id).first()] if req.record_id else q.filter(models.PurchaseOrder.erp_external_id.isnot(None)).all()
    elif req.record_type == "invoice":
        q = db.query(models.Invoice)
        records = [q.filter(models.Invoice.id == req.record_id).first()] if req.record_id else q.filter(models.Invoice.erp_external_id.isnot(None)).all()
    elif req.record_type == "vendor_invoice":
        q = db.query(models.VendorInvoice)
        records = [q.filter(models.VendorInvoice.id == req.record_id).first()] if req.record_id else q.filter(models.VendorInvoice.erp_external_id.isnot(None)).all()

    records = [r for r in records if r is not None]
    updated = []

    for r in records:
        ext_id = r.erp_external_id or (getattr(r, 'invoice_number', None) or getattr(r, 'po_number', None))
        if not ext_id:
            continue
        try:
            res = adapter.get_payment_status(ext_id, record_type=req.record_type)
            st = res.get("status", "unknown")
            r.erp_payment_status = st
            r.erp_synced_at = datetime.utcnow()

            if st == "paid":
                if req.record_type == "invoice" and hasattr(models, "InvoiceStatus"):
                    r.status = models.InvoiceStatus.paid
                elif req.record_type == "vendor_invoice" and hasattr(models, "VendorInvoiceStatus"):
                    r.status = models.VendorInvoiceStatus.paid

            updated.append({
                "id": r.id,
                "external_id": ext_id,
                "erp_payment_status": r.erp_payment_status,
                "status": r.status.value if hasattr(r.status, "value") else str(r.status),
            })
        except Exception as err:
            updated.append({"id": r.id, "error": str(err)})

    db.commit()
    return {"refreshed_count": len(updated), "results": updated}
