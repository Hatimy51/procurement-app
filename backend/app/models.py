"""
Data model — mirrors Section 4 of the v1 spec document exactly.

Every table here maps to an entity in the spec's data model table, so if you're
cross-checking against the doc, the names match on purpose.
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Text, ForeignKey, DateTime, Numeric, Enum, Boolean, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class EnquiryStatus(str, enum.Enum):
    new = "new"
    reviewed = "reviewed"
    quoted = "quoted"
    approved = "approved"
    sent = "sent"


class RFQStatus(str, enum.Enum):
    pending = "pending"
    quote_received = "quote_received"
    cancelled = "cancelled"


class QuoteStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"
    sent = "sent"


class PriceSource(str, enum.Enum):
    manual = "manual"
    supplier_quote = "supplier_quote"
    bulk_import = "import"


class Customer(Base):
    __tablename__ = "customers"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)
    contact_info = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    sites = relationship("Site", back_populates="customer")


class Site(Base):
    __tablename__ = "sites"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)
    customer_id = Column(UUID(as_uuid=False), ForeignKey("customers.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    customer = relationship("Customer", back_populates="sites")
    enquiries = relationship("Enquiry", back_populates="site")


class Enquiry(Base):
    __tablename__ = "enquiries"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    site_id = Column(UUID(as_uuid=False), ForeignKey("sites.id"), nullable=False)
    raw_source = Column(Text)  # original email/screenshot text as received
    status = Column(Enum(EnquiryStatus), default=EnquiryStatus.new, nullable=False)
    extraction_confidence = Column(Numeric, nullable=True)
    source = Column(String, nullable=False, default="manual")  # "manual" or "gmail"
    created_at = Column(DateTime, default=datetime.utcnow)

    site = relationship("Site", back_populates="enquiries")
    items = relationship("EnquiryItem", back_populates="enquiry", cascade="all, delete-orphan")
    quotes = relationship("Quote", back_populates="enquiry")


class EnquiryItem(Base):
    __tablename__ = "enquiry_items"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    enquiry_id = Column(UUID(as_uuid=False), ForeignKey("enquiries.id"), nullable=False)
    description = Column(String, nullable=False)
    spec = Column(String)
    brand = Column(String, nullable=True)
    quantity = Column(Numeric, nullable=False)
    unit = Column(String, nullable=False)
    product_id = Column(UUID(as_uuid=False), ForeignKey("products.id"), nullable=True)

    enquiry = relationship("Enquiry", back_populates="items")
    product = relationship("Product")


class Product(Base):
    __tablename__ = "products"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)
    category = Column(String, nullable=True)
    spec = Column(String, nullable=True)
    unit = Column(String, nullable=True)
    gst_percent = Column(Numeric, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    price_entries = relationship("PriceEntry", back_populates="product", order_by="desc(PriceEntry.date)")


class Supplier(Base):
    __tablename__ = "suppliers"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    contact_info = Column(Text)  # legacy free-text field, kept but no longer shown in the UI
    created_at = Column(DateTime, default=datetime.utcnow)


class ProductSupplierLink(Base):
    """
    Which suppliers handle which specific products — built two ways: the
    user can link them manually on the Supplier form, and the app also
    auto-creates a link every time an RFQ is actually sent to a supplier
    for a product, so the data builds itself from real usage over time.
    """
    __tablename__ = "product_supplier_links"
    __table_args__ = (UniqueConstraint("product_id", "supplier_id", name="uq_product_supplier"),)
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    product_id = Column(UUID(as_uuid=False), ForeignKey("products.id"), nullable=False)
    supplier_id = Column(UUID(as_uuid=False), ForeignKey("suppliers.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class CategorySupplierLink(Base):
    """Broader version of the above — 'this supplier handles our whole
    Pipes category,' not just one specific product. Category is stored as
    the plain string used on Product.category, not a separate table."""
    __tablename__ = "category_supplier_links"
    __table_args__ = (UniqueConstraint("category", "supplier_id", name="uq_category_supplier"),)
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    category = Column(String, nullable=False)
    supplier_id = Column(UUID(as_uuid=False), ForeignKey("suppliers.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class RFQ(Base):
    __tablename__ = "rfqs"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    product_id = Column(UUID(as_uuid=False), ForeignKey("products.id"), nullable=False)
    supplier_id = Column(UUID(as_uuid=False), ForeignKey("suppliers.id"), nullable=False)
    enquiry_item_id = Column(UUID(as_uuid=False), ForeignKey("enquiry_items.id"), nullable=True)
    quantity = Column(Numeric, nullable=True)
    status = Column(Enum(RFQStatus), default=RFQStatus.pending, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    product = relationship("Product")
    supplier = relationship("Supplier")


class SupplierQuote(Base):
    """
    Now represents ONE reply/submission from a supplier — which can cover
    several products at once — rather than one row per matched item. The
    Quote History screen lists these; each one's PriceEntry rows (below)
    are the products it actually priced.
    """
    __tablename__ = "supplier_quotes"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    supplier_id = Column(UUID(as_uuid=False), ForeignKey("suppliers.id"), nullable=True)
    rfq_id = Column(UUID(as_uuid=False), ForeignKey("rfqs.id"), nullable=True)  # legacy, unused going forward
    raw_source = Column(Text)
    extracted_price = Column(Numeric, nullable=True)  # legacy, unused going forward
    extraction_confidence = Column(Numeric, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    supplier = relationship("Supplier")
    rfq = relationship("RFQ")


class PriceEntry(Base):
    __tablename__ = "price_entries"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    product_id = Column(UUID(as_uuid=False), ForeignKey("products.id"), nullable=False)
    cost_price = Column(Numeric, nullable=True)
    selling_price = Column(Numeric, nullable=True)
    date = Column(DateTime, default=datetime.utcnow)
    source = Column(Enum(PriceSource), default=PriceSource.manual, nullable=False)
    supplier_quote_id = Column(UUID(as_uuid=False), ForeignKey("supplier_quotes.id"), nullable=True)

    product = relationship("Product", back_populates="price_entries")


class Quote(Base):
    """
    A customer-facing quote generated from a reviewed Enquiry. Line items are
    SNAPSHOTTED at generation time (see QuoteLineItem) rather than read live
    off the Enquiry/Product, so a quote that's been approved or sent doesn't
    silently change if someone later edits the enquiry item or updates a
    product's price/GST — the same "protect the historical record" principle
    already used for price history elsewhere in the app.

    approved_by_name is a free-text field, not a real user account — there's
    no login/user system built anywhere in the app yet (the `users` table
    exists in the schema but nothing creates or manages User rows), so this
    stays a simple name entered at approval time rather than forcing a full
    auth build to unblock this feature.
    """
    __tablename__ = "quotes"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    quote_number = Column(String, nullable=False)  # human-friendly reference, e.g. "Q-A1B2C3D4"
    enquiry_id = Column(UUID(as_uuid=False), ForeignKey("enquiries.id"), nullable=False)
    status = Column(Enum(QuoteStatus), default=QuoteStatus.draft, nullable=False)
    notes = Column(Text, nullable=True)  # e.g. payment terms, validity — freeform
    created_at = Column(DateTime, default=datetime.utcnow)
    approved_by_name = Column(String, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    # Kept for a future real User/auth system — unused for now, see above.
    approved_by_user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)

    enquiry = relationship("Enquiry", back_populates="quotes")
    line_items = relationship("QuoteLineItem", back_populates="quote", cascade="all, delete-orphan")


class QuoteLineItem(Base):
    __tablename__ = "quote_line_items"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    quote_id = Column(UUID(as_uuid=False), ForeignKey("quotes.id"), nullable=False)
    enquiry_item_id = Column(UUID(as_uuid=False), ForeignKey("enquiry_items.id"), nullable=True)
    # Snapshot of the item as it was at quote-generation time:
    description = Column(String, nullable=False)
    spec = Column(String, nullable=True)
    quantity = Column(Numeric, nullable=False)
    unit = Column(String, nullable=False)
    gst_percent = Column(Numeric, nullable=True)
    unit_price = Column(Numeric, nullable=True)  # null = still "Price Missing"

    quote = relationship("Quote", back_populates="line_items")
    enquiry_item = relationship("EnquiryItem")


class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    is_purchaser = Column(Boolean, default=False)
    is_approver = Column(Boolean, default=False)
    is_accounts = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ImportJob(Base):
    __tablename__ = "import_jobs"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    filename = Column(String, nullable=False)
    column_mapping = Column(Text)  # JSON string: {source_col: target_field}
    status = Column(String, default="pending")
    rows_imported = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class POStatus(str, enum.Enum):
    draft = "draft"
    sent = "sent"


class PurchaseOrder(Base):
    """
    An order placed with a supplier. Deliberately NOT dependent on an RFQ —
    a Purchaser can raise a PO straight to a known supplier even if no RFQ
    was ever sent for these items (e.g. a repeat order, or items sourced
    without going through the formal RFQ/quote flow). customer_quote_id is
    optional traceability only (which customer job this PO is fulfilling),
    never required to create one.

    Line items are snapshotted at creation time, same rationale as
    QuoteLineItem: editing a product later shouldn't silently change a PO
    that's already been sent to a supplier.
    """
    __tablename__ = "purchase_orders"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    po_number = Column(String, nullable=False)
    supplier_id = Column(UUID(as_uuid=False), ForeignKey("suppliers.id"), nullable=False)
    customer_quote_id = Column(UUID(as_uuid=False), ForeignKey("quotes.id"), nullable=True)
    status = Column(Enum(POStatus), default=POStatus.draft, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    sent_at = Column(DateTime, nullable=True)

    supplier = relationship("Supplier")
    customer_quote = relationship("Quote")
    line_items = relationship("PurchaseOrderLineItem", back_populates="purchase_order", cascade="all, delete-orphan")


class PurchaseOrderLineItem(Base):
    __tablename__ = "purchase_order_line_items"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    po_id = Column(UUID(as_uuid=False), ForeignKey("purchase_orders.id"), nullable=False)
    product_id = Column(UUID(as_uuid=False), ForeignKey("products.id"), nullable=True)  # nullable: manual/custom lines allowed
    description = Column(String, nullable=False)
    spec = Column(String, nullable=True)
    quantity = Column(Numeric, nullable=False)
    unit = Column(String, nullable=False)
    gst_percent = Column(Numeric, nullable=True)
    unit_price = Column(Numeric, nullable=True)  # cost price; null = still "Price Missing"

    purchase_order = relationship("PurchaseOrder", back_populates="line_items")
    product = relationship("Product")


class DCStatus(str, enum.Enum):
    draft = "draft"
    dispatched = "dispatched"


class DeliveryChallan(Base):
    """
    A goods-movement document accompanying a delivery to the customer —
    quantities only, no pricing (a traditional Delivery Challan is not a
    tax/billing document; that's what the future GST Invoice is for).

    Always tied to a Customer Quote, but deliberately NOT one-per-quote:
    a single approved/sent Quote can have several Delivery Challans against
    it over time for partial deliveries. How much of each line has already
    been delivered is computed from every prior challan's line items (see
    the delivery_challans router), not stored redundantly here.
    """
    __tablename__ = "delivery_challans"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    dc_number = Column(String, nullable=False)
    customer_quote_id = Column(UUID(as_uuid=False), ForeignKey("quotes.id"), nullable=False)
    status = Column(Enum(DCStatus), default=DCStatus.draft, nullable=False)
    vehicle_number = Column(String, nullable=True)
    driver_name = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    dispatched_at = Column(DateTime, nullable=True)

    customer_quote = relationship("Quote")
    line_items = relationship("DeliveryChallanLineItem", back_populates="delivery_challan", cascade="all, delete-orphan")


class DeliveryChallanLineItem(Base):
    __tablename__ = "delivery_challan_line_items"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    dc_id = Column(UUID(as_uuid=False), ForeignKey("delivery_challans.id"), nullable=False)
    quote_line_item_id = Column(UUID(as_uuid=False), ForeignKey("quote_line_items.id"), nullable=False)
    description = Column(String, nullable=False)
    spec = Column(String, nullable=True)
    unit = Column(String, nullable=False)
    quantity_delivered = Column(Numeric, nullable=False)

    delivery_challan = relationship("DeliveryChallan", back_populates="line_items")
    quote_line_item = relationship("QuoteLineItem")


class InvoiceStatus(str, enum.Enum):
    draft = "draft"
    issued = "issued"


class Invoice(Base):
    """
    A GST-aware billing document tied to a Customer Quote. Standard GST
    split only (a single GST % per line) — no CGST/SGST/IGST breakdown or
    e-way bill threshold logic in this version, per the current scope.

    Quantity per line is capped by what's actually been DISPATCHED via
    Delivery Challans, minus what's already been invoiced — not by the
    quoted quantity — so you can't invoice goods that haven't gone out
    yet. Like Delivery Challans, an Invoice is NOT one-per-quote: several
    invoices can be raised against one quote over time (e.g. billing each
    delivery separately) using the same remaining-quantity approach.
    """
    __tablename__ = "invoices"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    invoice_number = Column(String, nullable=False)
    customer_quote_id = Column(UUID(as_uuid=False), ForeignKey("quotes.id"), nullable=False)
    status = Column(Enum(InvoiceStatus), default=InvoiceStatus.draft, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    issued_at = Column(DateTime, nullable=True)

    customer_quote = relationship("Quote")
    line_items = relationship("InvoiceLineItem", back_populates="invoice", cascade="all, delete-orphan")


class InvoiceLineItem(Base):
    __tablename__ = "invoice_line_items"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    invoice_id = Column(UUID(as_uuid=False), ForeignKey("invoices.id"), nullable=False)
    quote_line_item_id = Column(UUID(as_uuid=False), ForeignKey("quote_line_items.id"), nullable=False)
    description = Column(String, nullable=False)
    spec = Column(String, nullable=True)
    unit = Column(String, nullable=False)
    quantity_invoiced = Column(Numeric, nullable=False)
    unit_price = Column(Numeric, nullable=True)  # null = still "Price Missing"
    gst_percent = Column(Numeric, nullable=True)

    invoice = relationship("Invoice", back_populates="line_items")
    quote_line_item = relationship("QuoteLineItem")


class GmailConnection(Base):
    """
    A connected Gmail inbox. Single-row-per-connection by design — this
    app connects to ONE inbox at a time (the client's own), not multiple
    accounts. access_token/refresh_token are stored as given by Google;
    there's no additional encryption layer here, consistent with the rest
    of this app's data (it already stores business-sensitive pricing data
    unencrypted at rest — this doesn't introduce a new risk category, but
    is worth knowing).
    """
    __tablename__ = "gmail_connections"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    email_address = Column(String, nullable=False)
    access_token = Column(Text, nullable=False)
    refresh_token = Column(Text, nullable=False)
    token_expiry = Column(DateTime, nullable=False)
    connected_at = Column(DateTime, default=datetime.utcnow)
    last_scanned_at = Column(DateTime, nullable=True)


class InboxMessageLog(Base):
    """
    One row per Gmail message a scan has ever looked at — keyed on Gmail's
    own message ID so a message is never processed twice across repeated
    scans. Records what category it was classified as and what (if
    anything) got created from it, so the Inbox screen has an activity
    trail to show instead of acting as a silent black box.
    """
    __tablename__ = "inbox_message_logs"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    gmail_message_id = Column(String, unique=True, nullable=False)
    subject = Column(String, nullable=True)
    from_address = Column(String, nullable=True)
    received_at = Column(DateTime, nullable=True)
    category = Column(String, nullable=False)  # matches CLASSIFICATION_CATEGORIES
    outcome = Column(String, nullable=False)  # e.g. "enquiry_created", "quote_matched", "unmatched_supplier", "logged_only"
    related_enquiry_id = Column(UUID(as_uuid=False), ForeignKey("enquiries.id"), nullable=True)
    related_supplier_id = Column(UUID(as_uuid=False), ForeignKey("suppliers.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    related_enquiry = relationship("Enquiry")
    related_supplier = relationship("Supplier")
