/**
 * lobby.controller.js (server) — Express route handlers
 * for all lobby-related API endpoints.
 *
 * Each handler follows the pattern:
 *   validate → call model → respond
 */

import * as LobbyModel  from '../models/lobby.model.js';
import * as GameModel   from '../models/game.model.js';
import * as PuzzleModel from '../models/puzzle.model.js';

// ── POST /api/lobbies ──────────────────────────────
/** Create a new lobby. */
export function createLobby(req, res, next) {
  try {
    const { hostName, hostColor } = req.body;
    if (!hostName?.trim()) {
      return res.status(400).json({ error: 'hostName is required' });
    }
    const result = LobbyModel.createLobby({ hostName: hostName.trim(), hostColor });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

// ── GET /api/lobbies/:code ─────────────────────────
/** Get full lobby state. */
export function getLobby(req, res, next) {
  try {
    const lobby = LobbyModel.getLobby(req.params.code);
    if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
    res.json(lobby);
  } catch (err) {
    next(err);
  }
}

// ── POST /api/lobbies/:code/join ───────────────────
/** Join an existing lobby. */
export function joinLobby(req, res, next) {
  try {
    const { name, color } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const result = LobbyModel.joinLobby(req.params.code, {
      name:  name.trim(),
      color: color || '#3b8fd4',
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api/lobbies/:code/players/:playerId ────
/** Remove (leave or kick) a player from a lobby. */
export function removePlayer(req, res, next) {
  try {
    const { code, playerId } = req.params;
    const lobby = LobbyModel.removePlayer(code, playerId);
    res.json(lobby);
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/lobbies/:code/players/:playerId ─────
/** Update a player's name, color, or inGame status. */
export function updatePlayer(req, res, next) {
  try {
    const { code, playerId } = req.params;
    const { name, color, avatar, inGame } = req.body;
    const lobby = LobbyModel.updatePlayer(code, playerId, { name, color, avatar, inGame });
    res.json(lobby);
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/lobbies/:code/mode ──────────────────
/** Change game mode (host only — caller must verify). */
export function setMode(req, res, next) {
  try {
    const { mode } = req.body;
    const lobby = LobbyModel.setMode(req.params.code, mode);
    res.json(lobby);
  } catch (err) {
    next(err);
  }
}

// ── POST /api/lobbies/:code/votes ──────────────────
/** Cast a vote for a puzzle. */
export function castVote(req, res, next) {
  try {
    const { playerId, puzzleId } = req.body;
    if (!playerId || !puzzleId) {
      return res.status(400).json({ error: 'playerId and puzzleId are required' });
    }
    const lobby = LobbyModel.castVote(req.params.code, playerId, puzzleId);
    res.json(lobby);
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api/lobbies/:code/votes/:playerId ──────
/** Remove a player's vote. */
export function removeVote(req, res, next) {
  try {
    const { code, playerId } = req.params;
    const lobby = LobbyModel.removeVote(code, playerId);
    res.json(lobby);
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/lobbies/:code/host ──────────────────
/** Transfer host role. */
export function transferHost(req, res, next) {
  try {
    const { newHostId } = req.body;
    if (!newHostId) return res.status(400).json({ error: 'newHostId is required' });
    const lobby = LobbyModel.transferHost(req.params.code, newHostId);
    res.json(lobby);
  } catch (err) {
    next(err);
  }
}

// ── POST /api/lobbies/:code/chat ───────────────────
/** Send a chat message in the lobby. */
export function sendChat(req, res, next) {
  try {
    const { playerId, text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });

    const lobby = LobbyModel.getLobby(req.params.code);
    if (!lobby) return res.status(404).json({ error: 'Lobby not found' });

    const player = lobby.players[playerId] || {};
    const msg = LobbyModel.addChatMessage(req.params.code, {
      playerId,
      name:  player.name  || 'Player',
      color: player.color || '#e8e8e8',
      text:  text.trim(),
    });
    res.status(201).json(msg);
  } catch (err) {
    next(err);
  }
}

// ── POST /api/lobbies/:code/start ──────────────────
/** Start the game.  Creates a Game record and returns it. */
export function startGame(req, res, next) {
  try {
    const { code }     = req.params;
    const { puzzleId } = req.body;

    if (!puzzleId) return res.status(400).json({ error: 'puzzleId is required' });

    const puzzle = PuzzleModel.getPuzzle(puzzleId);
    if (!puzzle) return res.status(404).json({ error: 'Puzzle not found' });

    // Mark lobby as active
    const lobby = LobbyModel.startGame(code, { puzzleId });
    if (!lobby)  return res.status(404).json({ error: 'Lobby not found' });

    // Create the game record
    const game = GameModel.createGame(code, puzzle, lobby.players, lobby.mode);

    res.status(201).json({
      lobby,
      game: {
        ...game,
        puzzle: PuzzleModel.getPuzzleSummary(puzzleId), // no solution in response
      },
    });
  } catch (err) {
    next(err);
  }
}
