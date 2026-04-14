/**
 * lobby.model.js — In-memory Lobby data model.
 *
 * In production this would be backed by Firebase Realtime
 * Database or a SQL/NoSQL store.  For demonstration the
 * store is an in-process Map that resets on server restart.
 *
 * Shape of a lobby document:
 * {
 *   code:      string,          // 4-char uppercase code
 *   hostId:    string,          // playerId of current host
 *   status:    'waiting'|'active'|'finished',
 *   mode:      'together'|'versus',
 *   createdAt: number,          // epoch ms
 *   players: {
 *     [playerId]: {
 *       name:   string,
 *       color:  string,         // hex
 *       avatar: string,         // base64 data-URL or ''
 *       isHost: boolean,
 *       inGame: boolean,
 *       joinedAt: number,
 *     }
 *   },
 *   votes: {
 *     [playerId]: string        // puzzleId
 *   },
 *   chat: Array<{
 *     playerId: string,
 *     name:     string,
 *     color:    string,
 *     text:     string,
 *     ts:       number,
 *   }>,
 *   gameSettings: {
 *     puzzleId:        string,
 *     startedAt:       number,
 *     gameEnded:       boolean,
 *     autocheckEnabled:boolean,
 *   }
 * }
 */

const store = new Map();   // code → lobbyDoc

// ── ID helpers ─────────────────────────────────────

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (store.has(code));
  return code;
}

function generatePlayerId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── CRUD operations ────────────────────────────────

/**
 * Create a new lobby and add the host as the first player.
 * @returns {{ lobby, playerId }}
 */
export function createLobby({ hostName, hostColor }) {
  const code     = generateCode();
  const playerId = generatePlayerId();

  const lobby = {
    code,
    hostId:   playerId,
    status:   'waiting',
    mode:     'together',
    createdAt: Date.now(),
    players:  {},
    votes:    {},
    chat:     [],
    gameSettings: {
      puzzleId:         null,
      startedAt:        null,
      gameEnded:        false,
      autocheckEnabled: false,
    },
  };

  lobby.players[playerId] = {
    name:     hostName  || 'Host',
    color:    hostColor || '#e05151',
    avatar:   '',
    isHost:   true,
    inGame:   false,
    joinedAt: Date.now(),
  };

  store.set(code, lobby);
  return { lobby: sanitize(lobby), playerId };
}

/**
 * Retrieve a lobby by its 4-char code.
 * @returns {object|null}
 */
export function getLobby(code) {
  const lobby = store.get(code?.toUpperCase());
  return lobby ? sanitize(lobby) : null;
}

/**
 * Add a player to a lobby.
 * @returns {{ lobby, playerId }}
 * @throws if lobby is full (>8) or color is already taken
 */
export function joinLobby(code, { name, color }) {
  const lobby = store.get(code?.toUpperCase());
  if (!lobby)                        throw Object.assign(new Error('Lobby not found'), { status: 404 });
  if (Object.keys(lobby.players).length >= 8)
    throw Object.assign(new Error('Lobby is full'), { status: 409 });

  const takenColors = Object.values(lobby.players).map((p) => p.color);
  if (takenColors.includes(color))   throw Object.assign(new Error('Color taken'), { status: 409 });

  const playerId = generatePlayerId();
  lobby.players[playerId] = {
    name:     name  || 'Player',
    color:    color || '#3b8fd4',
    avatar:   '',
    isHost:   false,
    inGame:   false,
    joinedAt: Date.now(),
  };

  return { lobby: sanitize(lobby), playerId };
}

/**
 * Remove a player from a lobby.  If the removed player
 * was the host, automatically transfer host to the next
 * joined player.
 */
export function removePlayer(code, playerId) {
  const lobby = store.get(code?.toUpperCase());
  if (!lobby) throw Object.assign(new Error('Lobby not found'), { status: 404 });

  delete lobby.players[playerId];
  delete lobby.votes[playerId];

  // Transfer host if needed
  if (lobby.hostId === playerId) {
    const remaining = Object.keys(lobby.players);
    if (remaining.length > 0) {
      const newHostId = remaining[0];
      lobby.hostId = newHostId;
      lobby.players[newHostId].isHost = true;
    }
  }

  // Clean up empty lobbies
  if (Object.keys(lobby.players).length === 0) {
    store.delete(code.toUpperCase());
  }

  return sanitize(lobby);
}

/**
 * Update a player's name and/or color.
 */
export function updatePlayer(code, playerId, { name, color, avatar, inGame }) {
  const lobby = store.get(code?.toUpperCase());
  if (!lobby) throw Object.assign(new Error('Lobby not found'), { status: 404 });
  const player = lobby.players[playerId];
  if (!player) throw Object.assign(new Error('Player not found'), { status: 404 });

  if (name   !== undefined) player.name   = name;
  if (color  !== undefined) player.color  = color;
  if (avatar !== undefined) player.avatar = avatar;
  if (inGame !== undefined) player.inGame = inGame;

  return sanitize(lobby);
}

/**
 * Change the game mode ('together' | 'versus').
 * Only the host should call this.
 */
export function setMode(code, mode) {
  const lobby = store.get(code?.toUpperCase());
  if (!lobby) throw Object.assign(new Error('Lobby not found'), { status: 404 });
  if (!['together', 'versus'].includes(mode))
    throw Object.assign(new Error('Invalid mode'), { status: 400 });
  lobby.mode = mode;
  return sanitize(lobby);
}

/**
 * Cast or update a player's puzzle vote.
 */
export function castVote(code, playerId, puzzleId) {
  const lobby = store.get(code?.toUpperCase());
  if (!lobby) throw Object.assign(new Error('Lobby not found'), { status: 404 });
  lobby.votes[playerId] = puzzleId;
  return sanitize(lobby);
}

/**
 * Remove a player's vote.
 */
export function removeVote(code, playerId) {
  const lobby = store.get(code?.toUpperCase());
  if (!lobby) throw Object.assign(new Error('Lobby not found'), { status: 404 });
  delete lobby.votes[playerId];
  return sanitize(lobby);
}

/**
 * Transfer the host role to another player.
 */
export function transferHost(code, newHostId) {
  const lobby = store.get(code?.toUpperCase());
  if (!lobby) throw Object.assign(new Error('Lobby not found'), { status: 404 });
  if (!lobby.players[newHostId]) throw Object.assign(new Error('Player not found'), { status: 404 });

  // Remove crown from old host
  if (lobby.players[lobby.hostId]) lobby.players[lobby.hostId].isHost = false;
  lobby.hostId = newHostId;
  lobby.players[newHostId].isHost = true;
  return sanitize(lobby);
}

/**
 * Append a chat message.
 */
export function addChatMessage(code, { playerId, name, color, text }) {
  const lobby = store.get(code?.toUpperCase());
  if (!lobby) throw Object.assign(new Error('Lobby not found'), { status: 404 });
  const msg = { playerId, name, color, text, ts: Date.now() };
  lobby.chat.push(msg);
  // Keep only the most recent 200 messages
  if (lobby.chat.length > 200) lobby.chat.shift();
  return msg;
}

/**
 * Transition a lobby to 'active' (game started).
 */
export function startGame(code, { puzzleId }) {
  const lobby = store.get(code?.toUpperCase());
  if (!lobby) throw Object.assign(new Error('Lobby not found'), { status: 404 });
  lobby.status = 'active';
  lobby.gameSettings.puzzleId  = puzzleId;
  lobby.gameSettings.startedAt = Date.now();
  lobby.gameSettings.gameEnded = false;
  return sanitize(lobby);
}

/**
 * Update arbitrary gameSettings fields.
 */
export function updateGameSettings(code, fields) {
  const lobby = store.get(code?.toUpperCase());
  if (!lobby) throw Object.assign(new Error('Lobby not found'), { status: 404 });
  Object.assign(lobby.gameSettings, fields);
  return sanitize(lobby);
}

// ── Internal helpers ───────────────────────────────

/** Strip internal reference, return plain object copy. */
function sanitize(lobby) {
  return JSON.parse(JSON.stringify(lobby));
}
