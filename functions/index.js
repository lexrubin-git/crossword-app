const functions = require("firebase-functions");
const express   = require("express");
const path      = require("path");

const app = express();

// ── Middleware ─────────────────────────────────────
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Firebase config endpoint ───────────────────────
// Reads from Firebase environment config (set via firebase functions:config:set)
app.get("/api/config", (req, res) => {
  const cfg = functions.config();
res.json({
    apiKey:            cfg.app.api_key,
    authDomain:        cfg.app.auth_domain,
    databaseURL:       cfg.app.database_url,
    projectId:         cfg.app.project_id,
    storageBucket:     cfg.app.storage_bucket,
    messagingSenderId: cfg.app.messaging_sender_id,
    appId:             cfg.app.app_id,
});
});

// ── Lobby routes ───────────────────────────────────
const lobbies = {};

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (lobbies[code]);
  return code;
}

function generatePlayerId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// Create lobby
app.post("/api/lobbies", (req, res) => {
  const { hostName, hostColor } = req.body;
  if (!hostName?.trim()) return res.status(400).json({ error: "hostName is required" });

  const code     = generateCode();
  const playerId = generatePlayerId();

  lobbies[code] = {
    code,
    hostId:   playerId,
    status:   "waiting",
    mode:     "together",
    createdAt: Date.now(),
    players: {
      [playerId]: {
        name:     hostName.trim(),
        color:    hostColor || "#e05151",
        avatar:   "",
        isHost:   true,
        inGame:   false,
        joinedAt: Date.now(),
      },
    },
    votes: {},
    chat:  [],
    gameSettings: {
      puzzleId:         null,
      startedAt:        null,
      gameEnded:        false,
      autocheckEnabled: false,
    },
  };

  res.status(201).json({ lobby: lobbies[code], playerId, code });
});

// Get lobby
app.get("/api/lobbies/:code", (req, res) => {
  const lobby = lobbies[req.params.code?.toUpperCase()];
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  res.json(lobby);
});

// Join lobby
app.post("/api/lobbies/:code/join", (req, res) => {
  const lobby = lobbies[req.params.code?.toUpperCase()];
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });

  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name is required" });

  const playerId = generatePlayerId();
  lobby.players[playerId] = {
    name:     name.trim(),
    color:    color || "#3b8fd4",
    avatar:   "",
    isHost:   false,
    inGame:   false,
    joinedAt: Date.now(),
  };

  res.status(201).json({ lobby, playerId });
});

// Remove player
app.delete("/api/lobbies/:code/players/:playerId", (req, res) => {
  const lobby = lobbies[req.params.code?.toUpperCase()];
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });

  delete lobby.players[req.params.playerId];
  delete lobby.votes[req.params.playerId];
  res.json(lobby);
});

// Update player
app.patch("/api/lobbies/:code/players/:playerId", (req, res) => {
  const lobby = lobbies[req.params.code?.toUpperCase()];
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });

  const player = lobby.players[req.params.playerId];
  if (!player) return res.status(404).json({ error: "Player not found" });

  const { name, color, avatar, inGame } = req.body;
  if (name   !== undefined) player.name   = name;
  if (color  !== undefined) player.color  = color;
  if (avatar !== undefined) player.avatar = avatar;
  if (inGame !== undefined) player.inGame = inGame;

  res.json(lobby);
});

// Set game mode
app.patch("/api/lobbies/:code/mode", (req, res) => {
  const lobby = lobbies[req.params.code?.toUpperCase()];
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  lobby.mode = req.body.mode;
  res.json(lobby);
});

// Cast vote
app.post("/api/lobbies/:code/votes", (req, res) => {
  const lobby = lobbies[req.params.code?.toUpperCase()];
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  lobby.votes[req.body.playerId] = req.body.puzzleId;
  res.json(lobby);
});

// Remove vote
app.delete("/api/lobbies/:code/votes/:playerId", (req, res) => {
  const lobby = lobbies[req.params.code?.toUpperCase()];
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  delete lobby.votes[req.params.playerId];
  res.json(lobby);
});

// Transfer host
app.patch("/api/lobbies/:code/host", (req, res) => {
  const lobby = lobbies[req.params.code?.toUpperCase()];
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });

  const { newHostId } = req.body;
  if (lobby.players[lobby.hostId]) lobby.players[lobby.hostId].isHost = false;
  lobby.hostId = newHostId;
  if (lobby.players[newHostId]) lobby.players[newHostId].isHost = true;
  res.json(lobby);
});

// Lobby chat
app.post("/api/lobbies/:code/chat", (req, res) => {
  const lobby = lobbies[req.params.code?.toUpperCase()];
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });

  const { playerId, text } = req.body;
  const player = lobby.players[playerId] || {};
  const msg = { playerId, name: player.name || "Player", color: player.color || "#e8e8e8", text: text.trim(), ts: Date.now() };
  lobby.chat.push(msg);
  res.status(201).json(msg);
});

// Start game
app.post("/api/lobbies/:code/start", (req, res) => {
  const lobby = lobbies[req.params.code?.toUpperCase()];
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  lobby.status = "active";
  lobby.gameSettings.startedAt = Date.now();
  res.json({ lobby });
});

// ── Puzzle routes ──────────────────────────────────
const PUZZLES = [
  {
    id: "mini_001",
    title: "Mini Classic",
    difficulty: "easy",
    size: 5,
    grid: [
      ["C","R","O","S","S"],
      ["H",".","N",".","T"],
      ["E","A","S","T","A"],
      ["S",".","E",".","R"],
      ["S","T","R","E","S"],
    ],
    numbers: [
      [1,2,3,0,4],
      [5,0,0,0,0],
      [0,6,0,0,0],
      [0,0,0,0,0],
      [7,0,0,0,0],
    ],
    clues: {
      across: [
        { num: 1, clue: "Angry" },
        { num: 4, clue: "Rising agent for bread" },
        { num: 5, clue: "Hunt for" },
        { num: 6, clue: "Direction of sunrise" },
        { num: 7, clue: "Pressure or tension" },
      ],
      down: [
        { num: 1, clue: "Checkers piece" },
        { num: 2, clue: "Flat-bottomed boat" },
        { num: 3, clue: "Notes, as in music" },
        { num: 4, clue: "Celestial body" },
      ],
    },
  },
];

app.get("/api/puzzles", (req, res) => res.json({ puzzles: PUZZLES }));
app.get("/api/puzzles/:id", (req, res) => {
  const puzzle = PUZZLES.find((p) => p.id === req.params.id);
  if (!puzzle) return res.status(404).json({ error: "Puzzle not found" });
  res.json(puzzle);
});

// ── Game state route ───────────────────────────────
app.get("/api/games/:code/state", (req, res) => {
  const lobby = lobbies[req.params.code?.toUpperCase()];
  if (!lobby) return res.status(404).json({ error: "Game not found" });
  res.json({ puzzle: PUZZLES[0], players: lobby.players, scores: {}, mode: lobby.mode });
});

app.post("/api/games/:code/forfeit", (req, res) => {
  const lobby = lobbies[req.params.code?.toUpperCase()];
  if (!lobby) return res.status(404).json({ error: "Game not found" });
  lobby.gameSettings.gameEnded = true;
  res.json({ success: true });
});

// ── Export as Firebase Function ────────────────────
exports.api = functions.https.onRequest(app);
