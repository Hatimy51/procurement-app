# Procurement Automation App — v1

See `procurement-app-v1-spec.md` for the full spec (data model, flow, roadmap).
This README is just "how do I run it on my machine."

## What's built so far

This package includes the integrated procurement workflow additions:

- Vendor Quote Comparison Engine — compare supplier totals, lowest single-vendor award, optimal split-award, and savings
- Purchase Order → GRN / Delivery Challan creation — warehouse receipt draft is pre-filled from the PO
- Executive Dashboard — live PO, invoice, supplier, open-PO-value, and 3-way-match KPIs
- React navigation entries for Executive Dashboard and Quote Comparison


- Full backend data model (all 13 tables from the spec)
- Product/Price API (list, search, create, edit, price history, latest-price lookup)
- Enquiry ingestion API (extraction → structured items → price lookup)
- The swappable extraction module (`app/extraction/`) — local free provider (Ollama)
  + a ready-to-activate paid provider (Claude API) behind one shared interface
- Product & Price List screen (React) — view, search, add/edit product, add price,
  view price history, "Price Missing" flag when no price exists yet

Also included from the current procurement workflow: supplier quote history,
customer quote generation/approval, purchase orders, delivery challans, invoices,
vendor quote comparison, and the executive dashboard. The PO → GRN/DC action
creates a warehouse receipt draft directly from a sent PO.

## Prerequisites (all free)

1. **Docker Desktop** — https://www.docker.com/products/docker-desktop/
2. **Node.js** (v18+) — https://nodejs.org
3. **Groq** (for fast, free-tier extraction — recommended) — https://console.groq.com
   No installer needed, just a free account (no credit card required):
   1. Sign up at console.groq.com
   2. Click "API Keys" in the sidebar → "Create API Key" → copy it immediately, it's only shown once
   3. Open `docker-compose.yml` and paste your key in place of
      `REPLACE_WITH_YOUR_FREE_GROQ_KEY`

   This is a hosted free tier (not a trial), typically returns a real
   enquiry extraction in a few seconds, and gives noticeably better
   extraction quality than the small local model, since it runs a much
   larger model on dedicated hardware. Worth knowing: unlike the local
   option below, your enquiry text is sent to Groq's servers to be read —
   still free, just a different privacy shape.

   **Alternative — fully offline (no data leaves your machine), but slow:**
   install Ollama from https://ollama.com, run `ollama pull llama3.2` once,
   then in `docker-compose.yml` change `EXTRACTION_PROVIDER` to `local`.
   Expect real enquiries to take anywhere from under a minute to several
   minutes depending on your hardware — this is a genuine speed-for-privacy
   trade-off, not a bug.

   **Diagnosing a stuck-looking or slow request (local mode only):** visit
   `http://localhost:8000/api/diagnostics/ollama` directly in your browser
   at any time — it tells you plainly whether the backend can reach Ollama
   at all, and how fast it's responding.

## Database upgrade note

The PO → GRN/DC feature adds PO linkage columns to the existing Delivery
Challan tables. The backend runs a small Postgres compatibility migration at
startup, so an existing v1 database can be upgraded in place.

## Running it

**1. Start the database + backend:**
```bash
docker-compose up --build
```
This starts Postgres and the FastAPI backend together. Backend will be at
http://localhost:8000 — check http://localhost:8000/api/health to confirm
it's up (should return `{"status": "ok"}`).

**2. Start the frontend (separate terminal):**
```bash
cd frontend
npm install
npm run dev
```
Frontend will be at http://localhost:5173 — this is the actual app screen.

## Switching the extraction engine later (free → paid)

When you're ready to move off the free local model:
```bash
pip install anthropic
export ANTHROPIC_API_KEY=your-key
export EXTRACTION_PROVIDER=claude
```
(Or set these as environment variables in `docker-compose.yml`'s `backend`
service instead, so it persists.) No code changes needed anywhere else —
this is the whole point of the extraction module being isolated behind one
interface (see `app/extraction/base.py`).

## Project layout

```
backend/
  app/
    main.py           — FastAPI app, wires routers together
    database.py        — DB connection (swap DATABASE_URL to move hosting)
    models.py          — SQLAlchemy tables, mirrors spec Section 4
    schemas.py          — API request/response shapes
    extraction/
      base.py           — the interface every provider implements + schemas
      local_provider.py — free, Ollama-based (v1 default)
      claude_provider.py — paid, ready to activate later
    routers/
      products.py       — Product/Price List screen's backend
      prices.py
      enquiries.py       — ingestion + extraction + price lookup

frontend/
  src/
    App.jsx            — Product/Price List screen
    api.js              — API client wrapper

docker-compose.yml       — Postgres + backend, one command to start both
```

## Possible next build steps

The remaining roadmap is deeper inbox automation, automated supplier-quote
ingestion, store QC, and datasheet/specification matching.
