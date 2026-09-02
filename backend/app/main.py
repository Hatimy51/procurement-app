import os
from pathlib import Path
from fastapi import FastAPI, Depends
from sqlalchemy import text
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.security import require_router_access
from app.routers import (
    products, prices, enquiries, enquiry_review, diagnostics, imports,
    suppliers, rfqs, supplier_quotes, quotes, purchase_orders,
    delivery_challans, goods_receipt_notes, invoices, vendor_invoices,
    inbox, customers, auth, dashboard, accounting_sync,
)
from app.routers import store_locations, vendor_portal

app = FastAPI(title="Procurement Automation API", version="0.1.0")

# Allow the React frontend (running on a different port) to call this API.
# Tighten this once you know the real deployed frontend origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# auth.router is deliberately NOT wrapped in require_router_access — login,
# logout, and first-time setup have to be reachable by someone who isn't
# logged in yet. Its individual endpoints protect themselves internally
# (see routers/auth.py) — most are public, /users is Admin-only.
app.include_router(auth.router)
app.include_router(accounting_sync.router)
app.include_router(quotes.quote_comparison_router, dependencies=[Depends(require_router_access("purchase"))])
app.include_router(dashboard.router, dependencies=[Depends(require_router_access("purchase"))])

# Vendor portal: public-facing (no internal session needed for vendor login/upload)
app.include_router(vendor_portal.router)

# Store locations: purchase + manager can manage; all authenticated users can read (for dropdowns)
app.include_router(store_locations.router)

# Every screen except Invoices belongs to Purchase (Manager can view,
# nobody but Purchase can edit) — see security.py for exactly what that
# dependency enforces, including the Manager-only "/approve" carve-out
# used by quotes.router.
_purchase_owned = [
    products, prices, enquiries, enquiry_review, diagnostics, imports,
    suppliers, rfqs, supplier_quotes, quotes, purchase_orders,
    delivery_challans, goods_receipt_notes, inbox, customers,
]
for router_module in _purchase_owned:
    app.include_router(router_module.router, dependencies=[Depends(require_router_access("purchase"))])

# Invoices belong to Accounts alone (Manager can still view, per the same
# oversight rule as everywhere else).
app.include_router(invoices.router, dependencies=[Depends(require_router_access("accounts"))])
app.include_router(vendor_invoices.router, dependencies=[Depends(require_router_access("accounts"))])


@app.on_event("startup")
def on_startup():
    # Create all tables defined in SQLAlchemy Base
    Base.metadata.create_all(bind=engine)

    # Run PostgreSQL migrations on startup
    if engine.dialect.name == "postgresql":
        migrations_dir = Path(__file__).parent / "migrations"
        for migration_file in sorted(migrations_dir.glob("*.sql")):
            with engine.begin() as conn:
                sql_content = migration_file.read_text(encoding="utf-8")
                conn.execute(text(sql_content))


@app.get("/api/health")
def health():
    return {"status": "ok"}
