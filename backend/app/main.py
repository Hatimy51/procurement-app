from fastapi import FastAPI, Depends
from sqlalchemy import text
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.security import require_router_access
from app.routers import products, prices, enquiries, enquiry_review, diagnostics, imports, suppliers, rfqs, supplier_quotes, quotes, purchase_orders, delivery_challans, invoices, inbox, customers, auth, dashboard, accounting_sync

app = FastAPI(title="Procurement Automation API", version="0.1.0")

# Allow the React frontend (running on a different port) to call this API.
# Tighten this once you know the real deployed frontend origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# auth.router is deliberately NOT wrapped in require_router_access — login,
# logout, and first-time setup have to be reachable by someone who isn't
# logged in yet. Its individual endpoints protect themselves internally
# (see routers/auth.py) — most are public, /users is Manager-only.
app.include_router(auth.router)
app.include_router(accounting_sync.router)
app.include_router(quotes.quote_comparison_router, dependencies=[Depends(require_router_access("purchase"))])
app.include_router(dashboard.router, dependencies=[Depends(require_router_access("purchase"))])

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

# Invoices belong to Accounts alone (Manager can still view, per the same
# oversight rule as everywhere else).
app.include_router(invoices.router, dependencies=[Depends(require_router_access("accounts"))])


@app.on_event("startup")
def on_startup():
    # v1 still uses create_all for simplicity. The small compatibility
    # migration below upgrades an existing v1 Postgres database in place for
    # PO-linked GRN/DC support; fresh databases simply no-op on these ALTERs.
    Base.metadata.create_all(bind=engine)

    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE delivery_challans "
                "ALTER COLUMN customer_quote_id DROP NOT NULL"
            ))
            conn.execute(text(
                "ALTER TABLE delivery_challan_line_items "
                "ALTER COLUMN quote_line_item_id DROP NOT NULL"
            ))
            conn.execute(text(
                "ALTER TABLE delivery_challans "
                "ADD COLUMN IF NOT EXISTS po_id UUID "
                "REFERENCES purchase_orders(id)"
            ))
            conn.execute(text(
                "ALTER TABLE delivery_challan_line_items "
                "ADD COLUMN IF NOT EXISTS po_line_item_id UUID "
                "REFERENCES purchase_order_line_items(id)"
            ))


@app.get("/api/health")
def health():
    return {"status": "ok"}
