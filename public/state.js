// ── state.js — Shared application state & routing helpers ──
// All mutable state lives here; controllers import what they need.

// ── Random username generator ──
const _RNG_ADJ  = ['Bold','Swift','Clever','Sharp','Brave','Quiet','Wild','Calm','Witty','Sneaky','Bright','Fuzzy','Lucky','Mighty','Noble','Odd','Peppy','Quick','Rusty','Silly','Tidy','Upbeat','Vivid','Wacky','Zany','Chunky','Daring','Epic','Funky','Groovy'];
const _RNG_NOUN = ['Panda','Falcon','Walrus','Cactus','Penguin','Noodle','Pickle','Muffin','Rocket','Badger','Cobalt','Dingo','Ember','Fossil','Gadget','Hippo','Igloo','Jester','Koala','Llama','Magnet','Narwhal','Otter','Pixel','Quokka','Raven','Sphinx','Tundra','Umbra','Viking'];
function _genUsername() {
  const adj  = _RNG_ADJ[Math.floor(Math.random()  * _RNG_ADJ.length)];
  const noun = _RNG_NOUN[Math.floor(Math.random() * _RNG_NOUN.length)];
  const num  = Math.floor(Math.random() * 900) + 100;
  return `${adj}${noun}${num}`;
}

export const COLORS = [
  { hex:'#E03030',name:'Red'     },{ hex:'#E07830',name:'Orange'  },
  { hex:'#E0C030',name:'Yellow'  },{ hex:'#38A838',name:'Green'   },
  { hex:'#3080D8',name:'Blue'    },{ hex:'#7040D0',name:'Purple'  },
  { hex:'#D84090',name:'Pink'    },{ hex:'#7A4828',name:'Brown'   },
  { hex:'#444444',name:'Black'   },{ hex:'#888888',name:'Grey'    },
];

// ── Player identity (persisted to sessionStorage so it survives page navigation) ──
function _loadSS(key, fallback) {
  try { const v = sessionStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function _saveSS(key, val) { try { sessionStorage.setItem(key, JSON.stringify(val)); } catch {} }

export const state = {
  get playerName()        { return _loadSS('playerName', _genUsername()); },
  set playerName(v)       { _saveSS('playerName', v); },

  get playerColor()       { return _loadSS('playerColor', COLORS[Math.floor(Math.random() * COLORS.length)]); },
  set playerColor(v)      { _saveSS('playerColor', v); },

  get pixelAvatarData()   { return _loadSS('pixelAvatarData', null); },
  set pixelAvatarData(v)  { _saveSS('pixelAvatarData', v); },

  get myPlayerId()        { return _loadSS('myPlayerId', null); },
  set myPlayerId(v)       { _saveSS('myPlayerId', v); },

  get activeLobbyCode()   { return _loadSS('activeLobbyCode', null); },
  set activeLobbyCode(v)  { _saveSS('activeLobbyCode', v); },

  get isHost()            { return _loadSS('isHost', false); },
  set isHost(v)           { _saveSS('isHost', v); },

  // In-game transient state (not persisted across page loads, only page navigation)
  lastKnownPlayers: {},
  lastLobbyData: null,
  myVote: null,
  myVoteMeta: { size: 'standard', diff: 'medium' },
  lobbyMode: null,
};

// ── Navigation helpers ──
// Navigate to a page, optionally passing data via sessionStorage
export function navigate(page) {
  window.location.href = page;
}

// ── Firebase accessor (set by firebase.js before controllers load) ──
export function getFb() {
  return window._fb || null;
}

// ── Toast ──
export function showToast(msg, duration = 2500) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.classList.remove('show'); t.textContent = ''; }, duration);
}

// ── Chat name color helper ──
export function chatNameColor(hex) {
  if (!hex) return '#a0a0a0';
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  return (0.299*r + 0.587*g + 0.114*b) / 255 < 0.2 ? '#888888' : hex;
}

// ── Taken color helpers ──
export function takenColorHexes(excludeId) {
  return new Set(
    Object.entries(state.lastKnownPlayers)
      .filter(([id]) => id !== excludeId)
      .map(([, p]) => p.colorHex)
  );
}

// Expose on window for non-module scripts that reference it
window.chatNameColor = chatNameColor;
window.showToast = showToast;
