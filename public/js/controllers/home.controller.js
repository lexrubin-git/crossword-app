/**
 * home.controller.js — Home page controller.
 * Uses Firebase Realtime Database directly, mirroring
 * the original single-file implementation exactly.
 */

// ── Wait for Firebase ──────────────────────────────
function waitForFirebase() {
  return new Promise((resolve) => {
    if (window._fb) return resolve(window._fb);
    window.addEventListener('firebase-ready', () => resolve(window._fb), { once: true });
  });
}

// ── Colors (matching original exactly) ────────────
const COLORS = [
  { hex:'#E03030',name:'Red'    }, { hex:'#E07830',name:'Orange' },
  { hex:'#E0C030',name:'Yellow' }, { hex:'#38A838',name:'Green'  },
  { hex:'#3080D8',name:'Blue'   }, { hex:'#7040D0',name:'Purple' },
  { hex:'#D84090',name:'Pink'   }, { hex:'#7A4828',name:'Brown'  },
  { hex:'#444444',name:'Black'  }, { hex:'#888888',name:'Grey'   },
];

// ── Random username generator ──────────────────────
const ADJ  = ['Bold','Swift','Clever','Sharp','Brave','Quiet','Wild','Calm','Witty','Sneaky'];
const NOUN = ['Panda','Falcon','Walrus','Cactus','Penguin','Noodle','Pickle','Muffin','Rocket','Badger'];
function genUsername() {
  return ADJ[Math.floor(Math.random()*ADJ.length)] + NOUN[Math.floor(Math.random()*NOUN.length)] + (Math.floor(Math.random()*900)+100);
}

let playerName  = genUsername();
let playerColor = COLORS[Math.floor(Math.random() * COLORS.length)];
let pixelAvatarData = null;

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2500);
}

function updateChip() {
  const avatar = document.getElementById('chip-avatar');
  const nameEl = document.getElementById('chip-name');
  if (!avatar || !nameEl) return;
  avatar.style.background = playerColor.hex;
  if (pixelAvatarData) {
    avatar.style.backgroundImage = `url(${pixelAvatarData})`;
    avatar.style.backgroundSize = 'cover';
    avatar.style.backgroundPosition = 'center';
    avatar.textContent = '';
  } else {
    avatar.style.backgroundImage = '';
    avatar.textContent = playerName.charAt(0).toUpperCase();
  }
  nameEl.textContent = playerName;
}

function initColorSwatches() {
  const container = document.getElementById('color-swatches');
  if (!container) return;
  container.innerHTML = '';
  COLORS.forEach((c) => {
    const s = document.createElement('div');
    s.className = 'swatch' + (c.hex === playerColor.hex ? ' selected' : '');
    s.style.background = c.hex;
    s.title = c.name;
    s.dataset.hex = c.hex;
    s.onclick = () => {
      container.querySelectorAll('.swatch').forEach(el => el.classList.remove('selected'));
      s.classList.add('selected');
      playerColor = c;
    };
    container.appendChild(s);
  });
}

function openProfile() {
  const input = document.getElementById('player-name');
  if (input) input.value = playerName;
  initColorSwatches();
  document.getElementById('profile-overlay')?.classList.remove('hidden');
}

function confirmProfile() {
  const val = document.getElementById('player-name')?.value.trim();
  if (!val) {
    document.getElementById('player-name')?.classList.add('error');
    document.getElementById('name-error')?.classList.add('visible');
    return;
  }
  playerName = val;
  const sel = document.querySelector('#color-swatches .swatch.selected');
  if (sel) playerColor = COLORS.find(c => c.hex === sel.dataset.hex) || playerColor;
  closeOverlay('profile-overlay');
  updateChip();
  sessionStorage.setItem('playerName',      playerName);
  sessionStorage.setItem('playerColorHex',  playerColor.hex);
  sessionStorage.setItem('playerColorName', playerColor.name);
}

function closeOverlay(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function initJoinSwatches(takenHexes) {
  const taken = takenHexes || new Set();
  const firstFree = COLORS.find(c => !taken.has(c.hex)) || COLORS[0];
  const container = document.getElementById('join-color-swatches');
  const lockMsg   = document.getElementById('join-color-locked');
  if (!container) return;
  container.innerHTML = '';
  COLORS.forEach(c => {
    const isTaken = taken.has(c.hex);
    const s = document.createElement('div');
    s.className = 'swatch' + (!isTaken && c.hex === firstFree.hex ? ' selected' : '') + (isTaken ? ' taken' : '');
    s.style.background = c.hex;
    s.title = isTaken ? c.name + ' (taken)' : c.name;
    s.dataset.hex = c.hex;
    if (!isTaken) {
      s.onclick = () => {
        container.querySelectorAll('.swatch').forEach(el => el.classList.remove('selected'));
        s.classList.add('selected');
      };
    }
    container.appendChild(s);
  });
  container.style.opacity = '1';
  container.style.pointerEvents = '';
  if (lockMsg) lockMsg.style.display = 'none';
}

async function goToLobby() {
  const btn = document.getElementById('create-lobby-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
  try {
    const { db, ref, set, push, onDisconnect, serverTimestamp } = await waitForFirebase();
    const SAFE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    while (code.length < 4) code += SAFE[Math.floor(Math.random() * SAFE.length)];

    const newRef = push(ref(db, 'lobbies/' + code + '/players'));
    const myPlayerId = newRef.key;

    await set(ref(db, 'lobbies/' + code), {
      host: myPlayerId, createdAt: serverTimestamp(), status: 'waiting',
      players: {
        [myPlayerId]: {
          name: playerName, colorHex: playerColor.hex,
          avatar: pixelAvatarData || null, vote: null, voteMeta: null,
          isHost: true, joinedAt: serverTimestamp(),
        }
      }
    });
    onDisconnect(ref(db, 'lobbies/' + code + '/players/' + myPlayerId)).remove();

    sessionStorage.setItem('lobbyCode',       code);
    sessionStorage.setItem('playerId',        myPlayerId);
    sessionStorage.setItem('isHost',          '1');
    sessionStorage.setItem('playerName',      playerName);
    sessionStorage.setItem('playerColorHex',  playerColor.hex);
    sessionStorage.setItem('playerColorName', playerColor.name);
    if (pixelAvatarData) sessionStorage.setItem('playerAvatar', pixelAvatarData);

    window.location.href = '/pages/lobby.html';
  } catch(e) {
    showToast('Could not create lobby. Try again.');
    console.error(e);
    if (btn) { btn.disabled = false; btn.textContent = 'Create a lobby'; }
  }
}

function openJoinOverlay() {
  const codeInput = document.getElementById('join-code');
  const nameInput = document.getElementById('join-name');
  if (codeInput) codeInput.value = '';
  if (nameInput) nameInput.value = playerName;
  ['join-code','join-name'].forEach(id => document.getElementById(id)?.classList.remove('error'));
  ['join-error','join-name-error'].forEach(id => document.getElementById(id)?.classList.remove('visible'));
  const container = document.getElementById('join-color-swatches');
  const lockMsg   = document.getElementById('join-color-locked');
  if (container) {
    container.innerHTML = '';
    COLORS.forEach(c => {
      const s = document.createElement('div');
      s.className = 'swatch taken';
      s.style.background = c.hex;
      container.appendChild(s);
    });
    container.style.opacity = '0.35';
    container.style.pointerEvents = 'none';
  }
  if (lockMsg) lockMsg.style.display = '';
  document.getElementById('join-overlay')?.classList.remove('hidden');
  setTimeout(() => codeInput?.focus(), 50);
}

let joinCodeDebounce = null;
function onJoinInput() {
  document.getElementById('join-code')?.classList.remove('error');
  document.getElementById('join-error')?.classList.remove('visible');
  const sw = document.getElementById('join-color-swatches');
  const lk = document.getElementById('join-color-locked');
  if (sw) { sw.style.opacity = '0.35'; sw.style.pointerEvents = 'none'; }
  if (lk) lk.style.display = '';
  clearTimeout(joinCodeDebounce);
  const code = document.getElementById('join-code')?.value.trim().toUpperCase();
  if (!code || code.length < 4) return;
  joinCodeDebounce = setTimeout(() => fetchLobbyColors(code), 500);
}

async function fetchLobbyColors(code) {
  try {
    const { db, ref, get } = await waitForFirebase();
    const snap = await get(ref(db, 'lobbies/' + code + '/players'));
    if (!snap.exists()) return;
    const takenHexes = new Set(Object.values(snap.val() || {}).map(p => p.colorHex));
    initJoinSwatches(takenHexes);
  } catch(e) {}
}

async function doJoin() {
  const code = document.getElementById('join-code')?.value.trim().toUpperCase();
  const name = document.getElementById('join-name')?.value.trim();
  let ok = true;
  if (!code) {
    document.getElementById('join-code')?.classList.add('error');
    const e = document.getElementById('join-error');
    if (e) { e.textContent = 'Please enter a lobby code.'; e.classList.add('visible'); }
    ok = false;
  }
  if (!name) {
    document.getElementById('join-name')?.classList.add('error');
    document.getElementById('join-name-error')?.classList.add('visible');
    ok = false;
  }
  if (!ok) return;

  const btn = document.getElementById('join-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Joining…'; }

  try {
    const { db, ref, get, set, push, onDisconnect, serverTimestamp } = await waitForFirebase();
    const snap = await get(ref(db, 'lobbies/' + code));
    if (!snap.exists()) {
      const e = document.getElementById('join-error');
      if (e) { e.textContent = 'Lobby not found.'; e.classList.add('visible'); }
      document.getElementById('join-code')?.classList.add('error');
      return;
    }
    const selSwatch = document.querySelector('#join-color-swatches .swatch.selected');
    const chosenHex = selSwatch?.dataset.hex || playerColor.hex;
    const chosenColor = COLORS.find(c => c.hex === chosenHex) || playerColor;

    const newRef = push(ref(db, 'lobbies/' + code + '/players'));
    const myPlayerId = newRef.key;
    await set(newRef, {
      name: name, colorHex: chosenHex, avatar: pixelAvatarData || null,
      vote: null, isHost: false, joinedAt: serverTimestamp(),
    });
    onDisconnect(ref(db, 'lobbies/' + code + '/players/' + myPlayerId)).remove();

    playerName = name; playerColor = chosenColor;
    sessionStorage.setItem('lobbyCode',       code);
    sessionStorage.setItem('playerId',        myPlayerId);
    sessionStorage.setItem('isHost',          '0');
    sessionStorage.setItem('playerName',      playerName);
    sessionStorage.setItem('playerColorHex',  playerColor.hex);
    sessionStorage.setItem('playerColorName', playerColor.name);
    if (pixelAvatarData) sessionStorage.setItem('playerAvatar', pixelAvatarData);

    window.location.href = '/pages/lobby.html';
  } catch(e) {
    const err = document.getElementById('join-error');
    if (err) { err.textContent = 'Connection error. Try again.'; err.classList.add('visible'); }
    console.error(e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Join →'; }
  }
}

// ── Event wiring ───────────────────────────────────
document.getElementById('create-lobby-btn')?.addEventListener('click', goToLobby);
document.getElementById('join-lobby-btn')?.addEventListener('click', openJoinOverlay);
document.getElementById('edit-profile-btn')?.addEventListener('click', openProfile);
document.getElementById('chip-avatar')?.addEventListener('click', openProfile);
document.getElementById('chip-name')?.addEventListener('click', openProfile);
document.getElementById('profile-confirm-btn')?.addEventListener('click', confirmProfile);
document.getElementById('profile-cancel-btn')?.addEventListener('click', () => closeOverlay('profile-overlay'));
document.getElementById('player-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') confirmProfile(); });
document.getElementById('player-name')?.addEventListener('input', () => {
  document.getElementById('player-name')?.classList.remove('error');
  document.getElementById('name-error')?.classList.remove('visible');
});
document.getElementById('join-cancel-btn')?.addEventListener('click', () => closeOverlay('join-overlay'));
document.getElementById('join-code')?.addEventListener('input', onJoinInput);
document.getElementById('join-code')?.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
document.getElementById('join-name')?.addEventListener('input', () => {
  document.getElementById('join-name')?.classList.remove('error');
  document.getElementById('join-name-error')?.classList.remove('visible');
});
document.getElementById('join-btn')?.addEventListener('click', doJoin);

// ── Bootstrap ──────────────────────────────────────
const storedName  = sessionStorage.getItem('playerName');
const storedColor = sessionStorage.getItem('playerColorHex');
if (storedName)  playerName  = storedName;
if (storedColor) playerColor = COLORS.find(c => c.hex === storedColor) || playerColor;

// Load SVG logo
fetch('/img/crosswordwithfriends.svg')
  .then(r => r.text())
  .then(svg => {
    const wrap = document.getElementById('logo-wrap');
    if (!wrap) return;
    wrap.innerHTML = svg;
    const svgEl = wrap.querySelector('svg');
    if (svgEl) svgEl.style.cssText = 'width:clamp(280px,80vw,720px);height:auto;display:block;margin:0 auto;animation:logoPulse 4s ease-in-out infinite;transform-origin:center center';
  })
  .catch(() => {
    const wrap = document.getElementById('logo-wrap');
    if (wrap) wrap.innerHTML = '<div style="font-size:48px;font-weight:700;color:var(--text)">Crossword</div>';
  });

updateChip();
