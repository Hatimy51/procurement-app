from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app import models

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard Metrics"])


@router.get("/metrics")
def get_dashboard_kpis(db: Session = Depends(get_db)):
    """Real-time procurement KPIs for the Executive Dashboard."""
    total_pos = db.query(models.PurchaseOrder).count()
    total_invoices = db.query(models.Invoice).count()
    total_suppliers = db.query(models.Supplier).count()

    issued_invoices = (
        db.query(models.Invoice)
        .filter(models.Invoice.status == models.InvoiceStatus.issued)
        .all()
    )

    # 3-way-ready invoice count: an issued/draft invoice is considered
    # automatically matched only when its lines have prices and the
    # invoiced quantity does not exceed quantities dispatched by DCs.
    matched_invoices = 0
    for invoice in issued_invoices:
        ok = True
        for line in invoice.line_items:
            if line.unit_price is None:
                ok = False
                break
            dispatched = (
                db.query(func.coalesce(func.sum(models.DeliveryChallanLineItem.quantity_delivered), 0))
                .join(models.DeliveryChallan)
                .filter(
                    models.DeliveryChallanLineItem.quote_line_item_id == line.quote_line_item_id,
                    models.DeliveryChallan.status == models.DCStatus.dispatched,
                )
                .scalar()
            ) or 0
            if line.quantity_invoiced > dispatched:
                ok = False
                break
        if ok:
            matched_invoices += 1

    match_rate = round((matched_invoices / total_invoices * 100), 1) if total_invoices else 0.0

    open_po_value = (
        db.query(func.coalesce(func.sum(models.PurchaseOrder.total_amount), 0.0)).scalar()
        if hasattr(models.PurchaseOrder, "total_amount")
        else None
    )
    if open_po_value is None:
        open_pos = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.status != models.POStatus.draft).all()
        # v1 POs have no stored total_amount; calculate from line snapshots.
        open_po_value = 0.0
        for po in open_pos:
            for line in po.line_items:
                if line.unit_price is not None:
                    open_po_value += float(line.quantity * line.unit_price)
                if line.unit_price is not None and line.gst_percent:
                    open_po_value += float(line.quantity * line.unit_price * line.gst_percent / 100)

    return {
        "kpis": {
            "total_pos_issued": total_pos,
            "total_invoices_processed": total_invoices,
            "total_active_suppliers": total_suppliers,
            "auto_match_rate_percentage": f"{match_rate}%",
            "open_po_value": round(float(open_po_value or 0.0), 2),
            "estimated_time_saved_hours": round(total_invoices * 0.45, 1),
            "matched_invoices": matched_invoices,
        }
    }
