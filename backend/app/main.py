from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.security import require_router_access
from app.routers import products, prices, enquiries, enquiry_review, diagnostics, imports, suppliers, rfqs, supplier_quotes, quotes, purchase_orders, delivery_challans, invoices, inbox, customers, auth

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
    # v1 uses create_all for simplicity. Once the schema stabilizes,
    # switch to Alembic migrations so schema changes are tracked and
    # reversible instead of just "recreate the tables."
    Base.metadata.create_all(bind=engine)


@app.get("/api/health")
def health():
    return {"status": "ok"}
