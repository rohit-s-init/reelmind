// A tiny API so your Reddit-like app can use the recommender.
// Run:  npm install  then  npm start   (listens on http://localhost:4000)
//
// Note: data lives in memory. When the server restarts, reload your posts and
// recent votes from your own database (see README "Keeping data after restarts").

const express = require("express");
const { Recommender } = require("./recommender");

const app = express();
app.use(express.json());
app.use(express.static(__dirname)); // so http://localhost:4000/demo.html works too

const rec = new Recommender();

// Someone created a post
app.post("/posts", (req, res) => {
  rec.addPost(req.body);
  res.json({ ok: true });
});

// A post was deleted
app.delete("/posts/:id", (req, res) => {
  rec.removePost(req.params.id);
  res.json({ ok: true });
});

// Someone viewed / upvoted / commented / saved / downvoted / hid a post
app.post("/activity", (req, res) => {
  const { userId, postId, action } = req.body;
  try {
    rec.track(userId, postId, action);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// A personalised feed: GET /feed/alex?limit=20
app.get("/feed/:userId", (req, res) => {
  res.json(rec.recommend(req.params.userId, Number(req.query.limit) || 20));
});

// Netflix-style home rows: GET /home/alex
app.get("/home/:userId", (req, res) => {
  res.json(rec.homeRows(req.params.userId));
});

// "More like this" under a post: GET /posts/p1/similar
app.get("/posts/:id/similar", (req, res) => {
  res.json(rec.moreLikeThis(req.params.id));
});

// Trending across the site: GET /trending
app.get("/trending", (req, res) => {
  res.json(rec.trending(Number(req.query.limit) || 20));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Recommender running on http://localhost:${PORT}`));
