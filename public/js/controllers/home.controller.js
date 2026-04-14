/**
 * home.controller.js — Controls the Home (index) page.
 *
 * Responsibilities:
 *  - Render the animated logo
 *  - Show / hide the player identity row
 *  - Handle "Create lobby" and "Join lobby" actions
 *  - Open the profile overlay for first-time setup or editing
 */

import {
  loadPlayerIdentity,
  savePlayerIdentity,
  navigate,
  PLAYER_COLORS,
} from '/js/state.js';

import {
  showToast,
  openOverlay,
  closeOverlay,
  renderSwatches,
  applyAvatar,
} from '/js/ui.helpers.js';

// Firebase is used directly — no Express server needed on Firebase Hosting

// ── State ──────────────────────────────────────────
let identity = loadPlayerIdentity();
let pendingJoinCode = '';
let pendingJoinColor = identity.color;

// ── DOM refs ───────────────────────────────────────
const homeIdentityRow  = document.getElementById('home-identity-row');
const homeAvatar       = document.getElementById('home-avatar');
const homePlayerName   = document.getElementById('home-player-name');
const createLobbyBtn   = document.getElementById('create-lobby-btn');
const joinLobbyBtn     = document.getElementById('join-lobby-btn');
const editProfileBtn   = document.getElementById('edit-profile-btn');

// Profile overlay
const profileOverlay   = document.getElementById('profile-overlay');
const playerNameInput  = document.getElementById('player-name');
const nameError        = document.getElementById('name-error');
const profileConfirmBtn= document.getElementById('profile-confirm-btn');
const profileCancelBtn = document.getElementById('profile-cancel-btn');

// Join overlay
const joinOverlay      = document.getElementById('join-overlay');
const joinCodeInput    = document.getElementById('join-code');
const joinError        = document.getElementById('join-error');
const joinNameInput    = document.getElementById('join-name');
const joinNameError    = document.getElementById('join-name-error');
const joinColorSwatches= document.getElementById('join-color-swatches');
const joinBtn          = document.getElementById('join-btn');
const joinCancelBtn    = document.getElementById('join-cancel-btn');

// ── Logo ───────────────────────────────────────────
function renderLogo() {
  const wrap = document.getElementById('logo-wrap');
  if (!wrap) return;
  // The original inline SVG logo — referenced here so HTML stays clean.
  wrap.innerHTML = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1554 622.21"
       style="width:clamp(360px,85vw,820px);height:auto;display:block;margin:0 auto;
              animation:logoPulse 4s ease-in-out infinite;transform-origin:center center">
    <style>
      .st0{stroke:#f9f8ef;stroke-miterlimit:10;stroke-width:12px}
      .st1{fill:#f2f2f2;stroke:#000;stroke-linecap:round;stroke-linejoin:round;stroke-width:5px}
    </style>
    <path class="st0" d="M1371.46,105.6H182.53c-7.95,0-14.42,6.47-14.42,14.42v122.83c0,.31.06.6.17.88-.1.27-.17.57-.17.88v257.58c0,7.95,6.47,14.42,14.42,14.42h919.43c7.95,0,14.42-6.47,14.42-14.42v-110.91c0-7.95-6.47-14.42-14.42-14.42h-389.84v-131.51h659.34c7.95,0,14.42-6.47,14.42-14.42v-110.91c0-7.95-6.47-14.42-14.42-14.42Z"/>
    <g>
      <path class="st1" d="M182.53,108.1h122.83v134.75h-134.75v-122.83c0-6.58,5.34-11.92,11.92-11.92Z"/>
      <rect class="st1" x="305.36" y="108.1" width="134.75" height="134.75"/>
      <rect class="st1" x="1113.88" y="108.1" width="134.75" height="134.75"/>
      <rect class="st1" x="305.36" y="379.36" width="134.75" height="134.75"/>
      <rect class="st1" x="440.12" y="108.1" width="134.75" height="134.75"/>
      <rect class="st1" x="979.13" y="108.1" width="134.75" height="134.75"/>
    </g>
  </svg>`;
}

// ── Identity row ───────────────────────────────────
function refreshIdentityRow() {
  identity = loadPlayerIdentity();
  if (!identity.name) {
    homeIdentityRow.style.display = 'none';
    return;
  }
  homeIdentityRow.style.display = 'flex';
  applyAvatar(homeAvatar, identity);
  homePlayerName.textContent = identity.name;
}

// ── Profile overlay ────────────────────────────────
function openProfileOverlay() {
  identity = loadPlayerIdentity();
  playerNameInput.value = identity.name;
  nameError.classList.remove('visible');
  renderSwatches('color-swatches', identity.color, [], (c) => {
    identity.color = c;
  });
  openOverlay('profile-overlay');
}

function confirmProfile() {
  const name = playerNameInput.value.trim();
  if (!name) {
    nameError.classList.add('visible');
    return;
  }
  savePlayerIdentity({ name, color: identity.color });
  closeOverlay('profile-overlay');
  refreshIdentityRow();
}

// ── Firebase helpers ───────────────────────────────
function waitForFirebase() {
  return new Promise((resolve) => {
    if (window._fb) return resolve(window._fb);
    window.addEventListener('firebase-ready', () => resolve(window._fb), { once: true });
  });
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generatePlayerId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Create lobby ───────────────────────────────────
async function handleCreateLobby() {
  identity = loadPlayerIdentity();
  if (!identity.name) {
    openProfileOverlay();
    return;
  }
  createLobbyBtn.disabled = true;
  createLobbyBtn.textContent = 'Creating…';
  try {
    const { db, ref, set } = await waitForFirebase();
    const code     = generateCode();
    const playerId = generatePlayerId();

    await set(ref(db, `lobbies/${code}`), {
      code,
      hostId:   playerId,
      status:   'waiting',
      mode:     'together',
      createdAt: Date.now(),
      players: {
        [playerId]: {
          name:     identity.name,
          color:    identity.color,
          avatar:   identity.avatar || '',
          isHost:   true,
          inGame:   false,
          joinedAt: Date.now(),
        },
      },
      votes: {},
      gameSettings: {
        puzzleId:         null,
        startedAt:        null,
        gameEnded:        false,
        autocheckEnabled: false,
      },
    });

    sessionStorage.setItem('lobbyCode', code);
    sessionStorage.setItem('playerId',  playerId);
    sessionStorage.setItem('isHost',    '1');
    navigate('lobby');
  } catch (err) {
    showToast('Could not create lobby. Try again.');
    console.error(err);
  } finally {
    createLobbyBtn.disabled = false;
    createLobbyBtn.textContent = 'Create a lobby';
  }
}

// ── Join lobby ─────────────────────────────────────
function openJoinOverlay() {
  identity = loadPlayerIdentity();
  joinCodeInput.value = '';
  joinNameInput.value = identity.name;
  joinError.classList.remove('visible');
  joinNameError.classList.remove('visible');
  pendingJoinColor = identity.color;
  joinColorSwatches.style.opacity = '0.35';
  joinColorSwatches.style.pointerEvents = 'none';
  renderSwatches(joinColorSwatches, pendingJoinColor, [], (c) => {
    pendingJoinColor = c;
  });
  openOverlay('join-overlay');
}

async function handleJoinCodeInput() {
  const code = joinCodeInput.value.trim().toUpperCase();
  joinError.classList.remove('visible');
  joinCodeInput.classList.remove('error');

  if (code.length < 4) {
    joinColorSwatches.style.opacity = '0.35';
    joinColorSwatches.style.pointerEvents = 'none';
    return;
  }

  try {
    const { db, ref, get } = await waitForFirebase();
    const snap  = await get(ref(db, `lobbies/${code}`));
    if (!snap.exists()) throw new Error('Not found');
    const lobby = snap.val();
    const takenColors = Object.values(lobby.players || {}).map((p) => p.color);
    renderSwatches(joinColorSwatches, pendingJoinColor, takenColors, (c) => {
      pendingJoinColor = c;
    });
    joinColorSwatches.style.opacity = '1';
    joinColorSwatches.style.pointerEvents = 'auto';
    pendingJoinCode = code;
  } catch {
    joinError.classList.add('visible');
    joinCodeInput.classList.add('error');
    joinColorSwatches.style.opacity = '0.35';
    joinColorSwatches.style.pointerEvents = 'none';
  }
}

async function handleDoJoin() {
  const name = joinNameInput.value.trim();
  if (!name) { joinNameError.classList.add('visible'); return; }
  if (!pendingJoinCode) { joinError.classList.add('visible'); return; }

  joinBtn.disabled = true;
  joinBtn.textContent = 'Joining…';
  try {
    const { db, ref, set } = await waitForFirebase();
    const playerId = generatePlayerId();

    await set(ref(db, `lobbies/${pendingJoinCode}/players/${playerId}`), {
      name:     name,
      color:    pendingJoinColor,
      avatar:   '',
      isHost:   false,
      inGame:   false,
      joinedAt: Date.now(),
    });

    savePlayerIdentity({ name, color: pendingJoinColor });
    sessionStorage.setItem('lobbyCode', pendingJoinCode);
    sessionStorage.setItem('playerId',  playerId);
    sessionStorage.setItem('isHost',    '0');
    navigate('lobby');
  } catch (err) {
    showToast(err.message || 'Could not join lobby.');
    console.error(err);
  } finally {
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join →';
  }
}

// ── Event listeners ────────────────────────────────
createLobbyBtn.addEventListener('click', handleCreateLobby);
joinLobbyBtn.addEventListener('click', openJoinOverlay);
editProfileBtn?.addEventListener('click', openProfileOverlay);
homeAvatar?.addEventListener('click', openProfileOverlay);
homePlayerName?.addEventListener('click', openProfileOverlay);

profileConfirmBtn.addEventListener('click', confirmProfile);
profileCancelBtn.addEventListener('click', () => closeOverlay('profile-overlay'));
playerNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmProfile(); });
playerNameInput.addEventListener('input',   () => nameError.classList.remove('visible'));

joinCancelBtn.addEventListener('click', () => closeOverlay('join-overlay'));
joinCodeInput.addEventListener('input', handleJoinCodeInput);
joinCodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleDoJoin(); });
joinNameInput.addEventListener('input',   () => joinNameError.classList.remove('visible'));
joinBtn.addEventListener('click', handleDoJoin);

// ── Bootstrap ──────────────────────────────────────
renderLogo();
refreshIdentityRow();

// If there's a ?join=CODE query param, open join overlay pre-filled
const urlCode = new URLSearchParams(location.search).get('join');
if (urlCode) {
  openJoinOverlay();
  joinCodeInput.value = urlCode.toUpperCase();
  handleJoinCodeInput();
}
