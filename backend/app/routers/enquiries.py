from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.extraction.base import get_extraction_service, ENQUIRY_SCHEMA
from app.document_readers import extract_text_from_upload
from app.matching import is_exact_match

router = APIRouter(prefix="/api/enquiries", tags=["enquiries"])


def _ingest_from_text(
    customer_name: str | None, site_name: str | None, raw_text: str, db: Session,
    source: str = "manual",
) -> models.Enquiry:
    """
    Shared core of steps 1-4 of the v1 flow, regardless of how the raw text
    was obtained (pasted directly, converted from an Excel/image upload, or
    pulled from a connected inbox). One extraction pipeline serves every
    input format — see document_readers.py for how each format gets turned
    into text before reaching this function.

    customer_name/site_name are optional: manual submission already knows
    them (typed by the Purchaser), but an inbox-sourced enquiry doesn't —
    in that case they're left None here and filled in from the same
    extraction call's customer_name/site_name fields instead. If extraction
    can't tell either, the enquiry is still created (as "Unknown Customer"/
    "Unknown Site") rather than failing outright — every field is editable
    in the review screen anyway, so a human can fix it up right there.
    """
    try:
        extraction_service = get_extraction_service()
        result = extraction_service.extract(raw_text, ENQUIRY_SCHEMA)
    except Exception as e:
        # Surface the REAL failure (wrong/missing API key, unreachable Ollama,
        # bad model name, etc.) instead of letting it become a generic,
        # undiagnosable 500 — whichever provider is actually configured.
        raise HTTPException(500, f"Extraction failed: {e}")

    resolved_customer_name = customer_name or result.data.get("customer_name") or "Unknown Customer"
    resolved_site_name = site_name or result.data.get("site_name") or "Unknown Site"

    # Find or create customer/site — matches the real-world pattern from the
    # sample enquiries, where the same site recurs across multiple enquiries.
    customer = db.query(models.Customer).filter(
        models.Customer.name == resolved_customer_name
    ).first()
    if not customer:
        customer = models.Customer(name=resolved_customer_name)
        db.add(customer)
        db.flush()

    site = db.query(models.Site).filter(
        models.Site.name == resolved_site_name, models.Site.customer_id == customer.id
    ).first()
    if not site:
        site = models.Site(name=resolved_site_name, customer_id=customer.id)
        db.add(site)
        db.flush()

    enquiry = models.Enquiry(
        site_id=site.id,
        raw_source=raw_text,
        status=models.EnquiryStatus.new,
        source=source,
        extraction_confidence=result.confidence,
    )
    db.add(enquiry)
    db.flush()

    for item_data in result.data.get("items", []):
        # Use `or` (not just .get's default) everywhere here — the
        # extraction model sometimes returns a field explicitly as null
        # rather than omitting it, and .get()'s default only kicks in when
        # the key is missing entirely, not when it's present-but-empty.
        # This exact gap once let a single item with a null unit crash an
        # entire 14-item batch instead of just flagging that one item.
        description = item_data.get("description") or "Unknown item"
        spec = item_data.get("spec")
        unit = item_data.get("unit") or "unit"

        # Auto-link ONLY on a true exact match across name AND spec AND
        # unit (see matching.is_exact_match) — matching on name alone used
        # to silently link e.g. a "2 inch" enquiry to a "4 inch" product
        # whenever the names happened to be identical. Anything less than
        # fully exact is left unmatched here and instead gets a one-click
        # (never automatic) suggestion in the review screen.
        matched_product = None
        for candidate in db.query(models.Product).all():
            if is_exact_match(description, spec, unit, candidate):
                matched_product = candidate
                break

        item = models.EnquiryItem(
            enquiry_id=enquiry.id,
            description=description,
            spec=spec,
            brand=item_data.get("brand"),
            quantity=item_data.get("quantity") or 0,
            unit=unit,
            product_id=matched_product.id if matched_product else None,
        )
        db.add(item)

    db.commit()
    db.refresh(enquiry)
    return enquiry


@router.post("/ingest", response_model=schemas.EnquiryOut)
def ingest_enquiry(payload: schemas.EnquiryIngestRequest, db: Session = Depends(get_db)):
    """Ingest from pasted text (e.g. copy-pasted from an email)."""
    return _ingest_from_text(payload.customer_name, payload.site_name, payload.raw_text, db)


@router.post("/ingest-file", response_model=schemas.EnquiryOut)
async def ingest_enquiry_file(
    customer_name: str = Form(...),
    site_name: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Ingest from an uploaded file — Excel (.xlsx/.xls), CSV, or a screenshot/
    image (.png/.jpg/.jpeg/.webp) of a tabled enquiry that can't be
    copy-pasted as text at all. The file is converted to plain text first
    (see document_readers.py), then goes through the exact same extraction
    pipeline as pasted text.
    """
    file_bytes = await file.read()
    try:
        raw_text = extract_text_from_upload(file.filename, file_bytes)
    except ValueError as e:
        raise HTTPException(400, str(e))

    if not raw_text.strip():
        raise HTTPException(
            400,
            "Could not read any text from this file — for images, this usually "
            "means the OCR couldn't make out the content clearly enough.",
        )

    return _ingest_from_text(customer_name, site_name, raw_text, db)
