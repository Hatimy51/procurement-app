from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.routers import products, prices, enquiries, enquiry_review, diagnostics, imports, suppliers, rfqs, supplier_quotes, quotes, purchase_orders, delivery_challans, invoices, inbox

app = FastAPI(title="Procurement Automation API", version="0.1.0")

# Allow the React frontend (running on a different port) to call this API.
# Tighten this once you know the real deployed frontend origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(products.router)
app.include_router(prices.router)
app.include_router(enquiries.router)
app.include_router(enquiry_review.router)
app.include_router(diagnostics.router)
app.include_router(imports.router)
app.include_router(suppliers.router)
app.include_router(rfqs.router)
app.include_router(supplier_quotes.router)
app.include_router(quotes.router)
app.include_router(purchase_orders.router)
app.include_router(delivery_challans.router)
app.include_router(invoices.router)
app.include_router(inbox.router)


@app.on_event("startup")
def on_startup():
    # v1 uses create_all for simplicity. Once the schema stabilizes,
    # switch to Alembic migrations so schema changes are tracked and
    # reversible instead of just "recreate the tables."
    Base.metadata.create_all(bind=engine)


@app.get("/api/health")
def health():
    return {"status": "ok"}
