// Sample catalogue + viewing history for the ReelMind demo.
// In a real project these come from MovieLens (slide 4) or your own database.

(function (root) {
  // genres, keywords and a one-line synopsis are the "title signals" used for content matching.
  const TITLES = [
    ["interstellar", "Interstellar", 2014, ["Sci-Fi", "Drama"], ["space", "time", "survival", "family"], "Astronauts travel through a wormhole to find humanity a new home planet."],
    ["martian", "The Martian", 2015, ["Sci-Fi", "Adventure"], ["space", "survival", "mars", "humor"], "A stranded astronaut must survive alone on Mars until rescue arrives."],
    ["gravity", "Gravity", 2013, ["Sci-Fi", "Thriller"], ["space", "survival", "astronaut"], "Two astronauts fight to survive after debris destroys their shuttle."],
    ["arrival", "Arrival", 2016, ["Sci-Fi", "Drama"], ["aliens", "language", "twist", "time"], "A linguist races to talk with mysterious alien visitors."],
    ["inception", "Inception", 2010, ["Sci-Fi", "Thriller"], ["dreams", "heist", "twist", "puzzle"], "A thief steals secrets by entering people's dreams."],
    ["dune", "Dune", 2021, ["Sci-Fi", "Adventure"], ["desert", "planet", "epic", "empire"], "A young heir fights for survival on a dangerous desert planet."],
    ["bladerunner", "Blade Runner 2049", 2017, ["Sci-Fi", "Thriller"], ["robot", "ai", "future", "mystery"], "A replicant hunter uncovers a secret that could change society."],
    ["exmachina", "Ex Machina", 2014, ["Sci-Fi", "Thriller"], ["ai", "robot", "twist"], "A programmer tests whether a humanoid AI is truly conscious."],
    ["matrix", "The Matrix", 1999, ["Sci-Fi", "Action"], ["ai", "simulation", "twist", "fight"], "A hacker learns reality is a simulation run by machines."],
    ["edgeoftomorrow", "Edge of Tomorrow", 2014, ["Sci-Fi", "Action"], ["aliens", "time", "loop", "war"], "A soldier relives the same alien battle every day."],
    ["gonegirl", "Gone Girl", 2014, ["Thriller", "Mystery"], ["marriage", "twist", "crime"], "A husband becomes the prime suspect when his wife disappears."],
    ["prisoners", "Prisoners", 2013, ["Thriller", "Crime"], ["kidnapping", "mystery", "dark"], "A desperate father takes the law into his own hands."],
    ["se7en", "Se7en", 1995, ["Thriller", "Crime"], ["detective", "dark", "serial killer"], "Two detectives hunt a killer inspired by the seven deadly sins."],
    ["zodiac", "Zodiac", 2007, ["Thriller", "Mystery"], ["detective", "true story", "puzzle"], "A cartoonist becomes obsessed with an unsolved serial killer case."],
    ["shutterisland", "Shutter Island", 2010, ["Thriller", "Mystery"], ["twist", "island", "puzzle", "dark"], "A marshal investigates a disappearance at an island asylum."],
    ["knivesout", "Knives Out", 2019, ["Mystery", "Comedy"], ["detective", "family", "puzzle"], "A detective untangles a wealthy family's murder mystery."],
    ["lalaland", "La La Land", 2016, ["Romance", "Drama"], ["music", "dreams", "love"], "A jazz pianist and an actress fall in love while chasing their dreams."],
    ["notebook", "The Notebook", 2004, ["Romance", "Drama"], ["love", "memory", "tearjerker"], "An old man reads a love story to a woman with dementia."],
    ["pride", "Pride & Prejudice", 2005, ["Romance", "Drama"], ["love", "classic", "family"], "Elizabeth Bennet clashes with the proud Mr. Darcy."],
    ["abouttime", "About Time", 2013, ["Romance", "Comedy"], ["love", "time", "family", "feel good"], "A young man who can time travel tries to win the girl of his dreams."],
    ["beforesunrise", "Before Sunrise", 1995, ["Romance", "Drama"], ["love", "travel", "conversation"], "Two strangers spend one night talking in Vienna."],
    ["titanic", "Titanic", 1997, ["Romance", "Drama"], ["love", "ship", "tearjerker", "epic"], "A romance blooms aboard the doomed ocean liner."],
    ["grandbudapest", "The Grand Budapest Hotel", 2014, ["Comedy", "Adventure"], ["quirky", "hotel", "feel good"], "A legendary concierge is framed for murder."],
    ["paddington", "Paddington 2", 2017, ["Comedy", "Family"], ["feel good", "bear", "kindness"], "A polite bear is wrongly jailed and must clear his name."],
    ["superbad", "Superbad", 2007, ["Comedy"], ["friendship", "party", "teen"], "Two best friends try to make the most of one wild night."],
    ["gamenight", "Game Night", 2018, ["Comedy", "Mystery"], ["party", "puzzle", "crime"], "A friendly game night turns into a real kidnapping."],
    ["spiritedaway", "Spirited Away", 2001, ["Animation", "Fantasy"], ["spirits", "magic", "coming of age"], "A girl must free her parents from a world of spirits."],
    ["toystory", "Toy Story", 1995, ["Animation", "Family"], ["toys", "friendship", "feel good"], "A cowboy doll feels replaced by a flashy space ranger toy."],
    ["up", "Up", 2009, ["Animation", "Family"], ["adventure", "balloons", "feel good", "tearjerker"], "A widower flies his house to South America with balloons."],
    ["coco", "Coco", 2017, ["Animation", "Family"], ["music", "family", "afterlife"], "A boy who loves music journeys into the Land of the Dead."],
    ["spiderverse", "Spider-Man: Into the Spider-Verse", 2018, ["Animation", "Action"], ["superhero", "multiverse", "coming of age"], "A teen becomes Spider-Man and meets heroes from other worlds."],
    ["madmax", "Mad Max: Fury Road", 2015, ["Action", "Adventure"], ["desert", "chase", "survival"], "A drifter and a rebel flee a tyrant across the wasteland."],
    ["johnwick", "John Wick", 2014, ["Action", "Thriller"], ["revenge", "fight", "assassin"], "A retired hitman seeks revenge on the gangsters who wronged him."],
    ["topgun", "Top Gun: Maverick", 2022, ["Action", "Drama"], ["pilots", "jets", "mission"], "A veteran pilot trains young aviators for a deadly mission."],
    ["missionimpossible", "Mission: Impossible - Fallout", 2018, ["Action", "Thriller"], ["spy", "mission", "chase", "fight"], "A spy races to stop a nuclear disaster."],
    ["getout", "Get Out", 2017, ["Horror", "Thriller"], ["twist", "social", "dark"], "A weekend with his girlfriend's family turns sinister."],
    ["quietplace", "A Quiet Place", 2018, ["Horror", "Sci-Fi"], ["monsters", "survival", "family", "silence"], "A family survives by staying silent from sound-hunting creatures."],
    ["hereditary", "Hereditary", 2018, ["Horror", "Drama"], ["family", "dark", "grief"], "A grieving family uncovers terrifying secrets."],
    ["lifeofpi", "Life of Pi", 2012, ["Adventure", "Drama"], ["survival", "ocean", "stranded", "tiger"], "A boy is stranded at sea on a lifeboat with a tiger."],
    ["castaway", "Cast Away", 2000, ["Adventure", "Drama"], ["survival", "island", "stranded"], "A man stranded on a deserted island fights to stay alive."],
    ["jurassicpark", "Jurassic Park", 1993, ["Adventure", "Sci-Fi"], ["dinosaurs", "island", "survival"], "Cloned dinosaurs escape at a island theme park."],
  ].map(([id, title, year, genres, keywords, synopsis], i) => ({
    id, title, year, genres, keywords, synopsis,
    addedDaysAgo: (i * 13) % 90, // when it arrived in the catalogue (used for freshness)
  }));

  // Groups of viewers with similar taste. Some cross genre lines on purpose
  // (e.g. "mind benders" love twists in sci-fi AND thrillers) - that's what
  // collaborative filtering can learn and genres alone can't.
  const TASTE_GROUPS = {
    spaceExplorers: ["interstellar", "martian", "gravity", "dune", "arrival", "lifeofpi", "castaway", "edgeoftomorrow"],
    mindBenders: ["inception", "shutterisland", "exmachina", "arrival", "prisoners", "zodiac", "gonegirl", "matrix", "getout"],
    feelGood: ["paddington", "grandbudapest", "abouttime", "up", "coco", "lalaland", "toystory", "knivesout"],
    adrenaline: ["madmax", "johnwick", "topgun", "missionimpossible", "edgeoftomorrow", "matrix", "jurassicpark", "spiderverse"],
    romantics: ["notebook", "pride", "beforesunrise", "titanic", "abouttime", "lalaland", "coco"],
    scareLovers: ["getout", "quietplace", "hereditary", "se7en", "prisoners", "shutterisland"],
    animationFans: ["spiritedaway", "toystory", "up", "coco", "spiderverse", "paddington"],
  };

  // Demo viewers (U-104 and U-219 match the examples on slide 4).
  const PERSONAS = {
    "U-104": {
      label: "U-104", icon: "🧠", blurb: "Finishes clever sci-fi thrillers, skips romance",
      history: [
        ["exmachina", "complete", 9], ["inception", "like", 6], ["arrival", "complete", 4],
        ["notebook", "skip", 3], ["shutterisland", "complete", 2],
      ],
      searches: [],
    },
    "U-219": {
      label: "U-219", icon: "🚀", blurb: "Searched \"space survival\", liked The Martian",
      history: [["martian", "like", 5], ["lifeofpi", "complete", 3], ["toystory", "partial", 2]],
      searches: ["space survival"],
    },
    "U-512": {
      label: "U-512", icon: "😊", blurb: "Loves feel-good comedies and animation",
      history: [["paddington", "like", 6], ["up", "complete", 4], ["grandbudapest", "complete", 2], ["se7en", "dislike", 1]],
      searches: [],
    },
    new: { label: "New viewer", icon: "👋", blurb: "No history yet: cold start", history: [], searches: [] },
  };

  function seededRandom(seed) {
    return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  }

  // Fill the engine with 80 background viewers + the demo personas.
  function loadDemoData(engine, now = Date.now()) {
    const DAY = 86_400_000;
    const random = seededRandom(7);
    const groups = Object.values(TASTE_GROUPS);
    const allIds = TITLES.map((t) => t.id);

    for (let u = 0; u < 80; u++) {
      const userId = `viewer-${u}`;
      const main = groups[u % groups.length];
      const second = random() < 0.3 ? groups[Math.floor(random() * groups.length)] : [];
      const favourites = new Set([...main, ...second.slice(0, 3)]);
      for (const id of allIds) {
        const ts = now - random() * 60 * DAY;
        if (favourites.has(id)) {
          if (random() < 0.7) engine.logEvent(userId, id, random() < 0.6 ? "complete" : "like", ts);
        } else if (random() < 0.08) {
          engine.logEvent(userId, id, random() < 0.6 ? "skip" : "partial", ts);
        }
      }
    }

    for (const [userId, p] of Object.entries(PERSONAS)) {
      p.history.forEach(([id, type, daysAgo]) => engine.logEvent(userId, id, type, now - daysAgo * DAY));
      p.searches.forEach((q) => engine.logSearch(userId, q, now - DAY));
    }
  }

  const api = { TITLES, PERSONAS, TASTE_GROUPS, loadDemoData };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ReelMindData = api;
})(typeof window !== "undefined" ? window : globalThis);
