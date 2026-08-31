"""
Product matching for enquiry items — two distinct, separate mechanisms:

1. is_exact_match() — used ONLY at ingestion time. True 100% agreement on
   every field both sides have (name, spec, unit) auto-links immediately,
   no confirmation needed. This is intentionally strict and weight-blind:
   exact is exact, there's nothing to weigh.

2. suggest_product_match() — used ONLY at review time, for items that
   ingestion did NOT auto-link. Scores name/spec/unit separately, then
   combines them with configurable weights (default: name matters most,
   then spec, then unit) into a single ranked suggestion. NEVER applied
   automatically — always a one-click confirmation in the review screen.
   Thresholds are a heuristic starting point, not tuned science; worth
   revisiting once there's real usage data.
"""
from dataclasses import dataclass

from rapidfuzz import fuzz
from sqlalchemy.orm import Session

from app import models

MIN_SUGGESTION_SCORE = 85
MIN_GAP_OVER_RUNNER_UP = 4
NEAR_EXACT_SCORE = 98  # a near-100 weighted score doesn't need the gap check

# Priority presets — dropdown options. Each is (name_weight, spec_weight,
# unit_weight), always summing to 1.0. Default reflects "name matters most,
# then spec, then unit" per your instruction; the others are provided for
# categories where that ordering doesn't fit as well.
WEIGHT_PRESETS = {
    "name_spec_unit": (0.55, 0.30, 0.15),  # default
    "spec_name_unit": (0.30, 0.55, 0.15),
    "name_unit_spec": (0.55, 0.15, 0.30),
    "spec_unit_name": (0.15, 0.55, 0.30),
    "unit_spec_name": (0.15, 0.30, 0.55),
}
DEFAULT_PRESET = "name_spec_unit"


def _norm(s: str | None) -> str:
    return (s or "").strip().lower()


def is_exact_match(description: str, spec: str | None, unit: str | None, product: models.Product) -> bool:
    """True 100% agreement on every field both sides actually have.
    A field that's blank on one side but filled on the other does NOT
    count as exact — that's a real gap, not a match, and should go
    through the confirm-first suggestion path instead."""
    if _norm(description) != _norm(product.name):
        return False
    if _norm(spec) != _norm(product.spec):
        return False
    if _norm(unit) != _norm(product.unit):
        return False
    return True


def _field_score(query, target) -> float:
    """
    Fuzzy score for one field. Both blank -> fully neutral (100, no
    conflicting info). One blank, one filled -> a real gap, scored low-ish
    (40) rather than ignored — missing data shouldn't be free confidence.
    """
    q, t = _norm(query), _norm(target)
    if not q and not t:
        return 100.0
    if not q or not t:
        return 40.0
    return fuzz.WRatio(q, t)


@dataclass
class MatchSuggestion:
    product_id: str
    product_name: str
    score: float


def suggest_product_match(db: Session, description: str, spec, unit, weight_preset: str = DEFAULT_PRESET):
    """Returns a single confident suggestion, or None if nothing is
    confident/unambiguous enough. Never mutates anything — the caller
    decides whether/when to actually apply it."""
    products = db.query(models.Product).all()
    if not products:
        return None

    name_w, spec_w, unit_w = WEIGHT_PRESETS.get(weight_preset, WEIGHT_PRESETS[DEFAULT_PRESET])

    scored = []
    for p in products:
        name_score = _field_score(description, p.name)
        spec_score = _field_score(spec, p.spec)
        unit_score = _field_score(unit, p.unit)
        weighted = name_w * name_score + spec_w * spec_score + unit_w * unit_score
        scored.append((weighted, p))

    scored.sort(key=lambda x: x[0], reverse=True)
    top_score, top_product = scored[0]

    if top_score < MIN_SUGGESTION_SCORE:
        return None

    if top_score < NEAR_EXACT_SCORE and len(scored) > 1:
        second_score = scored[1][0]
        if (top_score - second_score) < MIN_GAP_OVER_RUNNER_UP:
            return None  # too ambiguous relative to the runner-up — stay silent

    return MatchSuggestion(product_id=top_product.id, product_name=top_product.name, score=round(top_score, 1))


# --- Matching a multi-item supplier reply against a small, known candidate set ---
#
# This is a different (and safer) situation than suggest_product_match above:
# when a supplier replies to an RFQ batch, we already know EXACTLY which
# products we asked them about (the pending RFQs for that supplier) — so
# instead of matching against the entire product catalog, matching only
# needs to happen within that small, known candidate set. That narrower
# pool means a much more lenient score threshold is still safe, since the
# false-positive risk (matching to some unrelated product) is essentially
# eliminated by construction.

CANDIDATE_MATCH_MIN_SCORE = 75


@dataclass
class ExtractedItem:
    index: int  # position in the original extracted list, for reporting
    description: str
    price: float
    unit: str | None


def match_items_to_candidates(extracted_items: list[dict], candidate_products: list[models.Product]):
    """
    Greedy one-to-one matching: scores every (product, extracted item) pair
    by name similarity, then assigns the best-scoring pairs first, skipping
    anything below the threshold or where either side is already spoken
    for. Returns (matches, unmatched_product_ids, unmatched_item_indices).

    matches: list of (product, extracted_item_dict, score)
    """
    pairs = []
    for p in candidate_products:
        for i, item in enumerate(extracted_items):
            desc = item.get("description") or ""
            if item.get("cost_price") is None or not desc.strip():
                continue
            score = fuzz.WRatio(_norm(desc), _norm(p.name))
            pairs.append((score, p, i, item))

    pairs.sort(key=lambda x: x[0], reverse=True)

    matched_product_ids = set()
    matched_item_indices = set()
    matches = []
    for score, product, item_index, item in pairs:
        if score < CANDIDATE_MATCH_MIN_SCORE:
            break  # sorted descending — nothing after this is better
        if product.id in matched_product_ids or item_index in matched_item_indices:
            continue
        matches.append((product, item, round(score, 1)))
        matched_product_ids.add(product.id)
        matched_item_indices.add(item_index)

    unmatched_products = [p for p in candidate_products if p.id not in matched_product_ids]
    unmatched_item_indices = [
        i for i in range(len(extracted_items)) if i not in matched_item_indices
    ]
    return matches, unmatched_products, unmatched_item_indices
