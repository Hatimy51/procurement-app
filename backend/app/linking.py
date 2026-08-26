"""
Product<->Supplier and Category<->Supplier linking.

Two ways these links get created:
  1. Manually, on the Supplier form (the user explicitly says "this
     supplier handles these products/categories").
  2. Automatically, whenever an RFQ is actually sent to a supplier for a
     product — so real usage builds this data up over time, per the plan.

Both paths funnel through ensure_product_supplier_link() below, so the
auto-created and manually-created links are indistinguishable once they
exist — there's no "source" flag, because from this point on it doesn't
matter how the link was formed, only that it exists.
"""
from sqlalchemy.orm import Session

from app import models


def ensure_product_supplier_link(db: Session, product_id: str, supplier_id: str):
    """Idempotent — safe to call every time an RFQ is created, won't
    create duplicate links for the same (product, supplier) pair."""
    exists = (
        db.query(models.ProductSupplierLink)
        .filter_by(product_id=product_id, supplier_id=supplier_id)
        .first()
    )
    if not exists:
        db.add(models.ProductSupplierLink(product_id=product_id, supplier_id=supplier_id))


def replace_supplier_links(db: Session, supplier_id: str, product_ids: list[str], categories: list[str]):
    """
    Full replace of this supplier's links — same pattern as editing a
    product's fields elsewhere in the app. There's no separate "manual"
    vs "auto" link type, so as long as the edit form pre-fills with
    everything currently linked (including links an RFQ auto-created),
    submitting without touching those checkboxes just recreates the same
    set unchanged. Only things the user actually unchecks are removed.
    """
    db.query(models.ProductSupplierLink).filter_by(supplier_id=supplier_id).delete()
    db.query(models.CategorySupplierLink).filter_by(supplier_id=supplier_id).delete()
    for pid in product_ids:
        db.add(models.ProductSupplierLink(product_id=pid, supplier_id=supplier_id))
    for cat in categories:
        db.add(models.CategorySupplierLink(category=cat, supplier_id=supplier_id))


def get_linked_supplier_ids_for_products(db: Session, product_ids: list[str]) -> set[str]:
    """All suppliers linked (directly or via category) to any of the
    given products — used to sort the RFQ wizard's supplier picker so
    linked suppliers surface first."""
    if not product_ids:
        return set()

    direct = {
        link.supplier_id
        for link in db.query(models.ProductSupplierLink)
        .filter(models.ProductSupplierLink.product_id.in_(product_ids))
        .all()
    }

    categories = {
        p.category
        for p in db.query(models.Product).filter(models.Product.id.in_(product_ids)).all()
        if p.category
    }
    via_category = set()
    if categories:
        via_category = {
            link.supplier_id
            for link in db.query(models.CategorySupplierLink)
            .filter(models.CategorySupplierLink.category.in_(categories))
            .all()
        }

    return direct | via_category
