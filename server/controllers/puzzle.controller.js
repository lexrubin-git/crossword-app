/**
 * puzzle.controller.js (server) — Express route handlers
 * for the puzzle catalogue API.
 */

import * as PuzzleModel from '../models/puzzle.model.js';

// ── GET /api/puzzles ───────────────────────────────
/** List puzzles, optionally filtered by difficulty and size. */
export function listPuzzles(req, res, next) {
  try {
    const { difficulty, size } = req.query;
    const puzzles = PuzzleModel.listPuzzles({ difficulty, size });
    res.json({ puzzles });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/puzzles/:id ───────────────────────────
/** Get a puzzle summary (no solution) by ID. */
export function getPuzzle(req, res, next) {
  try {
    const summary = PuzzleModel.getPuzzleSummary(req.params.id);
    if (!summary) return res.status(404).json({ error: 'Puzzle not found' });
    res.json(summary);
  } catch (err) {
    next(err);
  }
}
