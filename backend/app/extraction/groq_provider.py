"""
Free, fast extraction provider using Groq's API — a genuinely free ongoing
tier (not a trial), no credit card required. Runs on Groq's dedicated
inference hardware, so a real enquiry extraction typically takes a few
seconds instead of the multiple minutes seen with the local Ollama model
on ordinary laptop CPUs. Quality also sits meaningfully above the small
local model, since Groq's free tier gives access to much larger models
(e.g. Llama 3.3 70B) than most laptops could run locally at usable speed.

To activate:
    1. Sign up at https://console.groq.com (no credit card needed)
    2. Create an API key
    3. export GROQ_API_KEY=your-key
    4. export EXTRACTION_PROVIDER=groq
No other code, anywhere in the app, needs to change — same swappable-provider
architecture as the local and Claude providers.

Worth knowing: this is a hosted third-party service, not fully "on your
machine" like Ollama — the enquiry text is sent to Groq's servers to be
read. Still free, but a different privacy shape than the fully local option.
"""
import json
import os
import urllib.request
import urllib.error

from app.extraction.base import ExtractionProvider, ExtractionResult

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")


class GroqProvider(ExtractionProvider):
    def __init__(self):
        self.api_key = os.getenv("GROQ_API_KEY")
        if not self.api_key:
            raise RuntimeError(
                "GROQ_API_KEY not set. Get a free key at https://console.groq.com "
                "and set it as an environment variable."
            )

    def _call_groq(self, prompt: str) -> str:
        payload = json.dumps({
            "model": GROQ_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"},
        }).encode("utf-8")
        req = urllib.request.Request(
            GROQ_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
                # Groq's API sits behind Cloudflare, which blocks requests
                # carrying Python's default bot-like identification string
                # (error code 1010). A normal-looking one avoids that.
                "User-Agent": "Mozilla/5.0 (compatible; ProcurementApp/1.0)",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read())
                return body["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Groq API error {e.code}: {error_body}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"Could not reach Groq API: {e}")

    def extract(self, document_text: str, schema: dict) -> ExtractionResult:
        prompt = (
            "You extract structured data from procurement documents. "
            "Read the document below and return ONLY a JSON object matching "
            f"this schema (use null for anything not mentioned):\n\n"
            f"SCHEMA:\n{json.dumps(schema, indent=2)}\n\n"
            f"DOCUMENT:\n{document_text}\n\n"
            "Return only valid JSON, nothing else."
        )
        raw = self._call_groq(prompt)
        try:
            data = json.loads(raw)
            confidence = 0.85  # a large hosted model — meaningfully more reliable than the small local one
        except json.JSONDecodeError:
            data, confidence = {}, 0.2
        return ExtractionResult(data=data, confidence=confidence, raw_model_output=raw)

    def classify(self, document_text: str, categories: list[str]) -> tuple[str, float]:
        prompt = (
            f"Classify this document into exactly one of: {', '.join(categories)}.\n\n"
            f"DOCUMENT:\n{document_text}\n\n"
            'Return only JSON: {"category": "...", "confidence": 0.0-1.0}'
        )
        raw = self._call_groq(prompt)
        try:
            result = json.loads(raw)
            return result.get("category", "general"), float(result.get("confidence", 0.5))
        except (json.JSONDecodeError, ValueError):
            return "general", 0.2
