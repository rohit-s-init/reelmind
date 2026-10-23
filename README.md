# Netflix-style recommendation systems

This repo has two projects:

| Folder | What it is |
|---|---|
| [`reelmind/`](reelmind/) | **ReelMind**: the GenAI recommendation prototype from the *Netflix Recommendations End-to-End* case study. Python training on MovieLens, a FastAPI backend, Claude-written "Why this?" explanations, and an interactive demo. |
| this folder | **Feedflix**: a simple recommender for a Reddit-like app (plain JavaScript). |

### Run ReelMind (Windows)
Double-click **`reelmind/start.bat`**. It stops any old server, sets up Python on the first
run, trains the model, starts the server and opens http://localhost:8000.
For AI-written explanations, set `ANTHROPIC_API_KEY` first. See [`reelmind/README.md`](reelmind/README.md).

---

# Feedflix: simple Netflix-style recommendations for a Reddit-like app

## See it in action
Double-click **`demo.html`** to open it in your browser. No install needed.
Pick a user (Alex, Priya, Sam or a new visitor), upvote or hide posts, and watch the rows change.

## How it decides what to show
Each post gets a score from three simple ideas:

| Idea | What it means | Weight |
|---|---|---|
| 🧩 More like this | The post shares tags or a community with posts you liked | 40% |
| 👥 People like you | People who liked the same posts as you also liked this one | 40% |
| 🔥 Trending | Lots of upvotes and saves recently (new visitors see only this) | 20% |

Posts you've already seen, hidden, or written yourself are skipped. Every pick also comes
with a reason, like *"Because you liked 'Elden Ring DLC tier list'"*.

To change how much each action counts, edit `ACTION_POINTS` and `MIX` at the top of `recommender.js`.

## Files
- `recommender.js` is the whole recommender (about 200 lines, with comments)
- `demo.html` is the HTML/CSS demo
- `server.js` is a small API your app can call

## Connecting it to your app
```bash
npm install
npm start          # http://localhost:4000
```

Your app sends what happens and asks for recommendations:

```js
const API = "http://localhost:4000";

// 1. When someone creates a post
await fetch(`${API}/posts`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "p1", title: "My first post", community: "gaming",
                         tags: ["rpg"], author: "alex", createdAt: Date.now() }),
});

// 2. When someone views, upvotes, comments, saves, downvotes or hides a post
await fetch(`${API}/activity`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: "alex", postId: "p1", action: "upvote" }),
});

// 3. When you build the home page
const feed = await fetch(`${API}/feed/alex`).then((r) => r.json());   // one ranked list
const rows = await fetch(`${API}/home/alex`).then((r) => r.json());   // Netflix-style rows
```

Other endpoints: `GET /posts/:id/similar` (for a "More like this" box on a post page),
`GET /trending`, and `DELETE /posts/:id`.

If your backend is Node already, you can skip the server and use the class directly:
`const { Recommender } = require("./recommender")`.

## Keeping data after restarts
The recommender keeps everything in memory. When your server starts, load your posts and
recent votes from your own database and pass them in with `addPost` and `track`.
That works fine up to tens of thousands of posts. If you grow past that, switch to a dedicated
recommendation service.
