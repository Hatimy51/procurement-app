from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app import models

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard Metrics"])


@router.get("/metrics")
def get_dashboard_kpis(db: Session = Depends(get_db)):
    """Real-time procurement KPIs for the Executive Dashboard, featuring exact 3-Way Line Matching."""
    total_pos = db.query(models.PurchaseOrder).count()
    total_cust_invoices = db.query(models.Invoice).count()
    total_vendor_invoices = db.query(models.VendorInvoice).count()
    total_suppliers = db.query(models.Supplier).count()

    vendor_invoices = db.query(models.VendorInvoice).all()
    fully_matched_vendor = 0
    discrepancy_vendor = 0
    pending_receipt_vendor = 0

    for vi in vendor_invoices:
        if not vi.line_items:
            continue
        all_lines_ok = True
        has_discrepancy = False
        has_pending = False

        for li in vi.line_items:
            po_li = li.purchase_order_line_item
            if not po_li:
                continue

            # Calculate total received so far across GRNs for this PO line
            received_qty = (
                db.query(func.coalesce(func.sum(models.GoodsReceiptNoteLineItem.quantity_received), 0))
                .join(models.GoodsReceiptNote)
                .filter(
                    models.GoodsReceiptNoteLineItem.po_line_item_id == po_li.id,
                    models.GoodsReceiptNote.status == models.GRNStatus.received,
                )
                .scalar()
            ) or 0

            # Check quantity match
            if li.quantity_invoiced > received_qty:
                has_discrepancy = True
                all_lines_ok = False
            elif received_qty == 0:
                has_pending = True
                all_lines_ok = False

            # Check price match against PO
            if po_li.unit_price is not None and li.unit_price is not None:
                if li.unit_price > po_li.unit_price:
                    has_discrepancy = True
                    all_lines_ok = False

        if all_lines_ok:
            fully_matched_vendor += 1
        elif has_discrepancy:
            discrepancy_vendor += 1
        elif has_pending:
            pending_receipt_vendor += 1

    total_evaluated = total_vendor_invoices or total_cust_invoices
    matched_count = fully_matched_vendor if total_vendor_invoices else 0
    
    # If no vendor invoices exist yet, evaluate customer invoices against dispatched challans
    if total_vendor_invoices == 0 and total_cust_invoices > 0:
        issued_invoices = db.query(models.Invoice).filter(models.Invoice.status == models.InvoiceStatus.issued).all()
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
                matched_count += 1

    match_rate = round((matched_count / total_evaluated * 100), 1) if total_evaluated else 100.0

    open_po_value = 0.0
    open_pos = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.status != models.POStatus.draft).all()
    for po in open_pos:
        for line in po.line_items:
            if line.unit_price is not None:
                open_po_value += float(line.quantity * line.unit_price)
            if line.unit_price is not None and line.gst_percent:
                open_po_value += float(line.quantity * line.unit_price * line.gst_percent / 100)

    # Calculate average procurement lead time (from PO created_at to first GRN received_at)
    lead_times = []
    sent_pos = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.status == models.POStatus.sent).all()
    for po in sent_pos:
        for grn in po.goods_receipt_notes:
            if grn.status == models.GRNStatus.received and grn.received_at and po.created_at:
                diff_days = (grn.received_at - po.created_at).total_seconds() / 86400.0
                if diff_days >= 0:
                    lead_times.append(diff_days)
    avg_lead_time = round(sum(lead_times) / len(lead_times), 1) if lead_times else None

    # Savings are only reported when backed by persisted benchmark/award data.
    # The current schema does not persist such a benchmark, so do not invent a percentage.
    total_savings_inr = None

    return {
        "kpis": {
            "total_pos_issued": total_pos,
            "total_invoices_processed": total_vendor_invoices + total_cust_invoices,
            "total_active_suppliers": total_suppliers,
            "auto_match_rate_percentage": f"{match_rate}%",
            "open_po_value": round(float(open_po_value or 0.0), 2),
            "estimated_time_saved_hours": round((total_vendor_invoices + total_cust_invoices) * 0.45, 1),
            "total_savings_inr": total_savings_inr,
            "avg_lead_time_days": avg_lead_time,
            "matched_invoices": matched_count,
            "fully_matched_count": fully_matched_vendor,
            "discrepancy_count": discrepancy_vendor,
            "pending_receipt_count": pending_receipt_vendor,
        }
    }
