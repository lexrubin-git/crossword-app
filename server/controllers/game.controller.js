/**
 * game.controller.js (server) — Express route handlers
 * for in-game API endpoints.
 */

import * as GameModel from '../models/game.model.js';

// ── GET /api/games/:code/state ─────────────────────
/** Return full game state (puzzle without solution). */
export function getState(req, res, next) {
  try {
    const game = GameModel.getGame(req.params.code);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    // Strip solution before sending to client
    const { solution: _s, ...puzzlePublic } = game.puzzle || {};
    res.json({ ...game, puzzle: puzzlePublic });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/games/:code/cells ────────────────────
/** Submit a letter to a cell. */
export function submitCell(req, res, next) {
  try {
    const { row, col, letter, playerId } = req.body;

    if (row == null || col == null) {
      return res.status(400).json({ error: 'row and col are required' });
    }
    if (typeof letter !== 'string') {
      return res.status(400).json({ error: 'letter must be a string' });
    }

    const sanitisedLetter = letter.trim().toUpperCase().slice(0, 1);
    const result = GameModel.setCell(
      req.params.code,
      Number(row),
      Number(col),
      sanitisedLetter,
      playerId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ── POST /api/games/:code/check ────────────────────
/** Check letters against the solution (letter | word | grid). */
export function checkCells(req, res, next) {
  try {
    const { scope, anchor } = req.body;
    if (!['letter', 'word', 'grid'].includes(scope)) {
      return res.status(400).json({ error: 'scope must be letter, word, or grid' });
    }
    const result = GameModel.checkCells(req.params.code, scope, anchor);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ── POST /api/games/:code/reveal ───────────────────
/** Reveal the solution for a letter, word, or entire grid. */
export function revealCells(req, res, next) {
  try {
    const { scope, anchor } = req.body;
    if (!['letter', 'word', 'grid'].includes(scope)) {
      return res.status(400).json({ error: 'scope must be letter, word, or grid' });
    }
    const result = GameModel.revealCells(req.params.code, scope, anchor);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ── POST /api/games/:code/chat ─────────────────────
/** Send an in-game chat message. */
export function sendChat(req, res, next) {
  try {
    const { playerId, text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });

    const game = GameModel.getGame(req.params.code);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const player = game.players[playerId] || {};
    const msg = GameModel.addChatMessage(req.params.code, {
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

// ── PATCH /api/games/:code/players/:playerId ───────
/** Update a player's name and/or color mid-game. */
export function updatePlayer(req, res, next) {
  try {
    const { code, playerId } = req.params;
    const { name, color }    = req.body;
    const game = GameModel.updatePlayer(code, playerId, { name, color });
    res.json(game);
  } catch (err) {
    next(err);
  }
}

// ── POST /api/games/:code/forfeit ──────────────────
/** End the game early (forfeit). */
export function forfeitGame(req, res, next) {
  try {
    const game = GameModel.forfeitGame(req.params.code);
    res.json(game);
  } catch (err) {
    next(err);
  }
}
