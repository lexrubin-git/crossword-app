/**
 * puzzle.routes.js — Express router for /api/puzzles/*
 */

import { Router } from 'express';
import * as PuzzleController from '../controllers/puzzle.controller.js';

const router = Router();

router.get('/',    PuzzleController.listPuzzles);
router.get('/:id', PuzzleController.getPuzzle);

export default router;
