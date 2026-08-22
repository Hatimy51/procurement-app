"""
A self-check endpoint — lets you (or me, remotely) verify whether the free
local AI model is actually reachable and how long it takes to respond,
without needing to submit a real enquiry and guess whether it's stuck or
just slow.
"""
import time
from fastapi import APIRouter

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])


@router.get("/ollama")
def check_ollama():
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
