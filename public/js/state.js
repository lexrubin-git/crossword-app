/**
 * state.js — Shared application state and constants.
 *
 * All controllers import from here so state is never
 * duplicated across modules.
 */

// ── Player colors ──────────────────────────────────
export const PLAYER_COLORS = [
  '#e05151', '#e07c35', '#d4a017', '#4caf7d',
  '#3b8fd4', '#7b61e0', '#d45fa3', '#4db6ac',
  '#f06292', '#aeb74a',
];

// ── Persistent player identity (localStorage) ──────
const LS_NAME  = 'cw_player_name';
const LS_COLOR = 'cw_player_color';
const LS_AVATAR= 'cw_player_avatar'; // base64 PNG

export function loadPlayerIdentity() {
  return {
    name:   localStorage.getItem(LS_NAME)  || '',
    color:  localStorage.getItem(LS_COLOR) || PLAYER_COLORS[0],
    avatar: localStorage.getItem(LS_AVATAR)|| '',
  };
}

export function savePlayerIdentity({ name, color, avatar }) {
  if (name   !== undefined) localStorage.setItem(LS_NAME,   name);
  if (color  !== undefined) localStorage.setItem(LS_COLOR,  color);
  if (avatar !== undefined) localStorage.setItem(LS_AVATAR, avatar);
}

// ── Session state (in-memory) ──────────────────────
export const session = {
  /** The 4-char lobby code the player is currently in */
  lobbyCode: null,

  /** Firebase-assigned player ID */
  playerId: null,

  /** Whether the local player is the host */
  isHost: false,

  /** 'together' | 'versus' */
  gameMode: 'together',

  /** The puzzle/map object currently loaded */
  puzzle: null,
};

// ── Routing helpers ────────────────────────────────
export function navigate(page) {
  // page = 'index' | 'lobby' | 'game'
  window.location.href = `/pages/${page}.html`;
}
