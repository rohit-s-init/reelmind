// ReelMind - a small, readable version of the recommendation pipeline from the case study:
//
//   1. Collect signals      what the viewer watched, finished, liked, skipped, searched
//   2. Build features       turn titles and viewers into comparable "taste vectors"
//   3. Generate candidates  shortlist from 4 retrievers (collaborative, content, search, trending)
//   4. Rank                 blend the retriever scores into one relevance score
//   5. Re-rank responsibly  add diversity, novelty and freshness
//   6. Explain              a grounded "Why this?" built only from real evidence
//   7. Serve and learn      return results + a trace, and learn from the next click
//
// Plus evaluate(): Precision@K, Recall@K, NDCG@K, coverage, diversity and latency
// for baselines vs. the hybrid model.
//
// Runs in the browser (window.ReelMind) and in Node (require("./engine.js")).

(function (root) {
  // How much each viewing signal says about taste (slide 4: "learning value").
  const SIGNAL_WEIGHTS = { complete: 5, like: 4, partial: 1, skip: -2, dislike: -4 };
  const STRONG = 4; // complete or like = "this viewer really enjoyed it"

  const DAY = 86_400_000;
  const SESSION = 30 * 60_000; // actions in the last 30 min count extra (session-aware)

  // A tiny synonym list so searches like "scary" or "funny" match genres.
  const SYNONYMS = {
    scary: ["horror", "terror"], funny: ["comedy", "humor"], love: ["romance"],
    romantic: ["romance"], space: ["space", "astronaut", "planet"], survival: ["survival", "stranded"],
    cartoon: ["animation"], kids: ["family", "animation"], fight: ["action"], mind: ["twist", "puzzle"],
    robot: ["ai", "robot"], sad: ["drama"], heist: ["crime"],
  };
  const STOP = new Set("a an the and or of to in on for with is it its this that me my i im want something show movie film".split(" "));

  // ---------- Small vector helpers (vectors are Maps: token -> weight) ----------

  function tokenize(text) {
    return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !STOP.has(w));
  }

  function normalize(vec) {
    let norm = 0;
    for (const v of vec.values()) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm > 0) for (const [k, v] of vec) vec.set(k, v / norm);
    return vec;
  }

  function cosine(a, b) {
    if (!a || !b) return 0;
    const [small, big] = a.size < b.size ? [a, b] : [b, a];
    let dot = 0;
    for (const [k, v] of small) dot += v * (big.get(k) || 0);
    return dot;
  }

  function addInto(target, vec, weight) {
    for (const [k, v] of vec) target.set(k, (target.get(k) || 0) + v * weight);
  }

  function scaleToOne(scores) {
    const max = Math.max(0, ...scores.values());
    for (const [k, v] of scores) scores.set(k, max > 0 ? Math.max(0, v) / max : 0);
    return scores;
  }

  function genreOverlap(a, b) {
    const shared = a.genres.filter((g) => b.genres.includes(g)).length;
    return shared / new Set([...a.genres, ...b.genres]).size;
  }

  function topN(scores, n) {
    return [...scores].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
  }

  // ---------- The grounded GenAI prompt (shared by the browser and the server) ----------

  const EXPLAIN_SYSTEM_PROMPT =
    "You write the short 'Why this?' note shown under a movie recommendation. " +
    "Use ONLY the facts provided. Do not invent plot details, actors, awards or numbers. " +
    "Write one friendly sentence of at most 30 words, speaking to the viewer as 'you'.";

  function buildExplanationPrompt(facts) {
    const clean = {
      recommended_title: String(facts.title || "").slice(0, 100),
      year: facts.year,
      genres: (facts.genres || []).slice(0, 5),
      main_reason: facts.main_reason,
      evidence: (facts.evidence || []).slice(0, 5).map((e) => String(e).slice(0, 200)),
    };
    return `Facts about this recommendation (from the recommender's own data):\n${JSON.stringify(clean, null, 2)}\n\nWrite the 'Why this?' sentence.`;
  }

  // ---------- The recommender ----------

  class ReelMind {
    constructor(titles) {
      this.titles = titles;
      this.byId = new Map(titles.map((t) => [t.id, t]));
      this.events = []; // { userId, titleId, type, ts }
      this.searches = []; // { userId, query, ts }
      this.vectors = this.#buildTitleVectors(titles); // Stage 2 (title side)
      this._model = null;
    }

    // ---- Stage 7 "learn": every new action goes into the event log ----

    logEvent(userId, titleId, type, ts = Date.now()) {
      if (!(type in SIGNAL_WEIGHTS)) throw new Error(`Unknown signal: ${type}`);
      this.events.push({ userId, titleId, type, ts });
      this._model = null; // behaviour changed, refit lazily
    }

    logSearch(userId, query, ts = Date.now()) {
      this.searches.push({ userId, query, ts });
    }

    model() {
      return (this._model ||= this.fit(this.events, Date.now()));
    }

    // ---- Stage 1: collect signals for one viewer ----
    // Returns Map(titleId -> weight). Recent actions count more; this session counts most.
    signalsFor(userId, events = this.events, now = Date.now()) {
      const signals = new Map();
      for (const e of events) {
        if (e.userId !== userId || e.ts > now) continue;
        let w = SIGNAL_WEIGHTS[e.type] * Math.pow(0.5, (now - e.ts) / (30 * DAY));
        if (now - e.ts < SESSION) w *= 1.5;
        signals.set(e.titleId, (signals.get(e.titleId) || 0) + w);
      }
      return signals;
    }

    // ---- Stage 2: features ----

    // Each title becomes a TF-IDF style vector of its genres, keywords and synopsis words.
    #buildTitleVectors(titles) {
      const raw = titles.map((t) => {
        const vec = new Map();
        const add = (tok, w) => vec.set(tok, (vec.get(tok) || 0) + w);
        t.genres.forEach((g) => add(g.toLowerCase(), 3));
        t.keywords.forEach((k) => tokenize(k).forEach((tok) => add(tok, 2)));
        tokenize(t.synopsis).forEach((tok) => add(tok, 1));
        return vec;
      });
      // Rare words are more informative than common ones.
      const df = new Map();
      raw.forEach((v) => v.forEach((_, tok) => df.set(tok, (df.get(tok) || 0) + 1)));
      const vectors = new Map();
      raw.forEach((vec, i) => {
        for (const [tok, w] of vec) vec.set(tok, w * Math.log(1 + titles.length / df.get(tok)));
        vectors.set(titles[i].id, normalize(vec));
      });
      return vectors;
    }

    // The viewer's taste vector: titles they enjoyed pull it closer, skips push it away.
    profileFor(signals) {
      const profile = new Map();
      for (const [id, w] of signals) {
        const vec = this.vectors.get(id);
        if (vec) addInto(profile, vec, w > 0 ? w : w * 0.5);
      }
      return profile.size ? normalize(profile) : null;
    }

    // What the viewer has been searching for recently (explicit intent).
    searchIntent(userId) {
      const recent = this.searches.filter((s) => s.userId === userId).slice(-3);
      if (!recent.length) return null;
      const vec = new Map();
      for (const s of recent) {
        for (const word of tokenize(s.query)) {
          [word, ...(SYNONYMS[word] || [])].forEach((tok) => vec.set(tok, (vec.get(tok) || 0) + 1));
        }
      }
      return { query: recent[recent.length - 1].query, vector: normalize(vec) };
    }

    // Behavioural model learned from everyone's events:
    //  - co:         "people who enjoyed X also enjoyed Y" similarity between titles
    //  - fans:       which viewers enjoyed each title
    //  - popularity: how much love each title got in the last 14 days
    fit(events, now) {
      const enjoyed = new Map(); // userId -> Set(titleId)
      const net = new Map();
      for (const e of events) {
        const key = `${e.userId}|${e.titleId}`;
        net.set(key, (net.get(key) || 0) + SIGNAL_WEIGHTS[e.type]);
      }
      for (const [key, w] of net) {
        if (w < STRONG) continue;
        const [userId, titleId] = key.split("|");
        if (!enjoyed.has(userId)) enjoyed.set(userId, new Set());
        enjoyed.get(userId).add(titleId);
      }

      const fans = new Map();
      const pairCount = new Map();
      for (const [userId, titles] of enjoyed) {
        const list = [...titles];
        for (const t of list) {
          if (!fans.has(t)) fans.set(t, new Set());
          fans.get(t).add(userId);
        }
        for (const a of list) for (const b of list) {
          if (a !== b) pairCount.set(`${a}|${b}`, (pairCount.get(`${a}|${b}`) || 0) + 1);
        }
      }
      const co = new Map();
      for (const [key, count] of pairCount) {
        const [a, b] = key.split("|");
        if (!co.has(a)) co.set(a, new Map());
        co.get(a).set(b, count / Math.sqrt(fans.get(a).size * fans.get(b).size));
      }

      const popularity = new Map();
      for (const e of events) {
        if (SIGNAL_WEIGHTS[e.type] > 0 && now - e.ts < 14 * DAY && e.ts <= now) {
          popularity.set(e.titleId, (popularity.get(e.titleId) || 0) + 1);
        }
      }
      return { co, fans, popularity };
    }

    // ---- Stages 3-6, end to end ----
    //
    // options:
    //   k          how many titles to return
    //   method     "hybrid" | "popularity" | "content" | "collaborative"
    //   rerank     apply diversity/novelty/freshness re-ranking (stage 5)
    //   diversity  0 = pure relevance, 1 = maximum variety
    recommend(userId, options = {}) {
      const {
        k = 10, method = "hybrid", rerank = method === "hybrid", diversity = 0.3,
        events = this.events, model = this.model(), now = Date.now(),
        useSearch = true, explain = true, exclude = new Set(),
      } = options;
      const started = performanceNow();

      // Stage 1 + 2
      const signals = this.signalsFor(userId, events, now);
      const profile = this.profileFor(signals);
      const intent = useSearch ? this.searchIntent(userId) : null;
      const liked = [...signals].filter(([, w]) => w > 0);
      const pool = this.titles.filter((t) => !signals.has(t.id) && !exclude.has(t.id));

      // Each retriever scores every unseen title.
      const raw = { collaborative: new Map(), content: new Map(), search: new Map(), trending: new Map() };
      for (const t of pool) {
        const vec = this.vectors.get(t.id);
        let cf = 0;
        for (const [id, w] of liked) cf += w * (model.co.get(id)?.get(t.id) || 0);
        raw.collaborative.set(t.id, cf);
        raw.content.set(t.id, profile ? Math.max(0, cosine(profile, vec)) : 0);
        raw.search.set(t.id, intent ? cosine(intent.vector, vec) : 0);
        raw.trending.set(t.id, model.popularity.get(t.id) || 0);
      }
      const trendingRaw = new Map(raw.trending);
      Object.values(raw).forEach(scaleToOne);

      // How much each retriever counts. New viewers lean on trending until we know them.
      const strength = Math.min(1, liked.length / 5);
      const weights = {
        hybrid: {
          collaborative: 0.45 * strength,
          content: 0.3 * strength,
          search: intent ? 0.35 : 0,
          trending: 0.1 + 0.4 * (1 - strength),
        },
        popularity: { trending: 1 },
        search: { search: 1 },
        content: { content: 1 },
        collaborative: { collaborative: 1 },
      }[method];

      // Stage 3: candidate generation - shortlist the top titles from each active retriever.
      const candidates = new Set();
      for (const [name, w] of Object.entries(weights)) {
        if (w > 0) topN(raw[name], 15).forEach((id) => candidates.add(id));
      }

      // Stage 4: ranking - blend into one relevance score per candidate.
      const ranked = [...candidates].map((id) => {
        const parts = {};
        let score = 0;
        for (const [name, w] of Object.entries(weights)) {
          parts[name] = w * raw[name].get(id);
          score += parts[name];
        }
        return { title: this.byId.get(id), score, parts, popularity: raw.trending.get(id) };
      }).sort((a, b) => b.score - a.score);

      // Stage 5: responsible re-ranking.
      const final = rerank ? this.#rerank(ranked, k, diversity) : ranked.slice(0, k);

      // Stage 6: grounded explanations.
      const items = final.map((r) => ({
        ...r,
        match: Math.round(Math.min(1, r.score / (final[0]?.score || 1)) * 100),
        explanation: explain ? this.#explain(r, signals, model, intent, trendingRaw) : null,
      }));

      // Stage 7: serve, with a trace of what each stage did.
      const trace = {
        signals: signals.size,
        searches: intent ? 1 : 0,
        featurized: this.titles.length,
        candidates: candidates.size,
        ranked: ranked.length,
        served: items.length,
        ms: +(performanceNow() - started).toFixed(2),
        weights,
      };
      return { items, trace };
    }

    // "Because you enjoyed X": titles that fans of X also enjoyed, or that look like X.
    similarTo(titleId, { k = 10, exclude = new Set() } = {}) {
      const model = this.model();
      const source = this.byId.get(titleId);
      return this.titles
        .filter((t) => t.id !== titleId && !exclude.has(t.id))
        .map((t) => {
          const together = model.co.get(titleId)?.get(t.id) || 0;
          const alike = cosine(this.vectors.get(titleId), this.vectors.get(t.id));
          return { title: t, score: 0.6 * together + 0.4 * alike };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map((r) => ({ ...r, source }));
    }

    // Greedy re-ranking: each pick balances relevance against being too similar to
    // what's already on the list (diversity), plus a small boost for less-known
    // titles (novelty) and recently added ones (freshness).
    #rerank(ranked, k, diversity) {
      const chosen = [];
      const rest = [...ranked];
      while (chosen.length < k && rest.length) {
        let bestIndex = 0;
        let bestValue = -Infinity;
        rest.forEach((r, i) => {
          const similarity = chosen.length ? Math.max(...chosen.map((c) => genreOverlap(c.title, r.title))) : 0;
          const novelty = 1 - r.popularity;
          const freshness = Math.exp(-r.title.addedDaysAgo / 30);
          const value = (1 - diversity) * r.score - diversity * similarity * 0.5 + 0.05 * novelty + 0.05 * freshness;
          if (value > bestValue) [bestValue, bestIndex] = [value, i];
        });
        chosen.push(rest.splice(bestIndex, 1)[0]);
      }
      return chosen;
    }

    // Collect real evidence for a recommendation, then write a template sentence from it.
    // The same facts are what the LLM receives, so it can't make things up.
    #explain(r, signals, model, intent, trendingRaw) {
      const t = r.title;
      const evidence = [];
      const enjoyed = [...signals].filter(([, w]) => w >= 2).map(([id]) => this.byId.get(id)).filter(Boolean);
      const main = Object.entries(r.parts).sort((a, b) => b[1] - a[1])[0]?.[0] || "trending";
      let text;

      // Collaborative evidence: viewers who enjoyed one of your titles also enjoyed this one.
      let cfSource = null;
      for (const l of enjoyed) {
        const both = [...(model.fans.get(l.id) || [])].filter((u) => model.fans.get(t.id)?.has(u)).length;
        if (both > (cfSource?.both || 0)) cfSource = { title: l, both };
      }
      if (cfSource) evidence.push(`${cfSource.both} viewers who enjoyed ${cfSource.title.title} also enjoyed ${t.title}`);

      // Content evidence: what this title has in common with something you enjoyed.
      let contentSource = null;
      for (const l of enjoyed) {
        const sim = cosine(this.vectors.get(l.id), this.vectors.get(t.id));
        if (sim > (contentSource?.sim || 0.05)) contentSource = { title: l, sim };
      }
      let shared = [];
      if (contentSource) {
        const s = contentSource.title;
        shared = [...s.genres.filter((g) => t.genres.includes(g)), ...s.keywords.filter((k) => t.keywords.includes(k))];
        if (shared.length) evidence.push(`Shares ${shared.slice(0, 3).join(", ")} with ${s.title}, which you enjoyed`);
      }

      // Search evidence.
      let matched = [];
      if (intent) {
        const words = new Set(tokenize(t.genres.join(" ") + " " + t.keywords.join(" ") + " " + t.synopsis));
        matched = [...intent.vector.keys()].filter((w) => words.has(w));
        if (matched.length) evidence.push(`Matches your search "${intent.query}" (${matched.slice(0, 3).join(", ")})`);
      }

      // Trending evidence.
      const fans = trendingRaw.get(t.id) || 0;
      if (fans) evidence.push(`${fans} viewers enjoyed it in the last 2 weeks`);

      if (main === "search" && matched.length) {
        text = `You searched "${intent.query}". This ${t.genres[0].toLowerCase()} pick is about ${matched.slice(0, 2).join(" and ")}.`;
      } else if (main === "collaborative" && cfSource) {
        text = `${cfSource.both} viewers who loved ${cfSource.title.title} also loved this one.`;
      } else if ((main === "content" || main === "collaborative") && shared.length) {
        text = `Because you enjoyed ${contentSource.title.title}: it also has ${shared.slice(0, 2).join(" and ")}.`;
      } else {
        text = fans ? `Popular right now: ${fans} viewers enjoyed it in the last 2 weeks.` : "A fresh pick to explore something new.";
      }

      const facts = { title: t.title, year: t.year, genres: t.genres, main_reason: main, evidence };
      return { text, evidence, main, facts, prompt: buildExplanationPrompt(facts) };
    }

    // ---- Offline evaluation (slide 10) ----
    // Time-based split: learn from the first 80% of events, test on what viewers
    // enjoyed afterwards. Compares baselines with the hybrid model.
    evaluate({ k = 10 } = {}) {
      const sorted = [...this.events].sort((a, b) => a.ts - b.ts);
      const cutoff = sorted[Math.floor(sorted.length * 0.8)].ts;
      const train = sorted.filter((e) => e.ts < cutoff);
      const model = this.fit(train, cutoff);

      const relevant = new Map(); // userId -> Set(titles enjoyed after the cutoff)
      for (const e of sorted) {
        if (e.ts >= cutoff && SIGNAL_WEIGHTS[e.type] >= STRONG) {
          if (!relevant.has(e.userId)) relevant.set(e.userId, new Set());
          relevant.get(e.userId).add(e.titleId);
        }
      }

      const methods = [
        ["Popularity baseline", "popularity", false],
        ["Content-based", "content", false],
        ["Collaborative filtering", "collaborative", false],
        ["ReelMind hybrid", "hybrid", false],
        ["ReelMind hybrid + re-ranking", "hybrid", true],
      ];

      return methods.map(([name, method, rerank]) => {
        let precision = 0, recall = 0, ndcg = 0, diversity = 0, ms = 0, users = 0;
        const recommendedAnywhere = new Set();
        for (const [userId, rel] of relevant) {
          const seen = this.signalsFor(userId, train, cutoff);
          const truth = [...rel].filter((id) => !seen.has(id));
          if (!truth.length || seen.size < 2) continue;

          const t0 = performanceNow();
          const { items } = this.recommend(userId, {
            k, method, rerank, events: train, model, now: cutoff, useSearch: false, explain: false,
          });
          ms += performanceNow() - t0;

          const ids = items.map((i) => i.title.id);
          ids.forEach((id) => recommendedAnywhere.add(id));
          const hits = ids.map((id) => truth.includes(id));
          const hitCount = hits.filter(Boolean).length;
          precision += hitCount / k;
          recall += hitCount / truth.length;
          const dcg = hits.reduce((s, h, i) => s + (h ? 1 / Math.log2(i + 2) : 0), 0);
          let idcg = 0;
          for (let i = 0; i < Math.min(k, truth.length); i++) idcg += 1 / Math.log2(i + 2);
          ndcg += dcg / idcg;

          let pairs = 0, overlap = 0;
          for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
            overlap += genreOverlap(items[i].title, items[j].title);
            pairs++;
          }
          diversity += pairs ? 1 - overlap / pairs : 0;
          users++;
        }
        const avg = (x) => (users ? x / users : 0);
        return {
          name,
          precision: avg(precision),
          recall: avg(recall),
          ndcg: avg(ndcg),
          coverage: recommendedAnywhere.size / this.titles.length,
          diversity: avg(diversity),
          latencyMs: avg(ms),
          users,
        };
      });
    }
  }

  function performanceNow() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  const api = { ReelMind, SIGNAL_WEIGHTS, EXPLAIN_SYSTEM_PROMPT, buildExplanationPrompt };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ReelMindLib = api;
})(typeof window !== "undefined" ? window : globalThis);
