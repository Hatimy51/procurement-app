from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from decimal import Decimal

from app.database import get_db
from app import models

router = APIRouter(prefix="/api/supplier-quotes", tags=["supplier-quotes"])


@router.get("")
def list_quotes(db: Session = Depends(get_db)):
    """Powers the Quote History list — one row per supplier reply ever ingested."""
    quotes = db.query(models.SupplierQuote).order_by(models.SupplierQuote.created_at.desc()).all()
    out = []
    for q in quotes:
        item_count = (
            db.query(models.PriceEntry).filter(models.PriceEntry.supplier_quote_id == q.id).count()
        )
        out.append({
            "id": q.id,
            "supplier_id": q.supplier_id,
            "supplier_name": q.supplier.name if q.supplier else "Unknown supplier",
            "item_count": item_count,
            "created_at": q.created_at,
        })
    return out


@router.get("/{quote_id}")
def get_quote_detail(quote_id: str, db: Session = Depends(get_db)):
    """Powers the Quote History detail view: supplier, raw reply text, and
    every product this quote priced — editable in place."""
    quote = db.query(models.SupplierQuote).filter(models.SupplierQuote.id == quote_id).first()
    if not quote:
        raise HTTPException(404, "Quote not found")

    price_entries = (
        db.query(models.PriceEntry).filter(models.PriceEntry.supplier_quote_id == quote_id).all()
    )
    items = [
        {
            "price_entry_id": pe.id,
            "product_id": pe.product_id,
            "product_name": pe.product.name if pe.product else "Unknown product",
            "spec": pe.product.spec if pe.product else None,
            "unit": pe.product.unit if pe.product else None,
            "cost_price": pe.cost_price,
            "selling_price": pe.selling_price,
        }
        for pe in price_entries
    ]

    return {
        "id": quote.id,
        "supplier_id": quote.supplier_id,
        "supplier_name": quote.supplier.name if quote.supplier else "Unknown supplier",
        "raw_source": quote.raw_source or "",
        "extraction_confidence": quote.extraction_confidence,
        "created_at": quote.created_at,
        "items": items,
    }


class ItemPriceUpdate(BaseModel):
    price_entry_id: str
    cost_price: Decimal | None = None
    selling_price: Decimal | None = None


class BulkItemUpdate(BaseModel):
    items: list[ItemPriceUpdate]


@router.put("/{quote_id}/items")
def bulk_update_items(quote_id: str, payload: BulkItemUpdate, db: Session = Depends(get_db)):
    """The "Save All" action — updates every edited row from the quote
    detail view in one call, instead of one request per row."""
    quote = db.query(models.SupplierQuote).filter(models.SupplierQuote.id == quote_id).first()
    if not quote:
        raise HTTPException(404, "Quote not found")

    updated = 0
    for item in payload.items:
        entry = (
            db.query(models.PriceEntry)
            .filter(
                models.PriceEntry.id == item.price_entry_id,
                models.PriceEntry.supplier_quote_id == quote_id,
            )
            .first()
        )
        if not entry:
            continue  # skip silently — e.g. already removed via the per-item delete
        if item.cost_price is not None:
            entry.cost_price = item.cost_price
        if item.selling_price is not None:
            entry.selling_price = item.selling_price
        updated += 1

    db.commit()
    return {"updated": updated}


@router.delete("/{quote_id}/items/{price_entry_id}")
def delete_quote_item(quote_id: str, price_entry_id: str, db: Session = Depends(get_db)):
    """The "cross" button — removes one product's price entry that came
    from this quote (e.g. it was matched wrongly), without touching the
    rest of the quote or the quote record itself."""
    entry = (
        db.query(models.PriceEntry)
        .filter(models.PriceEntry.id == price_entry_id, models.PriceEntry.supplier_quote_id == quote_id)
        .first()
    )
    if not entry:
        raise HTTPException(404, "Price entry not found on this quote")
    db.delete(entry)
    db.commit()
    return {"deleted": True, "id": price_entry_id}


@router.delete("/{quote_id}")
def delete_quote(quote_id: str, db: Session = Depends(get_db)):
    """Deletes the entire quote submission along with every price entry
    it produced — same 'delete the whole thing' pattern as Enquiries."""
    quote = db.query(models.SupplierQuote).filter(models.SupplierQuote.id == quote_id).first()
    if not quote:
        raise HTTPException(404, "Quote not found")

    removed = (
        db.query(models.PriceEntry)
        .filter(models.PriceEntry.supplier_quote_id == quote_id)
        .delete(synchronize_session=False)
    )
    db.delete(quote)
    db.commit()
    return {"deleted": True, "id": quote_id, "price_entries_removed": removed}
