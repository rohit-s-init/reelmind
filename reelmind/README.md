# ReelMind: a GenAI recommendation framework

A working prototype of the Topic 3 case study, *Netflix Recommendations End-to-End*.
It covers the whole pipeline from the slides: collect signals → build features →
candidate generation → ranking → responsible re-ranking → grounded GenAI
explanation → serve and learn. It also measures itself with Precision, Recall and NDCG.

## Run it

**Easiest (Windows):** double-click **`start.bat`**. It stops any old server on port 8000,
sets up Python and trains the model on the first run, then starts the server and opens your browser.

**Quick look, no install:** double-click `index.html`. The demo runs fully in the browser.
"Why this?" uses template explanations in this mode.

**Full version (Python training + live GenAI):**
```bash
cd reelmind
python -m venv .venv
.venv\Scripts\activate            # Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt

python train.py                   # downloads MovieLens, trains, evaluates, saves artifacts/metrics.json
set ANTHROPIC_API_KEY=sk-ant-...  # Mac/Linux: export ANTHROPIC_API_KEY=...
uvicorn app:app --port 8000       # open http://localhost:8000
```

## What's in the folder

| File | Role | Slide |
|---|---|---|
| `train.py` | Offline training on MovieLens with Pandas and scikit-learn: baselines, hybrid with tuned weights, re-ranking, evaluation | 8, 9, 10 |
| `app.py` | FastAPI service: GenAI "Why this?" explanations (Claude) and trained metrics | 9, 11 |
| `engine.js` | Low-latency online recommender: all 7 pipeline stages, readable and commented | 5, 6, 7 |
| `data.js` | Demo catalogue (41 films) and viewers, including U-104 and U-219 from slide 4 | 4 |
| `index.html` | The demo UI | 7 |

## How it works (in one breath)

1. **Signals:** finished = +5, liked = +4, half-watched = +1, skipped = −2, disliked = −4.
   Recent actions count more, and actions from this session count most.
2. **Features:** every title becomes a TF-IDF vector of genres, keywords and synopsis.
   A viewer's taste vector is built from the titles they enjoyed.
3. **Candidates:** four retrievers each shortlist their top 15 titles:
   - *collaborative:* people who enjoyed X also enjoyed Y
   - *content:* looks like what you enjoyed
   - *search:* matches what you typed
   - *trending:* popular right now
4. **Ranking:** the retriever scores are blended into one score. In `train.py` the blend
   weights are *learned* by grid search on a validation split. New viewers lean on trending.
5. **Re-ranking:** a greedy MMR step trades a little relevance for variety, plus small
   boosts for lesser-known and recently added titles.
6. **Explanation:** the recommender collects real evidence (for example, "9 viewers who enjoyed
   Shutter Island also enjoyed Prisoners"). Claude is asked to write one sentence using
   **only** that evidence. The exact prompt is visible in the demo.
7. **Serve and learn:** every click is logged and the next page view uses it straight away.

## Suggested 3-minute jury demo

1. Pick **U-104**, who finishes sci-fi thrillers and skips romance. The top picks are twisty thrillers.
   Point at the pipeline strip: signals → candidates → ranked → served in a few ms.
2. Click **✨ Why this?** on a card. Show the GenAI sentence, the evidence list, the score bars,
   and *"Show the exact prompt"*. This is the "grounded" part: the LLM only sees real facts.
3. Pick **U-219**, who searched "space survival". The search row shows Gravity, Interstellar and Cast Away.
4. Pick **New viewer** to show the cold start: trending titles only. Click 👍 on two titles and
   watch the page personalise instantly.
5. Move the **Variety** slider to show the diversity vs. relevance trade-off.
6. Scroll to **evaluation**: on real MovieLens data, the hybrid beats the popularity baseline,
   and re-ranking raises diversity.

## Honest limitations
- The online demo uses a small hand-made catalogue. Training uses MovieLens-small (100k ratings).
- TF-IDF stands in for Sentence-Transformer embeddings, and plain Python/JS stands in for FAISS,
  MLflow and a feature store. The pipeline is the same, just with a lighter stack (as slide 9 allows).
- This is an educational implementation, not Netflix's production system.
