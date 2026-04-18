/**
 * server.js — Express application entry point.
 *
 * Reads Firebase config from .env and exposes it via
 * a single safe endpoint so the frontend never has keys
 * baked into committed source files.
 */

import express from 'express';
import http    from 'http';
import path    from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

import lobbyRoutes  from './routes/lobby.routes.js';
import gameRoutes   from './routes/game.routes.js';
import puzzleRoutes from './routes/puzzle.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load .env manually (no extra dependencies needed) ─
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '../.env');
    const lines   = readFileSync(envPath, 'utf8').split('\n');
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const [key, ...rest] = trimmed.split('=');
      if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
    });
    console.log('✓ .env loaded');
  } catch {
    console.warn('⚠ No .env file found — using existing environment variables');
  }
}

loadEnv();

const app    = express();
const server = http.createServer(app);

// ── Middleware ─────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, '../public')));

// ── Firebase config endpoint ───────────────────────
// The frontend fetches this at startup instead of having
// keys hard-coded in any committed file.
app.get('/api/config', (req, res) => {
  res.json({
    apiKey:            process.env.FIREBASE_API_KEY,
    authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL:       process.env.FIREBASE_DATABASE_URL,
    projectId:         process.env.FIREBASE_PROJECT_ID,
    storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId:             process.env.FIREBASE_APP_ID,
  });
});

// ── API routes ─────────────────────────────────────
app.use('/api/lobbies', lobbyRoutes);
app.use('/api/games',   gameRoutes);
app.use('/api/puzzles', puzzleRoutes);

// ── Root → home page ───────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/index.html'));
});
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/index.html'));
});
app.get('/lobby.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/lobby.html'));
});
app.get('/game.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/game.html'));
});

// ── Global error handler ───────────────────────────
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✓ Crossword server running at http://localhost:${PORT}`);
});

export default app;
