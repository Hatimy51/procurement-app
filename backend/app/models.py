"""
Data model — mirrors Section 4 of the v1 spec document exactly.

Every table here maps to an entity in the spec's data model table, so if you're
cross-checking against the doc, the names match on purpose.
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Text, ForeignKey, DateTime, Numeric, Enum, Boolean
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
    created_at = Column(DateTime, default=datetime.utcnow)

    price_entries = relationship("PriceEntry", back_populates="product", order_by="desc(PriceEntry.date)")


class Supplier(Base):
    __tablename__ = "suppliers"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)
    contact_info = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class RFQ(Base):
    __tablename__ = "rfqs"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    product_id = Column(UUID(as_uuid=False), ForeignKey("products.id"), nullable=False)
    supplier_id = Column(UUID(as_uuid=False), ForeignKey("suppliers.id"), nullable=False)
    enquiry_item_id = Column(UUID(as_uuid=False), ForeignKey("enquiry_items.id"), nullable=True)
    status = Column(Enum(RFQStatus), default=RFQStatus.pending, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    product = relationship("Product")
    supplier = relationship("Supplier")


class SupplierQuote(Base):
    __tablename__ = "supplier_quotes"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    rfq_id = Column(UUID(as_uuid=False), ForeignKey("rfqs.id"), nullable=True)
    raw_source = Column(Text)
    extracted_price = Column(Numeric, nullable=True)
    extraction_confidence = Column(Numeric, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    rfq = relationship("RFQ")


class PriceEntry(Base):
    __tablename__ = "price_entries"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    product_id = Column(UUID(as_uuid=False), ForeignKey("products.id"), nullable=False)
    cost_price = Column(Numeric, nullable=True)
    selling_price = Column(Numeric, nullable=True)
    date = Column(DateTime, default=datetime.utcnow)
    source = Column(Enum(PriceSource), default=PriceSource.manual, nullable=False)

    product = relationship("Product", back_populates="price_entries")


class Quote(Base):
    __tablename__ = "quotes"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    enquiry_id = Column(UUID(as_uuid=False), ForeignKey("enquiries.id"), nullable=False)
    status = Column(Enum(QuoteStatus), default=QuoteStatus.draft, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    approved_by_user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)

    enquiry = relationship("Enquiry", back_populates="quotes")
    line_items = relationship("QuoteLineItem", back_populates="quote", cascade="all, delete-orphan")


class QuoteLineItem(Base):
    __tablename__ = "quote_line_items"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    quote_id = Column(UUID(as_uuid=False), ForeignKey("quotes.id"), nullable=False)
    enquiry_item_id = Column(UUID(as_uuid=False), ForeignKey("enquiry_items.id"), nullable=False)
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
