/**
 * game.routes.js — Express router for /api/games/*
 */

import { Router } from 'express';
import * as GameController from '../controllers/game.controller.js';

const router = Router();

router.get   ('/:code/state',              GameController.getState);
router.post  ('/:code/cells',              GameController.submitCell);
router.post  ('/:code/check',              GameController.checkCells);
router.post  ('/:code/reveal',             GameController.revealCells);
router.post  ('/:code/chat',               GameController.sendChat);
router.patch ('/:code/players/:playerId',  GameController.updatePlayer);
router.post  ('/:code/forfeit',            GameController.forfeitGame);

export default router;
