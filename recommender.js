// A simple "Netflix-style" recommender for a Reddit-like app.
//
// It uses three easy ideas to decide what to show someone:
//   1. More like this   - posts with the same tags/community as posts you liked
//   2. People like you  - posts liked by people who liked the same things as you
//   3. Trending         - posts getting lots of love right now
// Each idea gives a post a score from 0 to 1. We mix them, sort, and explain why.

// How much each action says "I like this" (or "I don't").
const ACTION_POINTS = {
  view: 1,
  upvote: 3,
  comment: 4,
  save: 5,
  downvote: -3,
  hide: -5,
};

// How much each idea counts in the final score.
const MIX = { similar: 0.4, people: 0.4, trending: 0.2 };

class Recommender {
  constructor() {
    this.posts = new Map(); // postId -> post
    this.activity = new Map(); // userId -> Map(postId -> points)
  }

  // ---- Feeding data in -------------------------------------------------

  // post = { id, title, community, tags: [], author, createdAt (ms) }
  addPost(post) {
    this.posts.set(post.id, { tags: [], createdAt: Date.now(), ...post });
  }

  removePost(postId) {
    this.posts.delete(postId);
  }

  // Call this whenever a user does something: track("alex", "p12", "upvote")
  track(userId, postId, action) {
    const points = ACTION_POINTS[action];
    if (points === undefined) throw new Error(`Unknown action: ${action}`);
    if (!this.activity.has(userId)) this.activity.set(userId, new Map());
    const mine = this.activity.get(userId);
    mine.set(postId, (mine.get(postId) || 0) + points);
  }

  // ---- Asking for recommendations ---------------------------------------

  // Returns [{ post, score, reason }], best first.
  recommend(userId, limit = 10) {
    const mine = this.activity.get(userId) || new Map();
    const liked = this.#likedPosts(userId);
    const taste = this.#tasteProfile(liked, mine);
    const neighbours = this.#similarUsers(userId);

    // Score every post the user hasn't seen yet (and didn't write).
    const candidates = [...this.posts.values()].filter(
      (p) => !mine.has(p.id) && p.author !== userId
    );

    const raw = candidates.map((post) => ({
      post,
      similar: this.#similarityToTaste(post, taste),
      people: this.#peopleLikeYouScore(post.id, neighbours),
      trending: this.#trendingScore(post),
    }));

    // Scale each idea to 0..1 so they can be mixed fairly.
    for (const key of Object.keys(MIX)) {
      const max = Math.max(0, ...raw.map((r) => r[key]));
      for (const r of raw) r[key] = max > 0 ? r[key] / max : 0;
    }

    // New users have no history yet, so lean on trending for them.
    const mix = liked.length ? MIX : { similar: 0, people: 0, trending: 1 };

    return raw
      .map((r) => {
        const parts = Object.keys(mix).map((k) => [k, mix[k] * r[k]]);
        const score = parts.reduce((sum, [, v]) => sum + v, 0);
        const [mainReason] = parts.sort((a, b) => b[1] - a[1])[0];
        return { post: r.post, score, reason: this.#explain(mainReason, r.post, liked) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // Posts that look like this one (for a "More like this" section on a post page).
  moreLikeThis(postId, limit = 6) {
    const post = this.posts.get(postId);
    if (!post) return [];
    return [...this.posts.values()]
      .filter((p) => p.id !== postId)
      .map((p) => ({ post: p, score: overlap(post, p), reason: `Similar to "${post.title}"` }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // What's hot across the whole site right now.
  trending(limit = 10, userId = null) {
    const seen = (userId && this.activity.get(userId)) || new Map();
    return [...this.posts.values()]
      .filter((p) => !seen.has(p.id))
      .map((p) => ({ post: p, score: this.#trendingScore(p), reason: `Trending in r/${p.community}` }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // The Netflix home screen: a list of titled rows.
  homeRows(userId, perRow = 8) {
    const rows = [];
    const shown = new Set();
    const addRow = (title, items) => {
      const fresh = items.filter((r) => !shown.has(r.post.id)).slice(0, perRow);
      if (fresh.length >= 2) {
        rows.push({ title, items: fresh });
        fresh.forEach((r) => shown.add(r.post.id));
      }
    };

    const seen = this.activity.get(userId) || new Map();
    const liked = this.#likedPosts(userId);

    if (liked.length) addRow("Top picks for you", this.recommend(userId, perRow * 2));

    // "Because you liked X" for the two most recent things they loved.
    for (const post of liked.slice(-2).reverse()) {
      const unseen = this.moreLikeThis(post.id, perRow * 2).filter((r) => !seen.has(r.post.id));
      addRow(`Because you liked "${post.title}"`, unseen);
    }

    addRow("Trending now", this.trending(perRow * 2, userId));
    return rows;
  }

  // ---- The three ideas, in plain code ----------------------------------

  // Posts this user reacted positively to (oldest first).
  #likedPosts(userId) {
    const mine = this.activity.get(userId) || new Map();
    return [...mine]
      .filter(([, points]) => points >= ACTION_POINTS.upvote)
      .map(([id]) => this.posts.get(id))
      .filter(Boolean);
  }

  // What tags and communities this user is into, e.g. { "tag:rpg": 8, "community:gaming": 5 }.
  // Things they downvoted or hid count against.
  #tasteProfile(liked, mine) {
    const taste = new Map();
    const add = (key, amount) => taste.set(key, (taste.get(key) || 0) + amount);
    for (const [postId, points] of mine) {
      const post = this.posts.get(postId);
      if (!post || (points > 0 && points < ACTION_POINTS.upvote)) continue; // just a view
      add(`community:${post.community}`, points);
      post.tags.forEach((t) => add(`tag:${t}`, points));
    }
    return taste;
  }

  // Idea 1: how well does this post match the user's taste?
  #similarityToTaste(post, taste) {
    let score = taste.get(`community:${post.community}`) || 0;
    post.tags.forEach((t) => (score += taste.get(`tag:${t}`) || 0));
    return Math.max(0, score);
  }

  // Find users who liked the same posts as this user. Returns [[otherUser, similarity]].
  #similarUsers(userId) {
    const mine = this.activity.get(userId);
    if (!mine) return [];
    const myLikes = new Set([...mine].filter(([, p]) => p > 0).map(([id]) => id));
    const result = [];
    for (const [other, theirs] of this.activity) {
      if (other === userId) continue;
      const theirLikes = [...theirs].filter(([, p]) => p > 0).map(([id]) => id);
      const shared = theirLikes.filter((id) => myLikes.has(id)).length;
      if (shared > 0) result.push([other, shared / Math.sqrt(myLikes.size * theirLikes.length)]);
    }
    return result.sort((a, b) => b[1] - a[1]).slice(0, 20);
  }

  // Idea 2: did people with similar taste like this post?
  #peopleLikeYouScore(postId, neighbours) {
    let score = 0;
    for (const [other, similarity] of neighbours) {
      score += similarity * (this.activity.get(other).get(postId) || 0);
    }
    return Math.max(0, score);
  }

  // Idea 3: lots of love, recently. Older posts slowly fade (like Reddit's "hot").
  #trendingScore(post) {
    let love = 0;
    for (const theirs of this.activity.values()) love += Math.max(0, theirs.get(post.id) || 0);
    const ageHours = (Date.now() - post.createdAt) / 3_600_000;
    return love / Math.pow(ageHours + 2, 1.2);
  }

  // A friendly sentence explaining why a post was picked.
  #explain(mainReason, post, liked) {
    if (mainReason === "similar") {
      const best = liked
        .map((l) => [l, overlap(l, post)])
        .sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] > 0) return `Because you liked "${best[0].title}"`;
      return `Matches your interest in r/${post.community}`;
    }
    if (mainReason === "people") return "People with similar taste loved this";
    return `Trending in r/${post.community}`;
  }
}

// How many things two posts have in common (same community counts double).
function overlap(a, b) {
  const shared = a.tags.filter((t) => b.tags.includes(t)).length;
  return shared + (a.community === b.community ? 2 : 0);
}

// Works in the browser (window.Recommender) and in Node (require / import).
if (typeof module !== "undefined") module.exports = { Recommender, ACTION_POINTS };
