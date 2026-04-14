/**
 * api.service.js — Centralised fetch wrapper for all
 * server API calls.  Every controller should import
 * from here rather than calling fetch() directly.
 */

const BASE = '/api';

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(BASE + path, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── Lobby ──────────────────────────────────────────

/** Create a new lobby. Returns { code, lobbyId } */
export const createLobby = (hostName, hostColor) =>
  request('POST', '/lobbies', { hostName, hostColor });

/** Fetch lobby state by code. Returns full lobby object. */
export const getLobby = (code) =>
  request('GET', `/lobbies/${code}`);

/** Join an existing lobby. Returns { playerId } */
export const joinLobby = (code, name, color) =>
  request('POST', `/lobbies/${code}/join`, { name, color });

/** Leave the lobby (remove player). */
export const leaveLobby = (code, playerId) =>
  request('DELETE', `/lobbies/${code}/players/${playerId}`);

/** Update game mode ('together' | 'versus') — host only. */
export const setGameMode = (code, mode) =>
  request('PATCH', `/lobbies/${code}/mode`, { mode });

/** Cast or update a vote for a puzzle. */
export const castVote = (code, playerId, puzzleId) =>
  request('POST', `/lobbies/${code}/votes`, { playerId, puzzleId });

/** Remove own vote. */
export const removeVote = (code, playerId) =>
  request('DELETE', `/lobbies/${code}/votes/${playerId}`);

/** Kick a player — host only. */
export const kickPlayer = (code, targetId) =>
  request('DELETE', `/lobbies/${code}/players/${targetId}?kicked=1`);

/** Transfer host role. */
export const transferHost = (code, newHostId) =>
  request('PATCH', `/lobbies/${code}/host`, { newHostId });

/** Start the game. Returns the started game state. */
export const startGame = (code, puzzleId) =>
  request('POST', `/lobbies/${code}/start`, { puzzleId });

// ── Puzzles ────────────────────────────────────────

/** List available puzzles (optionally filtered). */
export const listPuzzles = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request('GET', `/puzzles${qs ? '?' + qs : ''}`);
};

/** Get a single puzzle by ID. */
export const getPuzzle = (id) =>
  request('GET', `/puzzles/${id}`);

// ── Game ───────────────────────────────────────────

/** Submit a letter to a cell. Returns updated cell state. */
export const submitCell = (code, row, col, letter, playerId) =>
  request('POST', `/games/${code}/cells`, { row, col, letter, playerId });

/** Check a letter / word / grid. Returns { results } */
export const checkGrid = (code, scope, anchor, playerId) =>
  request('POST', `/games/${code}/check`, { scope, anchor, playerId });

/** Reveal a letter / word / entire grid. */
export const revealGrid = (code, scope, anchor) =>
  request('POST', `/games/${code}/reveal`, { scope, anchor });

/** Send a chat message. */
export const sendChatMessage = (code, playerId, text) =>
  request('POST', `/games/${code}/chat`, { playerId, text });

/** Update player profile mid-game. */
export const updatePlayerProfile = (code, playerId, name, color) =>
  request('PATCH', `/games/${code}/players/${playerId}`, { name, color });

/** Mark game as ended (forfeit). */
export const forfeitGame = (code) =>
  request('POST', `/games/${code}/forfeit`);
