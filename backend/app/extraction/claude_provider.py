"""
Paid extraction provider — activate this once v1 is validated and you're
ready to move off the free local model (per the plan: test free, upgrade
the intelligence layer, keep everything else unchanged).

To activate:
    1. pip install anthropic
    2. export ANTHROPIC_API_KEY=your-key
    3. export EXTRACTION_PROVIDER=claude
No other code, anywhere in the app, needs to change — this is the whole
point of the swappable-provider architecture in Section 3 of the spec doc.
"""
import json
import os

from app.extraction.base import ExtractionProvider, ExtractionResult


class ClaudeProvider(ExtractionProvider):
    def __init__(self):
        try:
            import anthropic
        except ImportError:
            raise RuntimeError(
                "anthropic package not installed. Run: pip install anthropic"
            )
        self.client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        self.model = "claude-sonnet-4-6"

    def extract(self, document_text: str, schema: dict) -> ExtractionResult:
        prompt = (
            "Extract structured data from this procurement document. "
            f"Return ONLY JSON matching this schema:\n{json.dumps(schema, indent=2)}\n\n"
            f"DOCUMENT:\n{document_text}"
        )
        msg = self.client.messages.create(
            model=self.model,
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text
        try:
            data = json.loads(raw)
            confidence = 0.9  # paid models are materially more reliable on this task
        except json.JSONDecodeError:
            data, confidence = {}, 0.2
        return ExtractionResult(data=data, confidence=confidence, raw_model_output=raw)

    def classify(self, document_text: str, categories: list[str]) -> tuple[str, float]:
        prompt = (
            f"Classify into exactly one of: {', '.join(categories)}.\n\n"
            f"DOCUMENT:\n{document_text}\n\n"
            'Return only JSON: {"category": "...", "confidence": 0.0-1.0}'
        )
        msg = self.client.messages.create(
            model=self.model,
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text
        try:
            result = json.loads(raw)
            return result.get("category", "general"), float(result.get("confidence", 0.5))
        except (json.JSONDecodeError, ValueError):
            return "general", 0.2
