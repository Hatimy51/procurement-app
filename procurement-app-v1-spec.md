# Procurement Automation App — v1 Specification

**Status:** Draft for review
**Scope:** Sales-side quotation loop only. PO/Delivery Challan/Invoice, Store QC, and Datasheet Matching are out of scope for v1 (see Roadmap).

---

## 1. Mission

Eliminate manual admin work in a company's purchase department, starting with the highest-friction step: turning an incoming customer enquiry (email, any format) into an accurate, priced quotation — without a human manually reading, re-typing, and price-hunting for every line item.

This is built **bespoke per client** — the data model is generic, but each deployment is configured/tweaked to that client's actual workflow, product categories, and rules.

---

## 2. Core Insight From Real Enquiry Samples

Two real enquiries from the same customer (Paradigm Realty) showed:

- No fixed format — subject lines, structure, and item formatting differ even from the same sender.
- Typos and inconsistent phrasing are normal ("Aggrecate Mateial," "Polyproplyne").
- Enquiries are tied to a **Site/Project**, and the same site generates multiple enquiries over time.
- Line items loosely follow: *description + spec (size/type/color/brand) + quantity + unit*.
- Extra terms sometimes appear embedded in free text (e.g. "Payment Terms 60 Days").

**Conclusion:** rule-based/template parsing (like Zapier's native email parser) will not survive contact with real-world enquiries. Every client, and often every sender within a client, will format differently. The system must use **LLM-based extraction against a defined schema**, not fixed templates.

---

## 3. Architecture Principle: The Swappable Intelligence Layer

The single most important architectural decision in this system: **the extraction/matching engine is an isolated, swappable module — not something scattered through the app's core logic.**

```
┌─────────────────────────────────────────┐
│         REST OF THE APPLICATION          │
│  (data model, screens, workflow, rules)  │
└───────────────────┬───────────────────────┘
                     │ calls
                     ▼
        ┌─────────────────────────┐
        │   ExtractionService     │  ← one interface
        │  (interface / contract) │
        └─────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
 LocalModelProvider         ClaudeAPIProvider
 (Ollama / Llama / Qwen —   (swap in later once
  free, v1 default)          v1 is validated)
```

**Why this matters:**
- v1 runs on a free local model (Ollama) to meet the zero-cost constraint.
- Switching to Claude API or GPT API later is a **config change**, not a rebuild — same interface, same input/output schema, different provider underneath.
- The same `ExtractionService` is reused for **every document type** the app reads: customer enquiries, supplier quotes, and (in Phase 4) datasheets/test certificates. One engine, multiple target schemas — not separate parsers built per document type.
- This also isolates the weakest part of the free-model v1 (extraction accuracy) so upgrading it later touches one module, not the whole codebase.

**Interface contract (conceptual):**
```
ExtractionService.extract(document, schema) → structured_data + confidence
```
Where `schema` defines what fields to pull (varies: enquiry schema vs. quote schema vs. datasheet schema), and `confidence` drives whether the result is auto-accepted or flagged for human review.

---

## 4. Data Model (v1)

| Entity | Key Fields | Notes |
|---|---|---|
| **Customer** | name, contact info | Who sends enquiries |
| **Site / Project** | name, belongs to Customer | Enquiries are grouped by site, matching real-world usage |
| **Enquiry** | raw source (email/screenshot), site, status, extracted-at | Status: new → reviewed → quoted → approved → sent |
| **Enquiry Item** | description, spec, qty, unit, brand (optional), belongs to Enquiry | Extracted line items, human-reviewable/editable |
| **Product** | internal master item, category, spec | Grows over time as items get matched/confirmed |
| **Supplier** | name, contact info | Distinct from Customer |
| **RFQ (Request for Quote)** | product/item, supplier, status | Tracks "asked supplier X for price on Y, awaiting reply" |
| **Supplier Quote** | raw source, extracted price(s), linked RFQ | Ingested the same way as customer enquiries, via the same extraction engine |
| **Price Entry** | product, cost price, selling price, date, source (manual/supplier-quote) | The self-building price master — this *is* the "master sheet," built from real usage instead of pre-populated |
| **Quote** | enquiry, line items with prices, status | draft → approved → sent |
| **User** | name, role flags | Roles: Purchaser, Approver, Accounts. Approver is a flag, not a hardcoded separate role — client can assign it to anyone, including the Purchaser |
| **Import Job** | source file, column mapping, status | For bulk-loading existing ERP/Excel product & price data on onboarding |

---

## 5. v1 Flow

1. **Enquiry comes in** — the app connects directly to the client's email inbox (Outlook/Gmail) and auto-scans for incoming enquiries and supplier quotes, using the `ExtractionService` classification step to distinguish enquiry vs. quote vs. irrelevant mail (per the classification taxonomy studied earlier: New Enquiry / Quotation / Follow-up / PO / Delivery / Invoice / General). Manual upload/forward remains available as a fallback (e.g. for a screenshot shared outside email).
2. **Extraction** — `ExtractionService` reads it against the Enquiry schema → produces structured Site + Enquiry Items.
3. **Human review** — Purchaser checks/corrects the extracted items before anything downstream happens. Critical while trust in the free local model is still being established.
4. **Price lookup** — for each item, the app checks Price Entry history:
   - Found → suggest last known price (editable)
   - Not found → flagged **"Price Missing"** (not forced to manual entry)
5. **Missing price resolved one of two ways:**
   - Purchaser enters price manually, **or**
   - Purchaser sends an RFQ to their supplier (outside the app in v1) → supplier's reply email arrives in the inbox and is **auto-scanned and ingested** through the **same extraction engine**, against the Supplier Quote schema → auto-creates a new Price Entry → matched back to the pending item.
6. **Quote assembly** — once all items are priced, a draft Quote is generated.
7. **Approval** — Approver (any user with that flag) reviews and approves.
8. **Send** — quote sent to customer. Manual send in v1 (copy/send), not automated email dispatch — keeps the money-facing step under direct human control per our safety principle (AI/automation never independently commits pricing or sends binding documents).

---

## 6. Product/Price List Screen (v1)

A basic screen to:
- View all Products and their current Price Entries
- Search/filter by name, category, spec
- Manually add or edit a product/price
- See price history per product (useful once supplier-quote-driven updates start accumulating)

---

## 7. Import From Existing Systems

Since some clients already run an ERP/Excel-based product & price system (unlike the current test client, who has none), v1 includes a basic **Import Job**:
- Upload a CSV/Excel export
- Map their columns to our Product/Price schema
- Bulk-populate Product and Price Entry tables

Direct API integrations with specific ERPs are treated as later, per-client work — not a v1 requirement.

---

## 8. Explicit v1 Boundaries — What's Deliberately Excluded

| Excluded | Reason | Planned for |
|---|---|---|
| Store guy / receiving QC screen | Not needed to prove the core quoting loop | v2 |
| PO / Delivery Challan / Invoice generation | Downstream of the quote-approval loop; separate build | Phase 2 |
| Datasheet / test certificate spec-matching | Needs a real sample document to design against; reuses the same extraction engine once built | Phase 4 |
| WhatsApp ingestion | Client has agreed to consolidate to email only | Not currently planned |
| Automated email sending of quotes | Kept manual deliberately — money-facing step stays human-controlled in v1 | Reconsider after v1 is trusted |
| Multi-tier / customer-specific pricing rules | Adds real complexity not needed to prove v1 | v2+ |

---

## 9. Tech Stack (zero-cost v1)

| Layer | Choice | Cost |
|---|---|---|
| Backend | Python (FastAPI) | Free, open-source |
| Database | PostgreSQL, via ORM (SQLAlchemy) | Free, open-source, portable — swapping hosting later doesn't touch app code |
| Frontend | React | Free |
| Deployment | Docker container | Runs on any host later; local machine for v1 testing |
| Intelligence layer | Ollama (local open-source model, e.g. Llama/Qwen) behind the `ExtractionService` interface | Free — swappable to Claude/GPT API later with no architecture change |

**Known v1 trade-off:** local open-source models are meaningfully weaker than Claude/GPT at structured extraction and precise spec comparison. Expect rougher accuracy during free-model testing — this is expected and does not reflect the ceiling of the final product once the intelligence layer is upgraded.

---

## 10. Roadmap Beyond v1

- **Phase 2:** PO generation, Delivery Challan, GST-aware Invoice (Accounts role)
- **Phase 3 (v2):** Store guy receiving/QC approval screen
- **Phase 4:** Datasheet/test certificate matching against enquiry specs (pending a real sample document)

---

## 11. Open Items / To Confirm With Client Before Build

- Exact GST rate handling / e-way bill trigger thresholds for this client
- Whether "Approver" should default to the Purchaser or be a distinct person from day one
- Real supplier-quote email sample(s), to validate the Supplier Quote schema the same way the enquiry samples validated the Enquiry schema
