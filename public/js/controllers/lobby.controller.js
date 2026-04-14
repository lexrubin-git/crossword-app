/**
 * lobby.controller.js — Controls the Lobby / Waiting Room page.
 *
 * Responsibilities:
 *  - Display lobby code with reveal / copy / hide actions
 *  - Render and update the player list in real time
 *  - Handle identity editing (name, color, pixel avatar)
 *  - Game mode selector (Together / Versus)
 *  - Puzzle vote panel (size + difficulty chips + vote grid)
 *  - Lobby chat
 *  - Start / join active game button
 *  - Host-only actions: kick, give-host, start-anyway
 *  - Leave lobby flow
 *  - Firebase real-time subscription (via window._fb injected by firebase.js)
 */

import {
  loadPlayerIdentity,
  savePlayerIdentity,
  session,
  navigate,
} from '../state.js';

import {
  showToast,
  openOverlay,
  closeOverlay,
  renderSwatches,
  applyAvatar,
  startWaitingDots,
  openCtxMenu,
  debounce,
} from '../ui.helpers.js';

import {
  getLobby,
  leaveLobby,
  setGameMode,
  castVote,
  removeVote,
  kickPlayer,
  transferHost,
  startGame,
  sendChatMessage,
} from '../api.service.js';

// ── Bootstrap session from sessionStorage ─────────
session.lobbyCode = sessionStorage.getItem('lobbyCode') || '';
session.playerId  = sessionStorage.getItem('playerId')  || '';
session.isHost    = sessionStorage.getItem('isHost') === '1';

if (!session.lobbyCode) navigate('index');

// ── DOM refs ───────────────────────────────────────
const lobbyBannerCode    = document.getElementById('lobby-banner-code');
const bannerRevealOverlay= document.getElementById('banner-reveal-overlay');
const codeHideBtn        = document.getElementById('code-hide-btn');
const eyeIcon            = document.getElementById('eye-icon');
const eyeOffIcon         = document.getElementById('eye-off-icon');
const bannerCopyBtn      = document.getElementById('banner-copy-btn');
const bannerCopyLabel    = document.getElementById('banner-copy-label');

const lobbySubtitle      = document.getElementById('lobby-subtitle');
const waitingDots        = document.getElementById('waiting-dots');
const playerCount        = document.getElementById('player-count');
const playerList         = document.getElementById('player-list');
const playerCtxMenu      = document.getElementById('player-ctx-menu');
const ctxGiveHost        = document.getElementById('player-ctx-give-host');
const ctxKick            = document.getElementById('player-ctx-kick');

const lobbyAvatar        = document.getElementById('lobby-avatar');
const lobbyNameInput     = document.getElementById('lobby-name-input');
const lobbySwatches      = document.getElementById('lobby-swatches');
const identityLockedOverlay = document.getElementById('identity-locked-overlay');

const chatMessages       = document.getElementById('chat-messages');
const chatEmpty          = document.getElementById('chat-empty');
const chatInput          = document.getElementById('chat-input');
const chatSend           = document.getElementById('chat-send');

const modeCardTogether   = document.getElementById('mode-card-together');
const modeCardVersus     = document.getElementById('mode-card-versus');
const modeNonhostOverlay = document.getElementById('mode-nonhost-overlay');

const startBtnWrap       = document.getElementById('start-btn-wrap');

const leaveLobbyBtn      = document.getElementById('leave-lobby-btn');

// ── Local state ────────────────────────────────────
let identity       = loadPlayerIdentity();
let codeHidden     = false;
let players        = {};       // playerId → playerObj
let ctxTargetId    = null;
let hasVoted       = false;
let stopWaitingDots;
let lobbyMode      = 'together';
let stopFirebase   = null;     // unsubscribe fn from Firebase listener

// ── Code banner ────────────────────────────────────
function renderCodeBanner() {
  lobbyBannerCode.textContent = session.lobbyCode;
  if (codeHidden) {
    lobbyBannerCode.classList.add('blurred');
    bannerRevealOverlay.classList.remove('hidden');
    eyeIcon.style.display    = 'none';
    eyeOffIcon.style.display = '';
  } else {
    lobbyBannerCode.classList.remove('blurred');
    bannerRevealOverlay.classList.add('hidden');
    eyeIcon.style.display    = '';
    eyeOffIcon.style.display = 'none';
  }
}

function toggleCodeVisibility() {
  codeHidden = !codeHidden;
  renderCodeBanner();
}

function copyLobbyLink() {
  const url = `${location.origin}/?join=${session.lobbyCode}`;
  navigator.clipboard.writeText(url).then(() => {
    bannerCopyLabel.textContent = 'Copied!';
    setTimeout(() => { bannerCopyLabel.textContent = 'Copy link'; }, 2000);
  });
}

// ── Player list ────────────────────────────────────
function renderPlayerList(newPlayers) {
  players = newPlayers || {};
  const count = Object.keys(players).length;
  playerCount.textContent = count;

  playerList.innerHTML = '';
  Object.entries(players).forEach(([id, p]) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.dataset.id = id;

    // Avatar dot
    const dot = document.createElement('div');
    dot.style.cssText = `width:28px;height:28px;border-radius:50%;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;color:#fff;
      background-size:cover;background-position:center;cursor:pointer`;
    applyAvatar(dot, p);

    const nameSpan = document.createElement('span');
    nameSpan.style.flex = '1';
    nameSpan.textContent = p.name || 'Player';

    // Host crown
    if (p.isHost) {
      const crown = document.createElement('span');
      crown.textContent = '👑';
      crown.style.fontSize = '12px';
      row.appendChild(dot);
      row.appendChild(nameSpan);
      row.appendChild(crown);
    } else {
      row.appendChild(dot);
      row.appendChild(nameSpan);
    }

    // Right-click / long-press for host
    if (session.isHost && id !== session.playerId) {
      row.style.cursor = 'pointer';
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        ctxTargetId = id;
        openCtxMenu('player-ctx-menu', e);
      });
    }
    playerList.appendChild(row);
  });
}

// ── Identity editing ───────────────────────────────
function renderIdentityEditor() {
  identity = loadPlayerIdentity();
  lobbyNameInput.value = identity.name;
  applyAvatar(lobbyAvatar, identity);

  const takenColors = Object.entries(players)
    .filter(([id]) => id !== session.playerId)
    .map(([, p]) => p.color);

  renderSwatches(lobbySwatches, identity.color, takenColors, (color) => {
    identity.color = color;
    savePlayerIdentity({ color });
    applyAvatar(lobbyAvatar, identity);
    syncIdentityToServer();
  });
}

const syncIdentityToServer = debounce(async () => {
  if (!session.lobbyCode || !session.playerId) return;
  try {
    await fetch(`/api/lobbies/${session.lobbyCode}/players/${session.playerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: identity.name, color: identity.color }),
    });
  } catch (e) { console.warn('identity sync failed', e); }
}, 400);

function onLobbyNameInput() {
  identity.name = lobbyNameInput.value;
  applyAvatar(lobbyAvatar, identity);
  savePlayerIdentity({ name: identity.name });
  syncIdentityToServer();
}

// ── Chat ───────────────────────────────────────────
function appendChatMessage({ name, color, avatar, text, ts }) {
  chatEmpty?.remove();
  const msg   = document.createElement('div');
  msg.className = 'chat-msg';

  const meta = document.createElement('div');
  meta.className = 'chat-msg-meta';

  const av = document.createElement('div');
  av.className = 'chat-msg-avatar';
  applyAvatar(av, { name, color, avatar });

  const nm = document.createElement('span');
  nm.className = 'chat-msg-name';
  nm.textContent = name || 'Player';
  nm.style.color = color || 'var(--text2)';

  const time = document.createElement('span');
  time.className = 'chat-msg-time';
  const d = new Date(ts || Date.now());
  time.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;

  meta.append(av, nm, time);

  const body = document.createElement('div');
  body.className = 'chat-msg-text';
  body.textContent = text;

  msg.append(meta, body);
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  chatSend.disabled = true;
  try {
    await sendChatMessage(session.lobbyCode, session.playerId, text);
  } catch { showToast('Could not send message.'); }
}

// ── Game mode selector ─────────────────────────────
function setActiveMode(mode) {
  lobbyMode = mode;
  modeCardTogether.classList.toggle('active', mode === 'together');
  modeCardVersus.classList.toggle('active',   mode === 'versus');
}

async function onSetMode(mode) {
  if (!session.isHost) return;
  setActiveMode(mode);
  try { await setGameMode(session.lobbyCode, mode); }
  catch { showToast('Could not update game mode.'); }
}

// ── Start button ───────────────────────────────────
function renderStartButton(lobbyState) {
  startBtnWrap.innerHTML = '';

  if (!session.isHost) {
    // Non-host: show join-active-game if game running
    if (lobbyState.status === 'active') {
      const btn = document.createElement('button');
      btn.className = 'btn-primary';
      btn.style.cssText = 'width:100%;padding:14px;font-size:15px;margin-top:12px';
      btn.textContent = 'Join active match →';
      btn.addEventListener('click', () => {
        sessionStorage.setItem('joinActiveGame', '1');
        navigate('game');
      });
      startBtnWrap.appendChild(btn);
    }
    return;
  }

  // Host start button
  const btn = document.createElement('button');
  btn.className = 'btn-primary';
  btn.style.cssText = 'width:100%;padding:14px;font-size:15px;margin-top:12px';
  btn.textContent = lobbyState.status === 'active' ? 'Resume game →' : 'Start game →';
  btn.addEventListener('click', handleStartGame);
  startBtnWrap.appendChild(btn);
}

async function handleStartGame() {
  const topVote = getTopVotedPuzzle();
  if (!topVote) {
    showToast('Please vote for a puzzle first.');
    return;
  }
  try {
    await startGame(session.lobbyCode, topVote);
    navigate('game');
  } catch (err) {
    showToast(err.message || 'Could not start game.');
  }
}

function getTopVotedPuzzle() {
  // Stub: real implementation tallies votes from lobby state
  return sessionStorage.getItem('votedPuzzleId') || null;
}

// ── Context menu actions ───────────────────────────
async function ctxAction(action) {
  if (!ctxTargetId) return;
  if (action === 'giveHost') {
    try {
      await transferHost(session.lobbyCode, ctxTargetId);
      session.isHost = false;
      sessionStorage.setItem('isHost', '0');
      showToast('Host transferred.');
    } catch { showToast('Could not transfer host.'); }
  }
  if (action === 'kick') {
    try {
      await kickPlayer(session.lobbyCode, ctxTargetId);
    } catch { showToast('Could not kick player.'); }
  }
  ctxTargetId = null;
}

// ── Leave lobby ────────────────────────────────────
async function doLeaveLobby() {
  closeOverlay('leave-lobby-overlay');
  if (stopFirebase) stopFirebase();
  try {
    await leaveLobby(session.lobbyCode, session.playerId);
  } catch {/* best-effort */}
  sessionStorage.clear();
  navigate('index');
}

// ── Firebase subscription (real-time updates) ──────
function subscribeToLobby() {
  // This function expects window._fb to be set by an external
  // firebase initialisation script (firebase.js).
  // Calls renderPlayerList, appendChatMessage, etc. on changes.
  if (!window._fb) {
    console.warn('Firebase not initialized — polling fallback active');
    // Simple polling fallback
    const interval = setInterval(async () => {
      try {
        const lobby = await getLobby(session.lobbyCode);
        renderPlayerList(lobby.players);
        renderStartButton(lobby);
        setActiveMode(lobby.mode || 'together');
        modeNonhostOverlay.style.display = session.isHost ? 'none' : 'flex';
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }

  const { onValue, ref, db } = window._fb;
  const lobbyRef = ref(db, `lobbies/${session.lobbyCode}`);
  const unsub = onValue(lobbyRef, (snap) => {
    const lobby = snap.val();
    if (!lobby) return;
    renderPlayerList(lobby.players || {});
    renderStartButton(lobby);
    setActiveMode(lobby.mode || 'together');
    modeNonhostOverlay.style.display = session.isHost ? 'none' : 'flex';
  });
  return unsub;
}

// ── Event listeners ────────────────────────────────
codeHideBtn.addEventListener('click', toggleCodeVisibility);
bannerRevealOverlay.addEventListener('click', toggleCodeVisibility);
bannerCopyBtn.addEventListener('click', copyLobbyLink);

lobbyAvatar.addEventListener('click', () => openOverlay('lobby-pixel-overlay'));
lobbyNameInput.addEventListener('input', onLobbyNameInput);
lobbyNameInput.addEventListener('blur', () => savePlayerIdentity({ name: lobbyNameInput.value.trim() }));
lobbyNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') lobbyNameInput.blur(); });

chatInput.addEventListener('input', () => { chatSend.disabled = !chatInput.value.trim(); });
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
chatSend.addEventListener('click', sendChat);

modeCardTogether.addEventListener('click', () => onSetMode('together'));
modeCardVersus.addEventListener('click', () => onSetMode('versus'));

leaveLobbyBtn.addEventListener('click', () => openOverlay('leave-lobby-overlay'));
document.getElementById('leave-lobby-cancel-btn')?.addEventListener('click', () => closeOverlay('leave-lobby-overlay'));
document.getElementById('leave-lobby-confirm-btn')?.addEventListener('click', doLeaveLobby);

ctxGiveHost.addEventListener('click', () => ctxAction('giveHost'));
ctxKick.addEventListener('click',     () => ctxAction('kick'));

document.getElementById('lobby-pixel-cancel-btn')?.addEventListener('click', () => closeOverlay('lobby-pixel-overlay'));
document.getElementById('lobby-pixel-save-btn')?.addEventListener('click', () => {
  closeOverlay('lobby-pixel-overlay');
  // Pixel art controller saves avatar to localStorage; refresh identity
  identity = loadPlayerIdentity();
  applyAvatar(lobbyAvatar, identity);
  syncIdentityToServer();
});

// Size / difficulty chips (basic wiring)
document.querySelectorAll('.lobby-size-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lobby-size-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const isLarge = btn.dataset.size === 'large';
    document.getElementById('lobby-diff-standard').style.display = isLarge ? 'none' : 'flex';
    document.getElementById('lobby-diff-large').style.display    = isLarge ? 'flex' : 'none';
  });
});
document.querySelectorAll('.lobby-diff-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lobby-diff-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ── Bootstrap ──────────────────────────────────────
(async function init() {
  renderCodeBanner();
  stopWaitingDots = startWaitingDots(waitingDots);
  renderIdentityEditor();
  modeNonhostOverlay.style.display = session.isHost ? 'none' : 'flex';

  // Initial fetch
  try {
    const lobby = await getLobby(session.lobbyCode);
    renderPlayerList(lobby.players || {});
    renderStartButton(lobby);
    setActiveMode(lobby.mode || 'together');
  } catch (err) {
    showToast('Could not load lobby.');
    console.error(err);
  }

  // Subscribe to real-time updates
  stopFirebase = subscribeToLobby();
})();
