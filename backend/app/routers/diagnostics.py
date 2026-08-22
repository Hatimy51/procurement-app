"""
Self-check endpoints — verify whether the currently configured AI extraction
provider is actually working, without needing to submit a real enquiry and
guess whether something is stuck, misconfigured, or just slow.
"""
import os
import time
from fastapi import APIRouter

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])


@router.get("/extraction")
def check_extraction():
    """
    Checks whichever provider EXTRACTION_PROVIDER is actually set to right
    now (local / groq / claude) — unlike the old Ollama-only check below,
    this won't give a misleading answer if you've switched providers.
    """
    provider_name = os.getenv("EXTRACTION_PROVIDER", "local")
    from app.extraction.base import get_extraction_service, ENQUIRY_SCHEMA

    start = time.time()
    try:
        service = get_extraction_service()
        result = service.extract(
            "Please quote 5 units of Test Item, 10mm.", ENQUIRY_SCHEMA
        )
        elapsed = round(time.time() - start, 1)
        return {
            "provider": provider_name,
            "reachable": True,
            "seconds_taken": elapsed,
            "extracted_sample": result.data,
            "note": "This is a real test extraction call, not just a connectivity ping.",
        }
    except Exception as e:
        elapsed = round(time.time() - start, 1)
        return {
            "provider": provider_name,
            "reachable": False,
            "seconds_waited": elapsed,
            "error": str(e),
        }


@router.get("/ollama")
def check_ollama():
    """Legacy check specifically for the local Ollama provider — use
    /api/diagnostics/extraction instead if you're not sure which provider
    is currently active."""
    from app.extraction.local_provider import OLLAMA_URL, OLLAMA_MODEL
    import json
    import urllib.request
    import urllib.error

    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "prompt": "Reply with exactly the word: ok",
        "stream": False,
    }).encode("utf-8")
    req = urllib.request.Request(
        OLLAMA_URL, data=payload, headers={"Content-Type": "application/json"}
    )

    start = time.time()
    try:
        # short timeout on purpose — this is a connectivity/speed probe,
        # not a real extraction call
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = json.loads(resp.read())
            elapsed = round(time.time() - start, 1)
            return {
                "reachable": True,
                "seconds_for_short_prompt": elapsed,
                "model": OLLAMA_MODEL,
                "response_preview": body.get("response", "")[:100],
                "note": (
                    "Real enquiry extraction takes noticeably longer than this "
                    "short test — this only measures a tiny one-word reply."
                ),
            }
    except urllib.error.URLError as e:
        elapsed = round(time.time() - start, 1)
        return {
            "reachable": False,
            "seconds_waited": elapsed,
            "model": OLLAMA_MODEL,
            "url_tried": OLLAMA_URL,
            "error": str(e),
            "note": (
                "Could not reach Ollama at all from inside the backend "
                "container. Check that Ollama is running on your machine "
                "(not just installed) and that Docker Desktop is set up to "
                "allow host.docker.internal."
            ),
        }
