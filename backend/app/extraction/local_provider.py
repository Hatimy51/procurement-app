"""
Zero-cost extraction provider — talks to a locally running Ollama server.

Setup on your machine (not needed in this sandbox, needed wherever you
actually run the app):
    1. Install Ollama: https://ollama.com
    2. Run: ollama pull llama3.1        (or qwen2.5, another instruction-following model)
    3. Ollama serves an API at http://localhost:11434 automatically.

This is the "free, weaker" side of the trade-off described in the spec doc
(Section 9's known v1 trade-off) — accuracy on messy real-world documents
will be rougher than the paid providers, by design of the zero-cost constraint.
"""
import json
import os
import urllib.request
import urllib.error

from app.extraction.base import ExtractionProvider, ExtractionResult

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1")


class LocalOllamaProvider(ExtractionProvider):
    def _call_ollama(self, prompt: str) -> str:
        payload = json.dumps({
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "format": "json",
        }).encode("utf-8")
        req = urllib.request.Request(
            OLLAMA_URL, data=payload, headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = json.loads(resp.read())
                return body.get("response", "{}")
        except urllib.error.URLError as e:
            raise RuntimeError(
                f"Could not reach Ollama at {OLLAMA_URL}. "
                f"Is Ollama running on this machine? ({e})"
            )

    def extract(self, document_text: str, schema: dict) -> ExtractionResult:
        prompt = (
            "You extract structured data from procurement documents. "
            "Read the document below and return ONLY a JSON object matching "
            f"this schema (use null for anything not mentioned):\n\n"
            f"SCHEMA:\n{json.dumps(schema, indent=2)}\n\n"
            f"DOCUMENT:\n{document_text}\n\n"
            "Return only valid JSON, nothing else."
        )
        raw = self._call_ollama(prompt)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            # Local models occasionally wrap output in extra text despite instructions.
            # Fall back to an empty structure and low confidence so it routes to human review.
            data = {}

        # Local models don't give a real confidence score — we approximate:
        # if we got a non-empty, schema-shaped result, treat as medium confidence.
        # This is intentionally conservative; it should be tuned once real usage
        # data exists, and is one of the first things to improve when swapping
        # to a paid provider that can self-report confidence more reliably.
        confidence = 0.6 if data else 0.1

        return ExtractionResult(data=data, confidence=confidence, raw_model_output=raw)

    def classify(self, document_text: str, categories: list[str]) -> tuple[str, float]:
        prompt = (
            "Classify this procurement-related document into exactly one of "
            f"these categories: {', '.join(categories)}.\n\n"
            f"DOCUMENT:\n{document_text}\n\n"
            'Return only valid JSON: {"category": "...", "confidence": 0.0-1.0}'
        )
        raw = self._call_ollama(prompt)
        try:
            result = json.loads(raw)
            return result.get("category", "general"), float(result.get("confidence", 0.3))
        except (json.JSONDecodeError, ValueError):
            return "general", 0.1
