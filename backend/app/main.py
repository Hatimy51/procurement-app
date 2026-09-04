import os
from pathlib import Path
from fastapi import FastAPI, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.database import Base, engine
from app.security import require_router_access
from app.routers import (
    products, prices, enquiries, enquiry_review, diagnostics, imports,
    suppliers, rfqs, supplier_quotes, quotes, purchase_orders,
    delivery_challans, goods_receipt_notes, invoices, vendor_invoices,
    inbox, customers, auth, dashboard, accounting_sync, chat
)
from app.routers import store_locations, vendor_portal

# Use the same Limiter instance defined in auth.py so all rate-limit counters
# share one in-memory store. vendor_portal uses its own instance of the same
# key_func, which is fine for the default in-memory backend.
from app.routers.auth import limiter

app = FastAPI(title="Procurement Automation API", version="0.1.0")

# Attach limiter to app state so slowapi middleware can intercept 429 responses
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

raw_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173,http://127.0.0.1:3000"
)
allowed_origins = [o.strip() for o in raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# auth.router is deliberately NOT wrapped in require_router_access — login,
# logout, and first-time setup have to be reachable by someone who isn't
# logged in yet. Its individual endpoints protect themselves internally
# (see routers/auth.py) — most are public, /users is Admin-only.
app.include_router(auth.router)
app.include_router(accounting_sync.router, dependencies=[Depends(require_router_access("accounts"))])
app.include_router(quotes.quote_comparison_router, dependencies=[Depends(require_router_access("purchase"))])
app.include_router(dashboard.router, dependencies=[Depends(require_router_access("purchase"))])

# Vendor portal: public-facing (no internal session needed for vendor login/upload)
app.include_router(vendor_portal.router)

# Store locations: purchase + manager can manage; all authenticated users can read (for dropdowns)
app.include_router(store_locations.router)

# Chat: all authenticated users can read and write
app.include_router(chat.router)

# Every screen except Invoices belongs to Purchase (Manager can view,
# nobody but Purchase can edit) — see security.py for exactly what that
# dependency enforces, including the Manager-only "/approve" carve-out
# used by quotes.router.
_purchase_owned = [
    products, prices, enquiries, enquiry_review, diagnostics, imports,
    suppliers, rfqs, supplier_quotes, quotes, purchase_orders,
    delivery_challans, inbox, customers,
]
for router_module in _purchase_owned:
    app.include_router(router_module.router, dependencies=[Depends(require_router_access("purchase"))])

# GRNs are usable by Purchase + Manager + Store. The GRN router itself
# applies the Store-location restriction to every operation.
app.include_router(goods_receipt_notes.router, dependencies=[Depends(require_router_access("grn"))])

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
