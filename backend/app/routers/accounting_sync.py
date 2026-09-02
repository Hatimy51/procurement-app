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


class SyncRequest(BaseModel):
    erp_type: Literal["tally", "zoho"]
    record_type: Literal["po", "invoice"]
    data: Dict[str, Any]
    config: Optional[Dict[str, Any]] = Field(default=None)


def _server_config(erp_type: str) -> dict:
    """Resolve credentials/config on the server when the browser does not supply them."""
    if erp_type == "zoho":
        return {
            "zoho_api_key": os.getenv("ZOHO_API_KEY", ""),
            "zoho_org_id": os.getenv("ZOHO_ORG_ID", ""),
        }
    return {"tally_url": os.getenv("TALLY_URL", "http://localhost:9000")}


@router.post("/sync")
def sync_to_accounting(
    req: SyncRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    # Keep accounting writes aligned with the existing role model:
    # Purchase -> PO sync, Accounts -> invoice sync, Manager -> oversight only.
    if user.role == models.UserRole.manager:
        raise HTTPException(status_code=403, detail="Managers cannot push records to accounting.")
    if req.record_type == "po" and user.role != models.UserRole.purchase:
        raise HTTPException(status_code=403, detail="Only Purchase users can sync purchase orders.")
    if req.record_type == "invoice" and user.role != models.UserRole.accounts:
        raise HTTPException(status_code=403, detail="Only Accounts users can sync invoices.")

    config = req.config or _server_config(req.erp_type)
    # Avoid using an empty config accidentally when the request intentionally
    # supplied only non-secret settings.
    server_config = _server_config(req.erp_type)
    for key, value in server_config.items():
        if not config.get(key):
            config[key] = value

    try:
        adapter = get_erp_adapter(req.erp_type, config)
        result = (
            adapter.push_purchase_order(req.data)
            if req.record_type == "po"
            else adapter.push_invoice(req.data)
        )
        if not result.get("success"):
            raise HTTPException(
                status_code=502,
                detail=result.get("error", "ERP Sync Failed"),
            )
        return {"status": "synced", "result": result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
