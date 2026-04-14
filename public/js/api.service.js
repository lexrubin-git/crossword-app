// ── api.service.js — All Firebase + REST API interactions ──
// Controllers call these; nothing here touches the DOM.

import { state, showToast } from './state.js';

// ── Firebase shorthand ──
function fb() {
  const f = window._fb;
  if (!f) throw new Error('Firebase not ready');
  return f;
}

// ══════════════════════════════════════════════
// LOBBY API
// ══════════════════════════════════════════════

export async function createLobby(playerName, playerColor, pixelAvatarData) {
  const { db, ref, set, push, onDisconnect, serverTimestamp } = fb();
  const SAFE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  while (code.length < 4) code += SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)];

  const newRef = push(ref(db, `lobbies/${code}/players`));
  const playerId = newRef.key;

  await set(ref(db, `lobbies/${code}`), {
    host: playerId,
    createdAt: serverTimestamp(),
    status: 'waiting',
    players: {
      [playerId]: {
        name: playerName,
        colorHex: playerColor.hex,
        avatar: pixelAvatarData || null,
        vote: null,
        voteMeta: null,
        isHost: true,
        joinedAt: serverTimestamp(),
      }
    }
  });

  onDisconnect(ref(db, `lobbies/${code}/players/${playerId}`)).remove();
  return { code, playerId };
}

export async function joinLobby(code, playerName, playerColor, pixelAvatarData) {
  const { db, ref, get, set, push, onDisconnect, serverTimestamp } = fb();

  // Verify lobby exists
  const snap = await get(ref(db, `lobbies/${code}`));
  if (!snap.exists()) throw new Error('Lobby not found. Check the code.');

  const players = snap.child('players').val() || {};
  const takenHexes = new Set(Object.values(players).map(p => p.colorHex));
  const takenNames = new Set(Object.values(players).map(p => (p.name||'').trim().toLowerCase()));

  if (takenNames.has(playerName.toLowerCase())) throw new Error('name_taken');
  if (takenHexes.has(playerColor.hex)) throw new Error('color_taken');

  const newRef = push(ref(db, `lobbies/${code}/players`));
  const playerId = newRef.key;
  await set(newRef, {
    name: playerName,
    colorHex: playerColor.hex,
    avatar: pixelAvatarData || null,
    vote: null,
    isHost: false,
    joinedAt: serverTimestamp(),
  });

  onDisconnect(ref(db, `lobbies/${code}/players/${playerId}`)).remove();
  return { playerId };
}

export async function getLobbyPlayers(code) {
  const { db, ref, get } = fb();
  const snap = await get(ref(db, `lobbies/${code}/players`));
  return snap.exists() ? (snap.val() || {}) : {};
}

export async function updatePlayer(code, playerId, data) {
  const { db, ref, update } = fb();
  await update(ref(db, `lobbies/${code}/players/${playerId}`), data);
}

export async function removePlayer(code, playerId) {
  const { db, ref, remove } = fb();
  await remove(ref(db, `lobbies/${code}/players/${playerId}`));
}

export async function transferHost(code, newHostId, oldHostId) {
  const { db, ref, update } = fb();
  const updates = {};
  updates[`players/${newHostId}/isHost`] = true;
  if (oldHostId) updates[`players/${oldHostId}/isHost`] = false;
  updates['host'] = newHostId;
  await update(ref(db, `lobbies/${code}`), updates);
}

export async function setLobbyMode(code, mode) {
  const { db, ref, update } = fb();
  await update(ref(db, `lobbies/${code}`), { gameMode: mode });
}

export async function castVote(code, playerId, voteKey, voteMeta) {
  const { db, ref, update } = fb();
  await update(ref(db, `lobbies/${code}/players/${playerId}`), {
    vote: voteKey, voteMeta: voteMeta,
  });
}

export async function removeVoteFB(code, playerId) {
  const { db, ref, update } = fb();
  await update(ref(db, `lobbies/${code}/players/${playerId}`), {
    vote: null, voteMeta: null,
  });
}

export async function sendChatMessage(code, msg) {
  const { db, ref, push } = fb();
  await push(ref(db, `lobbies/${code}/chat`), msg);
}

export async function startLobbyGame(code, puzzleDateKey, gameMode) {
  const { db, ref, update, serverTimestamp } = fb();
  await update(ref(db, `lobbies/${code}`), {
    status: 'started',
    puzzleDateKey,
    startedAt: serverTimestamp(),
    gameMode,
  });
}

export async function removeLobby(code) {
  const { db, ref, remove } = fb();
  await remove(ref(db, `lobbies/${code}`));
}

export function subscribeLobby(code, callback) {
  const { db, ref, onValue } = fb();
  return onValue(ref(db, `lobbies/${code}`), callback);
}

export function subscribeChat(code, callback) {
  const { db, ref, onValue } = fb();
  return onValue(ref(db, `lobbies/${code}/chat`), callback);
}

// ══════════════════════════════════════════════
// GAME API
// ══════════════════════════════════════════════

export function pushCellToFB(code, row, col, letter, filledBy, filledColor, revealed = false) {
  const { db, ref, update } = fb();
  const key = `${row}_${col}`;
  update(ref(db, `lobbies/${code}/gameGrid/${key}`), {
    letter, filledBy, filledColor, revealed, ts: Date.now()
  }).catch(() => {});
}

export async function fetchGridSnapshot(code) {
  const { db, ref, get } = fb();
  const snap = await get(ref(db, `lobbies/${code}/gameGrid`));
  return snap.exists() ? snap : null;
}

export function startCellSyncListener(code, onAdd, onChange) {
  const { db, ref, onChildAdded, onChildChanged } = fb();
  const unsub1 = onChildAdded(ref(db, `lobbies/${code}/gameGrid`), onAdd);
  const unsub2 = onChildChanged(ref(db, `lobbies/${code}/gameGrid`), onChange);
  return () => { unsub1(); unsub2(); };
}

export function startScoreSyncListener(code, callback) {
  const { db, ref, onValue } = fb();
  return onValue(ref(db, `lobbies/${code}/scores`), callback);
}

export function pushScoreToFB(code, playerId, scoreData) {
  const { db, ref, update } = fb();
  update(ref(db, `lobbies/${code}/scores/${playerId}`), scoreData).catch(() => {});
}

export function pushAllScoresToFB(code, scoresMap) {
  const { db, ref, update } = fb();
  const updates = {};
  Object.entries(scoresMap).forEach(([id, data]) => {
    updates[`scores/${id}`] = data;
  });
  update(ref(db, `lobbies/${code}`), updates).catch(() => {});
}

export function startPlayerInfoListener(code, callback) {
  const { db, ref, onValue } = fb();
  return onValue(ref(db, `lobbies/${code}/players`), callback);
}

export function pushGameSettingFB(code, key, value) {
  const { db, ref, update } = fb();
  update(ref(db, `lobbies/${code}/gameSettings`), { [key]: value }).catch(() => {});
}

export function startGameSettingsListener(code, callback) {
  const { db, ref, onValue } = fb();
  return onValue(ref(db, `lobbies/${code}/gameSettings`), callback);
}

export function sendGameChatFB(code, msg) {
  const { db, ref, push } = fb();
  push(ref(db, `lobbies/${code}/gameChat`), msg).catch(() => {});
}

export function startGameChatListener(code, callback) {
  const { db, ref, onValue } = fb();
  return onValue(ref(db, `lobbies/${code}/gameChat`), callback);
}

export function clearGameGridFB(code) {
  const { db, ref, remove } = fb();
  remove(ref(db, `lobbies/${code}/gameGrid`)).catch(() => {});
  remove(ref(db, `lobbies/${code}/scores`)).catch(() => {});
  remove(ref(db, `lobbies/${code}/gameChat`)).catch(() => {});
  remove(ref(db, `lobbies/${code}/gameSettings`)).catch(() => {});
}

// Cursor tracking
export function pushCursorToFB(code, playerId, x, y, name, colorHex) {
  const { db, ref, update } = fb();
  update(ref(db, `lobbies/${code}/cursors/${playerId}`), { x, y, name, colorHex }).catch(() => {});
}

export function removeCursorFromFB(code, playerId) {
  const { db, ref, remove } = fb();
  remove(ref(db, `lobbies/${code}/cursors/${playerId}`)).catch(() => {});
}

export function startCursorListener(code, callback) {
  const { db, ref, onValue } = fb();
  return onValue(ref(db, `lobbies/${code}/cursors`), callback);
}

export function setupCursorDisconnect(code, playerId) {
  const { db, ref, onDisconnect } = fb();
  onDisconnect(ref(db, `lobbies/${code}/cursors/${playerId}`)).remove();
}

// Versus grid previews
export function pushVersusGridToFB(code, playerId, data) {
  const { db, ref, update } = fb();
  update(ref(db, `lobbies/${code}/versusGrids/${playerId}`), data).catch(() => {});
}

export function removeVersusGridFromFB(code, playerId) {
  const { db, ref, remove } = fb();
  remove(ref(db, `lobbies/${code}/versusGrids/${playerId}`)).catch(() => {});
}

export function startVersusGridListener(code, callback) {
  const { db, ref, onValue } = fb();
  return onValue(ref(db, `lobbies/${code}/versusGrids`), callback);
}

// Mark player in-game
export function setPlayerInGame(code, playerId, inGame) {
  const { db, ref, update } = fb();
  update(ref(db, `lobbies/${code}/players/${playerId}`), { inGame }).catch(() => {});
}

// ══════════════════════════════════════════════
// PUZZLE API (NYT archive fetch)
// ══════════════════════════════════════════════

export async function fetchNytPuzzle(dateKey) {
  const parts = dateKey.split('/');
  const year     = parts[0];
  const monthPad = parts[1].padStart(2, '0');
  const dayPad   = parts[2].padStart(2, '0');
  const month    = String(parseInt(monthPad));
  const day      = String(parseInt(dayPad));

  if (parseInt(year) > 2017 || parseInt(year) < 1976) {
    throw new Error(`The archive only covers 1976–2017. Picked year: ${year}`);
  }

  const urls = [
    `https://raw.githubusercontent.com/doshea/nyt_crosswords/master/${year}/${monthPad}/${dayPad}.json`,
    `https://raw.githubusercontent.com/doshea/nyt_crosswords/master/${year}/${month}/${day}.json`,
  ];

  let data = null, lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status} for ${url}`); continue; }
      data = await res.json();
      break;
    } catch (e) { lastErr = e; }
  }

  if (!data) throw new Error('Could not load puzzle from GitHub archive. ' + (lastErr?.message || ''));
  return data;
}

// ══════════════════════════════════════════════
// LOBBY CLEANUP
// ══════════════════════════════════════════════

export async function pruneStaleLobbies() {
  try {
    const { db, ref, get, remove } = fb();
    const snap = await get(ref(db, 'lobbies'));
    if (!snap.exists()) return;
    const lobbies = snap.val();
    const now = Date.now();
    const MAX_AGE_MS = 24 * 60 * 60 * 1000;
    const tasks = [];
    Object.entries(lobbies).forEach(([code, lobby]) => {
      if (!lobby) { tasks.push(remove(ref(db, `lobbies/${code}`))); return; }
      const playerCount = Object.keys(lobby.players || {}).length;
      const age = lobby.createdAt ? (now - lobby.createdAt) : Infinity;
      if (playerCount === 0 || age > MAX_AGE_MS) {
        tasks.push(remove(ref(db, `lobbies/${code}`)));
      }
    });
    await Promise.allSettled(tasks);
  } catch {}
}
