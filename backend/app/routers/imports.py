import json
import os

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app.document_readers import parse_tabular_file
from app.schemas_import import ImportPreviewOut, ImportCommitOut

router = APIRouter(prefix="/api/imports", tags=["imports"])

# The Product/Price fields a client's spreadsheet column can be mapped onto.
# "name" is the only required one — matches Section 4 of the spec (Product
# needs a name; category/spec/unit/prices/GST are all optional).
TARGET_FIELDS = ["name", "category", "spec", "unit", "cost_price", "selling_price", "gst_percent"]

# 20 MB cap — generous enough for any real-world price-list spreadsheet
IMPORT_MAX_BYTES = int(os.getenv("IMPORT_MAX_BYTES", str(20 * 1024 * 1024)))


@router.post("/preview", response_model=ImportPreviewOut)
async def preview_import(file: UploadFile = File(...)):
    """
    Step 1 of the Import flow (spec Section 7): upload a file, see its columns
    and a few sample rows, so the Purchaser can map columns before anything
    is actually written to the database.
    """
    file_bytes = await file.read(IMPORT_MAX_BYTES + 1)
    if len(file_bytes) > IMPORT_MAX_BYTES:
        raise HTTPException(413, f"File is too large. Maximum allowed size is {IMPORT_MAX_BYTES // (1024 * 1024)} MB.")
    try:
        headers, rows = parse_tabular_file(file.filename, file_bytes)
    except ValueError as e:
        raise HTTPException(400, str(e))

    if not headers:
        raise HTTPException(400, "Could not find any columns in this file.")

    return ImportPreviewOut(
        headers=headers,
        sample_rows=rows[:5],
        total_rows=len(rows),
    )


@router.post("/commit", response_model=ImportCommitOut)
async def commit_import(
    mapping: str = Form(..., description="JSON: {target_field: source_column_name}"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Step 2 — the Purchaser has confirmed a column mapping; actually
    create/update Products and Price Entries from every row in the file.
    This is what makes the app usable for clients who already have an
    existing ERP/price list (spec Section 7), unlike the current test
    client who has none and builds the list up from real enquiries instead.
    """
    try:
        field_map = json.loads(mapping)
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid mapping JSON.")

    if not field_map.get("name"):
        raise HTTPException(400, "You must map a column to 'name' at minimum.")

    file_bytes = await file.read(IMPORT_MAX_BYTES + 1)
    if len(file_bytes) > IMPORT_MAX_BYTES:
        raise HTTPException(413, f"File is too large. Maximum allowed size is {IMPORT_MAX_BYTES // (1024 * 1024)} MB.")
    try:
        headers, rows = parse_tabular_file(file.filename, file_bytes)
    except ValueError as e:
        raise HTTPException(400, str(e))

    header_index = {h: i for i, h in enumerate(headers)}
    for target, source_col in field_map.items():
        if target not in TARGET_FIELDS:
            raise HTTPException(400, f"Unknown target field: {target}")
        if source_col and source_col not in header_index:
            raise HTTPException(400, f"Column '{source_col}' not found in file headers.")

    products_created = 0
    products_matched = 0
    price_entries_created = 0
    rows_skipped = 0
    skipped_reasons = []

    def cell(row, target):
        col = field_map.get(target)
        if not col:
            return None
        idx = header_index[col]
        val = row[idx] if idx < len(row) else ""
        return val.strip() if val else None

    for row in rows:
        name = cell(row, "name")
        if not name:
            rows_skipped += 1
            if len(skipped_reasons) < 5:
                skipped_reasons.append("Row skipped: no value in the column mapped to 'name'")
            continue

        product = db.query(models.Product).filter(models.Product.name == name).first()
        if product:
            products_matched += 1
        else:
            gst_raw = cell(row, "gst_percent")
            gst_value = None
            if gst_raw:
                try:
                    gst_value = float(gst_raw.replace("%", "").strip())
                except ValueError:
                    gst_value = None
            product = models.Product(
                name=name,
                category=cell(row, "category"),
                spec=cell(row, "spec"),
                unit=cell(row, "unit"),
                gst_percent=gst_value,
            )
            db.add(product)
            db.flush()
            products_created += 1

        cost_raw = cell(row, "cost_price")
        selling_raw = cell(row, "selling_price")
        if cost_raw or selling_raw:
            def to_decimal(v):
                if not v:
                    return None
                try:
                    return float(v.replace(",", ""))
                except ValueError:
                    return None

            price_entry = models.PriceEntry(
                product_id=product.id,
                cost_price=to_decimal(cost_raw),
                selling_price=to_decimal(selling_raw),
                source=models.PriceSource.bulk_import,
            )
            db.add(price_entry)
            price_entries_created += 1

    import_job = models.ImportJob(
        filename=file.filename,
        column_mapping=json.dumps(field_map),
        status="completed",
        rows_imported=str(products_created + products_matched),
    )
    db.add(import_job)
    db.commit()

    return ImportCommitOut(
        rows_processed=len(rows),
        products_created=products_created,
        products_matched=products_matched,
        price_entries_created=price_entries_created,
        rows_skipped=rows_skipped,
        skipped_reason_sample=skipped_reasons,
    )
