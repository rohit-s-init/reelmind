"""ReelMind offline training + evaluation on the MovieLens dataset (slides 8-10).

What this script does, step by step:
  1. Collect the data     download MovieLens (100k ratings, 610 users, ~9.7k movies)
  2. Prepare features     ratings -> signals, genres + tags -> TF-IDF title vectors, split by time
  3. Build baselines      popularity, content-based, collaborative filtering
  4. Train the hybrid     grid-search the blend weights on a validation split
  5. Evaluate offline     Precision@10, Recall@10, NDCG@10, coverage, diversity, latency
  6. Save the results     artifacts/metrics.json (shown in the web demo)

Run:  python train.py
"""
from __future__ import annotations

import io
import json
import ssl
import time
import urllib.request
import zipfile
from itertools import product
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize
import truststore

HERE = Path(__file__).parent
DATA_DIR = HERE / "data"
ARTIFACTS = HERE / "artifacts"
MOVIELENS_URL = "https://files.grouplens.org/datasets/movielens/ml-latest-small.zip"

K = 10
LIKED = 4.0  # a rating of 4+ stars = "the viewer enjoyed it" (a strong positive signal)


# ---------------------------------------------------------------------------
# 1. Collect the data
# ---------------------------------------------------------------------------

def load_movielens() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    folder = DATA_DIR / "ml-latest-small"
    archive = DATA_DIR / "ml-latest-small.zip"
    if not folder.exists():
        DATA_DIR.mkdir(exist_ok=True)
        if not archive.exists():
            print(f"Downloading MovieLens from {MOVIELENS_URL} ...")
            # Use the operating system's certificates (avoids CERTIFICATE_VERIFY_FAILED
            # on Windows machines behind antivirus or proxy HTTPS inspection).
            context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            with urllib.request.urlopen(MOVIELENS_URL, context=context) as response:
                archive.write_bytes(response.read())
        zipfile.ZipFile(archive).extractall(DATA_DIR)
    ratings = pd.read_csv(folder / "ratings.csv")
    movies = pd.read_csv(folder / "movies.csv")
    tags = pd.read_csv(folder / "tags.csv")
    return ratings, movies, tags


# ---------------------------------------------------------------------------
# 2. Prepare features
# ---------------------------------------------------------------------------

class Dataset:
    """Maps MovieLens ids to matrix rows/columns and builds the title feature vectors."""

    def __init__(self, ratings: pd.DataFrame, movies: pd.DataFrame, tags: pd.DataFrame):
        self.movies = movies.set_index("movieId")
        self.item_ids = movies["movieId"].to_numpy()
        self.item_index = {m: i for i, m in enumerate(self.item_ids)}
        self.user_ids = np.sort(ratings["userId"].unique())
        self.user_index = {u: i for i, u in enumerate(self.user_ids)}
        self.genres = [set(g.split("|")) - {"(no genres listed)"} for g in movies["genres"]]

        # Title features: genres (weighted x2) + user tags, as TF-IDF vectors.
        tag_text = tags.groupby("movieId")["tag"].apply(lambda t: " ".join(t.astype(str))).to_dict()
        docs = [
            f"{genres.replace('|', ' ').replace('-', '')} " * 2 + tag_text.get(movie_id, "")
            for movie_id, genres in zip(movies["movieId"], movies["genres"])
        ]
        self.title_vectors = TfidfVectorizer(min_df=2, stop_words="english").fit_transform(docs)

    def matrix(self, ratings: pd.DataFrame) -> sparse.csr_matrix:
        """users x items matrix of positive signals (1 = enjoyed it)."""
        liked = ratings[ratings["rating"] >= LIKED]
        rows = liked["userId"].map(self.user_index).to_numpy()
        cols = liked["movieId"].map(self.item_index).to_numpy()
        return sparse.csr_matrix(
            (np.ones(len(liked)), (rows, cols)), shape=(len(self.user_ids), len(self.item_ids))
        )

    def seen(self, ratings: pd.DataFrame) -> sparse.csr_matrix:
        """users x items matrix of everything a user has rated (never recommend these again)."""
        rows = ratings["userId"].map(self.user_index).to_numpy()
        cols = ratings["movieId"].map(self.item_index).to_numpy()
        return sparse.csr_matrix(
            (np.ones(len(ratings)), (rows, cols)), shape=(len(self.user_ids), len(self.item_ids))
        )


def time_split(ratings: pd.DataFrame, test_fraction: float) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Each user's oldest ratings are for learning, their newest ones for testing.
    (We predict what someone enjoys *next*, never using the future to do it.)"""
    position = ratings.groupby("userId")["timestamp"].rank(method="first", pct=True)
    is_test = position > 1 - test_fraction
    return ratings[~is_test], ratings[is_test]


# ---------------------------------------------------------------------------
# 3. Baseline models - each returns a users x items score matrix
# ---------------------------------------------------------------------------

def popularity_scores(train_pos: sparse.csr_matrix, users: np.ndarray) -> np.ndarray:
    popularity = np.asarray(train_pos.sum(axis=0)).ravel()
    return np.tile(popularity, (len(users), 1))


def content_scores(train_pos: sparse.csr_matrix, title_vectors, users: np.ndarray) -> np.ndarray:
    # A viewer's taste = the average TF-IDF vector of the titles they enjoyed.
    profiles = normalize(train_pos[users] @ title_vectors)
    return (profiles @ title_vectors.T).toarray()


def collaborative_scores(train_pos: sparse.csr_matrix, users: np.ndarray) -> np.ndarray:
    # Item-item collaborative filtering: "people who enjoyed X also enjoyed Y".
    # score(user, j) = sum over enjoyed i of cosine(i, j), computed without building
    # the full items x items matrix.
    item_normed = normalize(train_pos, axis=0)
    return ((train_pos[users] @ item_normed.T) @ item_normed).toarray()


def minmax_rows(scores: np.ndarray) -> np.ndarray:
    lo = scores.min(axis=1, keepdims=True)
    hi = scores.max(axis=1, keepdims=True)
    return (scores - lo) / np.where(hi - lo > 0, hi - lo, 1)


def all_scores(train: pd.DataFrame, data: Dataset, users: np.ndarray) -> dict[str, np.ndarray]:
    train_pos = data.matrix(train)
    scores = {
        "popularity": popularity_scores(train_pos, users),
        "content": content_scores(train_pos, data.title_vectors, users),
        "collaborative": collaborative_scores(train_pos, users),
    }
    return {name: minmax_rows(s) for name, s in scores.items()}


def blend(scores: dict[str, np.ndarray], weights: dict[str, float]) -> np.ndarray:
    return sum(w * scores[name] for name, w in weights.items())


# ---------------------------------------------------------------------------
# Ranking, re-ranking and metrics
# ---------------------------------------------------------------------------

def top_k(scores: np.ndarray, seen: sparse.csr_matrix, k: int) -> np.ndarray:
    scores = scores.copy()
    scores[seen.nonzero()] = -np.inf  # never recommend something already watched
    top = np.argpartition(-scores, k, axis=1)[:, :k]
    order = np.argsort(-np.take_along_axis(scores, top, axis=1), axis=1)
    return np.take_along_axis(top, order, axis=1)


def genre_overlap(data: Dataset, a: int, b: int) -> float:
    ga, gb = data.genres[a], data.genres[b]
    return len(ga & gb) / len(ga | gb) if ga | gb else 0.0


def rerank(candidates: np.ndarray, scores: np.ndarray, data: Dataset, k: int, diversity: float) -> np.ndarray:
    """Greedy diversity re-ranking (MMR): relevance minus similarity to what's already picked."""
    picked_rows = []
    for row, items in enumerate(candidates):
        rel = minmax_rows(scores[row, items][None, :])[0]
        chosen: list[int] = []
        rest = list(range(len(items)))
        while len(chosen) < k and rest:
            def value(i):
                sim = max((genre_overlap(data, items[i], items[c]) for c in chosen), default=0.0)
                return (1 - diversity) * rel[i] - diversity * sim
            best = max(rest, key=value)
            chosen.append(best)
            rest.remove(best)
        picked_rows.append(items[chosen])
    return np.array(picked_rows)


def evaluate(recs: np.ndarray, truth: list[set[int]], data: Dataset) -> dict[str, float]:
    precision, recall, ndcg, diversity = [], [], [], []
    for items, relevant in zip(recs, truth):
        hits = np.array([i in relevant for i in items])
        precision.append(hits.sum() / len(items))
        recall.append(hits.sum() / len(relevant))
        dcg = (hits / np.log2(np.arange(2, len(items) + 2))).sum()
        idcg = (1 / np.log2(np.arange(2, min(len(items), len(relevant)) + 2))).sum()
        ndcg.append(dcg / idcg)
        pairs = [genre_overlap(data, a, b) for x, a in enumerate(items) for b in items[x + 1:]]
        diversity.append(1 - np.mean(pairs))
    return {
        "precision": float(np.mean(precision)),
        "recall": float(np.mean(recall)),
        "ndcg": float(np.mean(ndcg)),
        "coverage": len(np.unique(recs)) / len(data.item_ids),
        "diversity": float(np.mean(diversity)),
    }


def test_users(train: pd.DataFrame, test: pd.DataFrame, data: Dataset, min_history: int = 5):
    """Users with enough history to learn from and something new they enjoyed later."""
    seen = data.seen(train)
    history = np.asarray(data.matrix(train).sum(axis=1)).ravel()
    users, truth = [], []
    for user_id, group in test[test["rating"] >= LIKED].groupby("userId"):
        u = data.user_index[user_id]
        relevant = {data.item_index[m] for m in group["movieId"]} - set(seen[u].indices)
        if relevant and history[u] >= min_history:
            users.append(u)
            truth.append(relevant)
    return np.array(users), truth, seen[users]


# ---------------------------------------------------------------------------
# Main: train, tune, evaluate, save
# ---------------------------------------------------------------------------

def main() -> None:
    started = time.time()
    ratings, movies, tags = load_movielens()
    data = Dataset(ratings, movies, tags)
    print(f"Loaded {len(ratings):,} ratings from {len(data.user_ids)} users on {len(data.item_ids):,} movies")

    # 80% of each user's history for training, their newest 20% for the final test.
    train, test = time_split(ratings, 0.2)

    # 4. Train the hybrid: tune blend weights on a validation split inside the training data,
    #    so the test set stays untouched until the very end.
    inner_train, validation = time_split(train, 0.15)
    val_users, val_truth, val_seen = test_users(inner_train, validation, data)
    val_scores = all_scores(inner_train, data, val_users)

    print(f"Tuning blend weights on {len(val_users)} validation users ...")
    best_weights, best_ndcg = None, -1.0
    grid = np.round(np.arange(0, 1.01, 0.1), 2)
    for w_cf, w_content in product(grid, grid):
        w_pop = round(float(1 - w_cf - w_content), 2)
        if w_pop < 0:
            continue
        weights = {"collaborative": float(w_cf), "content": float(w_content), "popularity": w_pop}
        recs = top_k(blend(val_scores, weights), val_seen, K)
        ndcg = evaluate(recs, val_truth, data)["ndcg"]
        if ndcg > best_ndcg:
            best_weights, best_ndcg = weights, ndcg
    print(f"Best weights: {best_weights} (validation NDCG@10 = {best_ndcg:.3f})")

    # 5. Evaluate every model on the held-out test period.
    users, truth, seen = test_users(train, test, data)
    print(f"Evaluating on {len(users)} test users ...")
    t0 = time.perf_counter()
    scores = all_scores(train, data, users)
    scoring_ms = (time.perf_counter() - t0) * 1000 / len(users)

    models = {
        "Popularity baseline": {"popularity": 1.0},
        "Content-based": {"content": 1.0},
        "Collaborative filtering": {"collaborative": 1.0},
        "ReelMind hybrid": best_weights,
    }
    results = []
    for name, weights in models.items():
        t0 = time.perf_counter()
        recs = top_k(blend(scores, weights), seen, K)
        ms = scoring_ms + (time.perf_counter() - t0) * 1000 / len(users)
        results.append({"name": name, **evaluate(recs, truth, data), "latencyMs": ms})

    t0 = time.perf_counter()
    hybrid = blend(scores, best_weights)
    reranked = rerank(top_k(hybrid, seen, 50), hybrid, data, K, diversity=0.3)
    ms = scoring_ms + (time.perf_counter() - t0) * 1000 / len(users)
    results.append({"name": "ReelMind hybrid + re-ranking", **evaluate(reranked, truth, data), "latencyMs": ms})

    # 6. Save the results for the web demo.
    ARTIFACTS.mkdir(exist_ok=True)
    report = {
        "dataset": "MovieLens ml-latest-small",
        "ratings": len(ratings),
        "users": len(data.user_ids),
        "movies": len(data.item_ids),
        "test_users": len(users),
        "k": K,
        "best_weights": best_weights,
        "validation_ndcg": best_ndcg,
        "results": results,
        "trained_at": time.strftime("%Y-%m-%d %H:%M"),
        "seconds": round(time.time() - started, 1),
    }
    (ARTIFACTS / "metrics.json").write_text(json.dumps(report, indent=2))

    print()
    print(pd.DataFrame(results).set_index("name").round(3).to_string())
    print(f"\nSaved artifacts/metrics.json in {report['seconds']}s")


if __name__ == "__main__":
    main()
