"""
The swappable intelligence layer — see Section 3 of the spec doc.

Every part of the app that needs to "read a document and pull structured data"
goes through this interface, never directly through a specific model's API.
That means:

  - v1 runs on ExtractionProvider = LocalOllamaProvider (free, zero-cost)
  - Later, switching to ClaudeProvider or OpenAIProvider is a ONE-LINE config
    change (see get_extraction_service() at the bottom) — nothing in the
    routers, models, or business logic needs to change.

This same interface is reused for every document type the app reads:
customer enquiries, supplier quotes, and (Phase 4) datasheets/certificates.
Only the `schema` passed in changes — the contract stays identical.
"""
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ExtractionResult:
    data: dict[str, Any]           # structured fields per the requested schema
    confidence: float              # 0.0-1.0 — drives auto-accept vs human-review routing
    raw_model_output: str = field(default="", repr=False)  # for debugging/audit


class ExtractionProvider(ABC):
    """Abstract contract every extraction backend must implement."""

    @abstractmethod
    def extract(self, document_text: str, schema: dict[str, Any]) -> ExtractionResult:
        """
        document_text: raw text of the email/document (OCR'd already, if it was an image/PDF)
        schema: dict describing the fields to extract, e.g. ENQUIRY_SCHEMA below.
        Returns an ExtractionResult with structured data + a confidence score.
        """
        raise NotImplementedError

    @abstractmethod
    def classify(self, document_text: str, categories: list[str]) -> tuple[str, float]:
        """
        Classifies a document into one of `categories`
        (e.g. ["new_enquiry", "supplier_quote", "follow_up", "purchase_order",
        "invoice", "delivery_update", "general"] — per the taxonomy studied
        from Zapier's approach).
        Returns (category, confidence).
        """
        raise NotImplementedError


# --- Extraction schemas: what fields to pull, per document type -------------
# These are the "targets" the same ExtractionProvider is aimed at for
# different jobs. Adding a new document type (e.g. datasheets in Phase 4)
# means adding a new schema here, not a new extraction engine.

ENQUIRY_SCHEMA = {
    "site_name": "string — the project/site name this enquiry is for, if mentioned",
    "items": [
        {
            "description": "string — product/material description",
            "spec": "string — size, type, color, rating etc. if mentioned",
            "brand": "string or null — brand/make if mentioned",
            "quantity": "number",
            "unit": "string — e.g. Mtrs, Nos, Ltrs, Kg",
        }
    ],
    "notes": "string or null — any extra terms mentioned, e.g. payment terms",
}

SUPPLIER_QUOTE_SCHEMA = {
    "items": [
        {
            "description": "string — product/material description",
            "price": "number",
            "unit": "string",
        }
    ],
    "validity": "string or null — quote validity period if mentioned",
}

CLASSIFICATION_CATEGORIES = [
    "new_enquiry",
    "supplier_quote",
    "quotation_follow_up",
    "purchase_order",
    "delivery_update",
    "invoice",
    "general",
]


def get_extraction_service() -> ExtractionProvider:
    """
    Factory — this is the ONE line that changes when you swap providers later.

    EXTRACTION_PROVIDER=local  (default, free, fully on-device, slow on ordinary laptop CPUs)
    EXTRACTION_PROVIDER=groq   (free tier, hosted, fast — recommended for comfortable v1 testing)
    EXTRACTION_PROVIDER=claude (paid, swap in after v1 is validated)
    """
    provider = os.getenv("EXTRACTION_PROVIDER", "local")
    if provider == "local":
        from app.extraction.local_provider import LocalOllamaProvider
        return LocalOllamaProvider()
    elif provider == "groq":
        from app.extraction.groq_provider import GroqProvider
        return GroqProvider()
    elif provider == "claude":
        from app.extraction.claude_provider import ClaudeProvider
        return ClaudeProvider()
    else:
        raise ValueError(f"Unknown EXTRACTION_PROVIDER: {provider}")
