from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app import models
from app.extraction.base import get_extraction_service, SUPPLIER_QUOTE_SCHEMA
from app.document_readers import extract_text_from_upload
from app.matching import match_items_to_candidates
from app.linking import ensure_product_supplier_link

router = APIRouter(prefix="/api/rfqs", tags=["rfqs"])


class RFQCreate(BaseModel):
    product_id: str
    supplier_id: str
    enquiry_item_id: str | None = None
    quantity: Decimal | None = None


@router.post("")
def create_rfq(payload: RFQCreate, db: Session = Depends(get_db)):
    """
    Step 5 of the v1 flow: the Purchaser is sending an RFQ to a supplier for
    a specific product with a missing price. The actual email is sent
    outside the app (per the spec) — this just tracks that it's pending,
    so the reply can later be matched back to it.
    """
    product = db.query(models.Product).filter(models.Product.id == payload.product_id).first()
    if not product:
        raise HTTPException(404, "Product not found")
    supplier = db.query(models.Supplier).filter(models.Supplier.id == payload.supplier_id).first()
    if not supplier:
        raise HTTPException(404, "Supplier not found")

    rfq = models.RFQ(
        product_id=payload.product_id,
        supplier_id=payload.supplier_id,
        enquiry_item_id=payload.enquiry_item_id,
        quantity=payload.quantity,
        status=models.RFQStatus.pending,
    )
    db.add(rfq)
    ensure_product_supplier_link(db, payload.product_id, payload.supplier_id)
    db.commit()
    db.refresh(rfq)
    return _rfq_out(rfq)


class BulkRFQItem(BaseModel):
    product_id: str
    quantity: Decimal | None = None


class BulkRFQCreate(BaseModel):
    items: list[BulkRFQItem]
    supplier_ids: list[str]


@router.post("/bulk")
def create_rfqs_bulk(payload: BulkRFQCreate, db: Session = Depends(get_db)):
    """
    Powers the "Request Quote" wizard: one or more items (individually
    picked, or every product in one or more selected categories — that
    expansion happens client-side) sent to one or more suppliers at once.
    Creates one RFQ per (item, supplier) pair — e.g. 5 items × 3 suppliers
    = 15 RFQ records — so each supplier's eventual reply about a specific
    product still matches back to exactly one pending request, the same
    way single RFQs already work.
    """
    if not payload.items:
        raise HTTPException(400, "Select at least one product or category.")
    if not payload.supplier_ids:
        raise HTTPException(400, "Select at least one supplier.")

    product_ids = [i.product_id for i in payload.items]
    found_products = {
        p.id for p in db.query(models.Product).filter(models.Product.id.in_(product_ids)).all()
    }
    missing_products = set(product_ids) - found_products
    if missing_products:
        raise HTTPException(404, f"Product(s) not found: {', '.join(missing_products)}")

    found_suppliers = {
        s.id for s in db.query(models.Supplier).filter(models.Supplier.id.in_(payload.supplier_ids)).all()
    }
    missing_suppliers = set(payload.supplier_ids) - found_suppliers
    if missing_suppliers:
        raise HTTPException(404, f"Supplier(s) not found: {', '.join(missing_suppliers)}")

    created = []
    for item in payload.items:
        for supplier_id in payload.supplier_ids:
            rfq = models.RFQ(
                product_id=item.product_id,
                supplier_id=supplier_id,
                quantity=item.quantity,
                status=models.RFQStatus.pending,
            )
            db.add(rfq)
            ensure_product_supplier_link(db, item.product_id, supplier_id)
            created.append(rfq)
    db.commit()

    return {
        "rfqs_created": len(created),
        "items_count": len(payload.items),
        "suppliers_count": len(payload.supplier_ids),
    }


class RFQGroup(BaseModel):
    """One 'send these specific items to these specific suppliers'
    assignment — the RFQ wizard lets the Purchaser build several of these,
    e.g. items 1,2,4 to Supplier XYZ and items 3,5 to Supplier ABC, in one
    submission."""
    items: list[BulkRFQItem]
    supplier_ids: list[str]


class GroupedRFQCreate(BaseModel):
    groups: list[RFQGroup]


@router.post("/bulk-grouped")
def create_rfqs_bulk_grouped(payload: GroupedRFQCreate, db: Session = Depends(get_db)):
    """
    The real "Request Quote" flow: different subsets of the originally
    selected items can go to different suppliers, not just one flat
    cross-product. Validates every product/supplier ID across ALL groups
    BEFORE creating anything, so this is all-or-nothing — either every
    group's RFQs get created, or none do, rather than leaving a partial
    mess if one group references something invalid.
    """
    if not payload.groups:
        raise HTTPException(400, "Add at least one group.")

    all_product_ids = set()
    all_supplier_ids = set()
    for group in payload.groups:
        if not group.items:
            raise HTTPException(400, "Every group needs at least one item.")
        if not group.supplier_ids:
            raise HTTPException(400, "Every group needs at least one supplier.")
        all_product_ids.update(i.product_id for i in group.items)
        all_supplier_ids.update(group.supplier_ids)

    found_products = {
        p.id for p in db.query(models.Product).filter(models.Product.id.in_(all_product_ids)).all()
    }
    missing_products = all_product_ids - found_products
    if missing_products:
        raise HTTPException(404, f"Product(s) not found: {', '.join(missing_products)}")

    found_suppliers = {
        s.id for s in db.query(models.Supplier).filter(models.Supplier.id.in_(all_supplier_ids)).all()
    }
    missing_suppliers = all_supplier_ids - found_suppliers
    if missing_suppliers:
        raise HTTPException(404, f"Supplier(s) not found: {', '.join(missing_suppliers)}")

    total_created = 0
    for group in payload.groups:
        for item in group.items:
            for supplier_id in group.supplier_ids:
                db.add(models.RFQ(
                    product_id=item.product_id,
                    supplier_id=supplier_id,
                    quantity=item.quantity,
                    status=models.RFQStatus.pending,
                ))
                ensure_product_supplier_link(db, item.product_id, supplier_id)
                total_created += 1
    db.commit()

    return {"rfqs_created": total_created, "groups_count": len(payload.groups)}


def _rfq_out(rfq: models.RFQ):
    return {
        "id": rfq.id,
        "status": rfq.status.value if hasattr(rfq.status, "value") else rfq.status,
        "product_id": rfq.product_id,
        "product_name": rfq.product.name if rfq.product else None,
        "quantity": rfq.quantity,
        "supplier_id": rfq.supplier_id,
        "supplier_name": rfq.supplier.name if rfq.supplier else None,
        "created_at": rfq.created_at,
    }


@router.get("")
def list_rfqs(status: str | None = None, db: Session = Depends(get_db)):
    q = db.query(models.RFQ)
    if status:
        q = q.filter(models.RFQ.status == status)
    rfqs = q.order_by(models.RFQ.created_at.desc()).all()
    return [_rfq_out(r) for r in rfqs]


def _ingest_quote_for_supplier(supplier_id: str, raw_text: str, db: Session):
    """
    Reads ONE supplier reply that may cover several of the RFQs we sent
    them, extracts every priced item in it, and matches each one back to
    the correct pending RFQ — updating whichever it can confidently match
    and leaving the rest pending. This is the realistic shape of how a
    supplier actually replies to a multi-item RFQ: one email, several
    items, not one email per item.
    """
    supplier = db.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(404, "Supplier not found")

    pending_rfqs = (
        db.query(models.RFQ)
        .filter(models.RFQ.supplier_id == supplier_id, models.RFQ.status == models.RFQStatus.pending)
        .all()
    )
    if not pending_rfqs:
        raise HTTPException(400, "No pending RFQs for this supplier — nothing to match a reply against.")

    extraction_service = get_extraction_service()
    try:
        result = extraction_service.extract(raw_text, SUPPLIER_QUOTE_SCHEMA)
    except Exception as e:
        raise HTTPException(500, f"Extraction failed: {e}")

    extracted_items = result.data.get("items", [])
    if not extracted_items:
        raise HTTPException(
            400,
            "Could not find any priced items in that reply. You can still add prices "
            "manually on the Product & Price List screen.",
        )

    candidate_products = [rfq.product for rfq in pending_rfqs if rfq.product]
    matches, unmatched_products, unmatched_item_indices = match_items_to_candidates(
        extracted_items, candidate_products
    )

    rfqs_by_product_id = {rfq.product_id: rfq for rfq in pending_rfqs}
    priced = []
    for product, item, score in matches:
        rfq = rfqs_by_product_id[product.id]
        price = item["price"]

        db.add(models.SupplierQuote(
            rfq_id=rfq.id,
            raw_source=raw_text,
            extracted_price=price,
            extraction_confidence=result.confidence,
        ))
        db.add(models.PriceEntry(
            product_id=product.id,
            cost_price=price,
            selling_price=None,
            source=models.PriceSource.supplier_quote,
        ))
        rfq.status = models.RFQStatus.quote_received
        priced.append({"product_name": product.name, "price": price, "match_score": score})

    db.commit()

    return {
        "priced": priced,
        "still_pending": [p.name for p in unmatched_products],
        "extra_items_in_reply_not_matched": [
            extracted_items[i].get("description") for i in unmatched_item_indices
        ],
    }


@router.post("/ingest-quote-for-supplier")
def ingest_quote_for_supplier_text(
    supplier_id: str = Form(...), raw_text: str = Form(...), db: Session = Depends(get_db)
):
    """Ingest a supplier's reply from pasted text — covers however many of
    their pending RFQs it mentions, in one action."""
    return _ingest_quote_for_supplier(supplier_id, raw_text, db)


@router.post("/ingest-quote-file-for-supplier")
async def ingest_quote_file_for_supplier(
    supplier_id: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)
):
    """Same as above, from an uploaded file (Excel/CSV/screenshot)."""
    file_bytes = await file.read()
    try:
        raw_text = extract_text_from_upload(file.filename, file_bytes)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not raw_text.strip():
        raise HTTPException(400, "Could not read any text from this file.")
    return _ingest_quote_for_supplier(supplier_id, raw_text, db)
