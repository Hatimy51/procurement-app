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
