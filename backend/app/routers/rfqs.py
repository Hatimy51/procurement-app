from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app import models
from app.extraction.base import get_extraction_service, SUPPLIER_QUOTE_SCHEMA
from app.document_readers import extract_text_from_upload

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
            created.append(rfq)
    db.commit()

    return {
        "rfqs_created": len(created),
        "items_count": len(payload.items),
        "suppliers_count": len(payload.supplier_ids),
    }


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


def _ingest_quote_text(rfq: models.RFQ, raw_text: str, db: Session):
    """
    Shared core: read a supplier's reply (however it arrived), extract a
    price, create a SupplierQuote record + a new PriceEntry (the same
    self-building price mechanism as Import, just sourced from a real
    supplier reply instead of a bulk file), and mark the RFQ resolved.

    v1 simplification: an RFQ is tied to one product, so this takes the
    first extracted item's price rather than trying to match multiple
    items in a single reply — worth revisiting if suppliers commonly
    quote several products in one email reply to a single RFQ.
    """
    extraction_service = get_extraction_service()
    try:
        result = extraction_service.extract(raw_text, SUPPLIER_QUOTE_SCHEMA)
    except Exception as e:
        raise HTTPException(500, f"Extraction failed: {e}")

    items = result.data.get("items", [])
    if not items or items[0].get("price") is None:
        raise HTTPException(
            400,
            "Could not find a price in that reply. You can still add the price "
            "manually on the Product & Price List screen.",
        )

    extracted_price = items[0]["price"]

    supplier_quote = models.SupplierQuote(
        rfq_id=rfq.id,
        raw_source=raw_text,
        extracted_price=extracted_price,
        extraction_confidence=result.confidence,
    )
    db.add(supplier_quote)

    price_entry = models.PriceEntry(
        product_id=rfq.product_id,
        cost_price=extracted_price,
        selling_price=None,  # Purchaser adds markup/selling price separately
        source=models.PriceSource.supplier_quote,
    )
    db.add(price_entry)

    rfq.status = models.RFQStatus.quote_received
    db.commit()

    return {
        "rfq": _rfq_out(rfq),
        "extracted_price": extracted_price,
        "extraction_confidence": result.confidence,
    }


@router.post("/{rfq_id}/ingest-quote")
def ingest_quote_text(rfq_id: str, raw_text: str = Form(...), db: Session = Depends(get_db)):
    """Ingest from pasted text (the supplier's reply email body)."""
    rfq = db.query(models.RFQ).filter(models.RFQ.id == rfq_id).first()
    if not rfq:
        raise HTTPException(404, "RFQ not found")
    return _ingest_quote_text(rfq, raw_text, db)


@router.post("/{rfq_id}/ingest-quote-file")
async def ingest_quote_file(rfq_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Ingest from an uploaded file (Excel/CSV/screenshot of the reply) —
    same document readers as the enquiry-side upload path."""
    rfq = db.query(models.RFQ).filter(models.RFQ.id == rfq_id).first()
    if not rfq:
        raise HTTPException(404, "RFQ not found")

    file_bytes = await file.read()
    try:
        raw_text = extract_text_from_upload(file.filename, file_bytes)
    except ValueError as e:
        raise HTTPException(400, str(e))

    if not raw_text.strip():
        raise HTTPException(400, "Could not read any text from this file.")

    return _ingest_quote_text(rfq, raw_text, db)
