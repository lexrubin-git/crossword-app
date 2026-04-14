/**
 * lobby.routes.js — Express router for /api/lobbies/*
 */

import { Router } from 'express';
import * as LobbyController from '../controllers/lobby.controller.js';

const router = Router();

// CRUD
router.post ('/',                               LobbyController.createLobby);
router.get  ('/:code',                          LobbyController.getLobby);
router.post ('/:code/join',                     LobbyController.joinLobby);

// Player management
router.patch ('/:code/players/:playerId',       LobbyController.updatePlayer);
router.delete('/:code/players/:playerId',       LobbyController.removePlayer);

// Game mode
router.patch ('/:code/mode',                    LobbyController.setMode);

// Voting
router.post  ('/:code/votes',                   LobbyController.castVote);
router.delete('/:code/votes/:playerId',         LobbyController.removeVote);

// Host
router.patch ('/:code/host',                    LobbyController.transferHost);

// Chat
router.post  ('/:code/chat',                    LobbyController.sendChat);

// Game start
router.post  ('/:code/start',                   LobbyController.startGame);

export default router;
