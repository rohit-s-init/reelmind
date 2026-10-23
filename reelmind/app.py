"""ReelMind API: serves the web demo, the trained metrics, and GenAI explanations.

Run:  uvicorn app:app --port 8000     then open http://localhost:8000

The "Why this?" endpoint is the GenAI layer from slides 5-7. The browser sends the
evidence the recommender collected; Claude turns it into one friendly sentence and
is told to use only those facts (a "grounded" explanation). If no API key is set,
the demo falls back to its template sentence.
"""
from __future__ import annotations

import json
from pathlib import Path

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

HERE = Path(__file__).parent
MODEL = "claude-opus-5-5"

# Kept identical to EXPLAIN_SYSTEM_PROMPT in engine.js, so the prompt shown in the demo is the real one.
SYSTEM_PROMPT = (
    "You write the short 'Why this?' note shown under a movie recommendation. "
    "Use ONLY the facts provided. Do not invent plot details, actors, awards or numbers. "
    "Write one friendly sentence of at most 30 words, speaking to the viewer as 'you'."
)


class Facts(BaseModel):
    title: str = Field(max_length=100)
    year: int | None = None
    genres: list[str] = Field(default_factory=list, max_length=5)
    main_reason: str = Field(default="", max_length=30)
    evidence: list[str] = Field(default_factory=list, max_length=5)


class ExplainRequest(BaseModel):
    facts: Facts


def build_prompt(facts: Facts) -> str:
    clean = {
        "recommended_title": facts.title,
        "year": facts.year,
        "genres": facts.genres,
        "main_reason": facts.main_reason,
        "evidence": [e[:200] for e in facts.evidence],
    }
    return (
        "Facts about this recommendation (from the recommender's own data):\n"
        f"{json.dumps(clean, indent=2)}\n\nWrite the 'Why this?' sentence."
    )


app = FastAPI(title="ReelMind")
_client: anthropic.Anthropic | None = None


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY (or an `ant auth login` profile)
    return _client


@app.post("/api/explain")
def explain(request: ExplainRequest) -> dict:
    try:
        response = client().beta.messages.create(
            model=MODEL,
            max_tokens=4000,
            output_config={"effort": "low"},  # a one-sentence note doesn't need deep reasoning
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",  # if the model declines, the API retries on a fallback model
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": build_prompt(request.facts)}],
        )
    except anthropic.AuthenticationError:
        raise HTTPException(503, "No valid Anthropic API key - set ANTHROPIC_API_KEY")
    except anthropic.RateLimitError:
        raise HTTPException(429, "Rate limited - try again in a moment")
    except (anthropic.APIStatusError, anthropic.APIConnectionError) as err:
        raise HTTPException(503, f"LLM unavailable: {err}")
    except Exception as err:  # e.g. no credentials configured at all
        raise HTTPException(503, f"LLM not configured: {err}")

    if response.stop_reason == "refusal":
        raise HTTPException(502, "The model declined to write this explanation")
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    if not text:
        raise HTTPException(502, "Empty explanation")
    return {"text": text, "model": response.model}


@app.get("/api/metrics")
def metrics() -> dict:
    path = HERE / "artifacts" / "metrics.json"
    if not path.exists():
        raise HTTPException(404, "Run `python train.py` first")
    return json.loads(path.read_text())


# Only these three files are public - not the rest of the folder.
@app.get("/")
def home() -> FileResponse:
    return FileResponse(HERE / "index.html")


@app.get("/{name}.js")
def script(name: str) -> FileResponse:
    if name not in ("engine", "data"):
        raise HTTPException(404)
    return FileResponse(HERE / f"{name}.js", media_type="text/javascript")
