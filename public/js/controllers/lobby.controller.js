// ── lobby.controller.js ──
import { state, COLORS, showToast, takenColorHexes, chatNameColor } from '../state.js';
import { buildColorSwatches, updateChip, openOverlay, closeOverlay, openAvatarLightbox, startDots, stopDots } from '../ui.helpers.js';
import { mountDrawBlock, bakeAvatarDataUrl, drawVectorCanvas, updateAvatarPreview } from '../pixel-art.js';
import {
  updatePlayer, removePlayer, transferHost, setLobbyMode as setLobbyModeFB,
  castVote, removeVoteFB, sendChatMessage, startLobbyGame, removeLobby,
  subscribeLobby, subscribeChat, pruneStaleLobbies,
  pickRandomPuzzle as pickPuzzle
} from '../api.service.js';
import { pickRandomPuzzle, formatNytDateLabel, parseNytPuzzle, PUZZLE_POOL } from '../puzzle.js';
import { fetchNytPuzzle } from '../api.service.js';

// ── Lobby state (page-local) ──
let lobbyListener  = null;
let chatListener   = null;
let lobbySize = 'standard';
let lobbyDiff = 'medium';
let _lastPlayerListKey = '';
let _returnDotsInterval = null;

// ── Lobby code banner ──
function applyCodeVisibility() {
  const codeEl = document.getElementById('lobby-banner-code');
  const revealEl = document.getElementById('banner-reveal-overlay');
  const eyeEl = document.getElementById('eye-icon');
  const eyeOffEl = document.getElementById('eye-off-icon');
  if (codeEl) codeEl.classList.add('blurred');
  if (revealEl) revealEl.classList.remove('hidden');
  if (eyeEl) eyeEl.style.display = 'none';
  if (eyeOffEl) eyeOffEl.style.display = '';
}

function revealCode() {
  const codeEl = document.getElementById('lobby-banner-code');
  const revealEl = document.getElementById('banner-reveal-overlay');
  const eyeEl = document.getElementById('eye-icon');
  const eyeOffEl = document.getElementById('eye-off-icon');
  if (codeEl) codeEl.classList.remove('blurred');
  if (revealEl) revealEl.classList.add('hidden');
  if (eyeEl) eyeEl.style.display = '';
  if (eyeOffEl) eyeOffEl.style.display = 'none';
}

function toggleCodeVisibility() {
  const isBlurred = document.getElementById('lobby-banner-code')?.classList.contains('blurred');
  if (isBlurred) revealCode(); else applyCodeVisibility();
}

function bannerCopy() {
  const url = window.location.origin + window.location.pathname + '?code=' + state.activeLobbyCode;
  navigator.clipboard.writeText(url).then(() => {
    const lbl = document.getElementById('banner-copy-label');
    if (lbl) { lbl.textContent = 'Copied!'; setTimeout(() => { lbl.textContent = 'Copy link'; }, 2000); }
  });
}

// ── Identity editor ──
function initLobbyIdentityEditor() {
  const fb = state.lastKnownPlayers[state.myPlayerId];
  if (fb) {
    if (fb.name) state.playerName = fb.name;
    if (fb.colorHex) {
      const found = COLORS.find(c => c.hex === fb.colorHex);
      if (found) state.playerColor = found;
    }
  }
  document.getElementById('lobby-name-input').value = state.playerName;
  updateLobbyAvatar();
  const taken = takenColorHexes(state.myPlayerId);
  buildColorSwatches('lobby-swatches', state.playerColor.hex, taken, (color) => {
    state.playerColor = color;
    updateLobbyAvatar();
    saveLobbyIdentity();
  });
}

function refreshLobbySwatches() {
  const taken = takenColorHexes(state.myPlayerId);
  document.querySelectorAll('#lobby-swatches .swatch').forEach(s => {
    const isTaken = taken.has(s.dataset.hex);
    s.classList.toggle('taken', isTaken);
    s.style.pointerEvents = isTaken ? 'none' : '';
    const c = COLORS.find(x => x.hex === s.dataset.hex);
    s.title = isTaken ? `${c?.name} (taken)` : (c?.name || '');
  });
}

function updateLobbyAvatar() {
  const av = document.getElementById('lobby-avatar');
  if (!av) return;
  const { pixelAvatarData, playerColor, playerName } = state;
  if (pixelAvatarData) {
    av.style.backgroundImage = `url(${pixelAvatarData})`;
    av.style.backgroundSize = 'cover';
    av.style.backgroundColor = playerColor.hex;
    av.style.border = `3px solid ${playerColor.hex}`;
    av.textContent = '';
  } else {
    av.style.backgroundImage = '';
    av.style.border = '';
    av.style.background = playerColor.hex;
    av.textContent = (playerName || '?').charAt(0).toUpperCase();
  }
}

function onLobbyNameInput() {
  const val = document.getElementById('lobby-name-input').value;
  const av = document.getElementById('lobby-avatar');
  if (av && !state.pixelAvatarData) av.textContent = (val || '?').charAt(0).toUpperCase();
}

async function saveLobbyIdentity() {
  const val = document.getElementById('lobby-name-input').value.trim();
  if (!val) return;
  const prevColor = state.playerColor.hex;
  state.playerName = val;
  updateLobbyAvatar();
  updateChip();
  if (state.lastKnownPlayers[state.myPlayerId]) {
    state.lastKnownPlayers[state.myPlayerId].name     = state.playerName;
    state.lastKnownPlayers[state.myPlayerId].colorHex = state.playerColor.hex;
    renderPlayerList();
  }
  if (state.playerColor.hex !== prevColor) {
    repaintLobbyChatColor(state.myPlayerId, state.playerName, state.playerColor.hex);
  }
  if (state.activeLobbyCode && state.myPlayerId) {
    updatePlayer(state.activeLobbyCode, state.myPlayerId, {
      name: state.playerName,
      colorHex: state.playerColor.hex,
      avatar: state.pixelAvatarData || null,
    }).catch(() => {});
  }
}

// ── Lobby avatar pixel overlay ──
function openLobbyPixelOverlay() {
  mountDrawBlock('lobby-canvas-slot');
  openOverlay('lobby-pixel-overlay');
}

function lobbyCancel() { closeOverlay('lobby-pixel-overlay'); }

async function saveLobbyPixelAvatar() {
  const avatarData = bakeAvatarDataUrl();
  if (avatarData) state.pixelAvatarData = avatarData;
  updateLobbyAvatar();
  closeOverlay('lobby-pixel-overlay');
  if (state.activeLobbyCode && state.myPlayerId) {
    updatePlayer(state.activeLobbyCode, state.myPlayerId, { avatar: state.pixelAvatarData || null }).catch(() => {});
  }
}

// ── Player list rendering ──
let _ctxTargetId = null;

function showPlayerCtxMenu(x, y, targetId) {
  _ctxTargetId = targetId;
  const menu = document.getElementById('player-ctx-menu');
  if (!menu) return;
  menu.style.display = 'block';
  menu.style.left = Math.min(x, window.innerWidth  - 160) + 'px';
  menu.style.top  = Math.min(y, window.innerHeight - 80)  + 'px';
}

document.addEventListener('click', () => {
  const menu = document.getElementById('player-ctx-menu');
  if (menu) menu.style.display = 'none';
});

async function ctxAction(action) {
  const menu = document.getElementById('player-ctx-menu');
  if (menu) menu.style.display = 'none';
  if (!_ctxTargetId || !state.activeLobbyCode) return;
  if (action === 'kick') {
    try { await removePlayer(state.activeLobbyCode, _ctxTargetId); showToast('Player kicked.'); }
    catch { showToast('Could not kick player.'); }
  } else if (action === 'giveHost') {
    try { await transferHost(state.activeLobbyCode, _ctxTargetId, state.myPlayerId); state.isHost = false; showToast('Host transferred.'); renderStartBtn(); }
    catch { showToast('Could not transfer host.'); }
  }
  _ctxTargetId = null;
}

function renderPlayerList() {
  const players = Object.entries(state.lastKnownPlayers);
  const countEl = document.getElementById('player-count');
  if (countEl) countEl.textContent = players.length;

  const subtitleEl = document.getElementById('lobby-subtitle');
  if (players.length <= 1) {
    if (subtitleEl && !document.getElementById('waiting-dots')) {
      subtitleEl.innerHTML = 'Waiting for players to join<span id="waiting-dots"></span>';
      startDots('waiting-dots', 'waiting');
    }
  } else {
    if (subtitleEl) subtitleEl.innerHTML = `${players.length} players in the room<span id="room-dots"></span>`;
    startDots('room-dots', 'room');
  }

  const newKey = players.map(([id, p]) => `${id}:${p.name}:${p.colorHex}:${p.isHost?1:0}:${p.vote?1:0}:${p.inGame?1:0}`).join('|');
  if (newKey === _lastPlayerListKey) return;
  _lastPlayerListKey = newKey;

  const list = document.getElementById('player-list');
  if (!list) return;
  list.innerHTML = '';
  players.forEach(([id, p]) => {
    const isMe = id === state.myPlayerId;
    const canCtx = state.isHost && !isMe;
    const row = document.createElement('div');
    row.className = 'player-row';
    if (isMe) row.classList.add('is-me');
    row.innerHTML = `
      <div class="player-dot" style="background:${p.colorHex};flex-shrink:0"></div>
      <div style="flex:1;min-width:0"><span style="font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</span></div>
      ${p.isHost ? '<span class="player-badge host">host</span>' : ''}
      ${canCtx ? `<button class="player-dots-btn" title="Player options">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
      </button>` : ''}
      ${p.inGame ? '<span class="player-badge in-game">in game</span>' : ''}
    `;
    if (canCtx) {
      const dotsBtn = row.querySelector('.player-dots-btn');
      if (dotsBtn) {
        dotsBtn.addEventListener('click', e => { e.stopPropagation(); showPlayerCtxMenu(e.clientX, e.clientY, id); });
      }
      row.addEventListener('contextmenu', e => { e.preventDefault(); showPlayerCtxMenu(e.clientX, e.clientY, id); });
    }
    list.appendChild(row);
  });
}

// ── Chat ──
function renderChat(msgs) {
  const container = document.getElementById('chat-messages');
  const empty     = document.getElementById('chat-empty');
  if (!container) return;
  const entries = Object.values(msgs).sort((a, b) => a.ts - b.ts);
  if (!entries.length) { if (empty) empty.style.display = 'flex'; return; }
  if (empty) empty.style.display = 'none';
  if (container.dataset.count === String(entries.length)) return;
  container.dataset.count = entries.length;
  container.innerHTML = '';
  if (empty) container.appendChild(empty);
  entries.forEach(m => {
    const time = new Date(m.ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.dataset.playerId = m.playerId || '';
    div.dataset.colorHex = m.colorHex || '';
    div.style.cssText = `border-left:2.5px solid ${m.colorHex};padding-left:8px;margin-left:2px`;
    const avatarStyle = m.avatar
      ? `background-image:url(${m.avatar});background-color:${m.colorHex};border:2px solid ${m.colorHex};box-sizing:border-box`
      : `background-color:${m.colorHex}`;
    const avatarInner = m.avatar ? '' : (m.name||'?').charAt(0).toUpperCase();
    div.innerHTML = `
      <div class="chat-msg-meta">
        <div class="chat-msg-avatar" style="${avatarStyle}" data-avatar="${m.avatar||''}" data-color="${m.colorHex}" data-name="${(m.name||'').replace(/"/g,'&quot;')}" data-initial="${avatarInner}">${avatarInner}</div>
        <span class="chat-msg-name" style="color:${chatNameColor(m.colorHex)}">${m.name}</span>
        <span class="chat-msg-time">${time}</span>
      </div>
      <div class="chat-msg-text">${m.text.replace(/</g,'&lt;')}</div>
    `;
    div.querySelector('.chat-msg-avatar').addEventListener('click', function() {
      openAvatarLightbox(this.dataset.avatar, this.dataset.color, this.dataset.name, this.dataset.initial);
    });
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !state.activeLobbyCode) return;
  input.value = '';
  const sendBtn = document.getElementById('chat-send');
  if (sendBtn) sendBtn.disabled = true;
  try {
    await sendChatMessage(state.activeLobbyCode, {
      name: state.playerName,
      colorHex: state.playerColor.hex,
      avatar: state.pixelAvatarData || null,
      playerId: state.myPlayerId || '',
      text,
      ts: Date.now(),
    });
  } catch { showToast('Failed to send message.'); }
}

function repaintLobbyChatColor(playerId, name, newHex) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  container.querySelectorAll('.chat-msg').forEach(msgEl => {
    const pid = msgEl.dataset.playerId;
    const matchById = pid && pid === playerId;
    const nameEl = msgEl.querySelector('.chat-msg-name');
    const matchByName = !pid && nameEl && nameEl.textContent === name;
    if (!matchById && !matchByName) return;
    msgEl.dataset.colorHex = newHex;
    msgEl.style.cssText = `border-left:2.5px solid ${newHex};padding-left:8px;margin-left:2px`;
    const avatarEl = msgEl.querySelector('.chat-msg-avatar');
    if (avatarEl) avatarEl.style.backgroundColor = newHex;
    if (nameEl) nameEl.style.color = chatNameColor(newHex);
  });
}

// ── Vote system ──
function formatPuzzleVoteLabel(dateKey, size, diff) {
  const sizeLabel = size === 'large' ? '21×21' : '15×15';
  const diffLabel = { easy:'Easy (Mon)', medium:'Medium (Wed)', hard:'Hard (Fri/Sat)' }[diff] || diff;
  return `${sizeLabel} · ${diffLabel}`;
}

function castLobbyVote() {
  const comboKey = `combo:${lobbySize}:${lobbyDiff}`;
  castVoteForDateKey(comboKey, lobbySize, lobbyDiff);
}

function castVoteForDateKey(key, size, diff) {
  state.myVote = key;
  state.myVoteMeta = { size: size || 'standard', diff: diff || 'medium' };
  if (state.lastKnownPlayers[state.myPlayerId]) {
    state.lastKnownPlayers[state.myPlayerId].vote = key;
    state.lastKnownPlayers[state.myPlayerId].voteMeta = state.myVoteMeta;
  }
  if (state.activeLobbyCode && state.myPlayerId) {
    castVote(state.activeLobbyCode, state.myPlayerId, key, state.myVoteMeta).catch(() => {});
  }
  setIdentityLocked(true);
  renderVoteGrid();
  if (state.isHost) renderStartBtn();
}

function removeVote() {
  state.myVote = null;
  if (state.lastKnownPlayers[state.myPlayerId]) state.lastKnownPlayers[state.myPlayerId].vote = null;
  setIdentityLocked(false);
  renderVoteGrid();
  if (state.isHost) renderStartBtn();
  if (state.activeLobbyCode && state.myPlayerId) {
    removeVoteFB(state.activeLobbyCode, state.myPlayerId).catch(() => {});
  }
}

function setIdentityLocked(locked) {
  const cardOverlay = document.getElementById('vote-card-locked-overlay');
  if (cardOverlay) cardOverlay.style.display = 'none';
  const identityLockedOverlay = document.getElementById('identity-locked-overlay');
  if (identityLockedOverlay) identityLockedOverlay.style.display = 'none';
  if (!locked) {
    const voteBtnWrap = document.getElementById('vote-btn-wrap');
    if (voteBtnWrap) {
      voteBtnWrap.innerHTML = `<button class="btn-ghost" id="vote-cast-btn" style="width:100%;justify-content:center;font-size:12px">Vote →</button>`;
      voteBtnWrap.querySelector('#vote-cast-btn')?.addEventListener('click', castLobbyVote);
    }
  }
}

function setGameInProgressLock() {
  const panelsLock = document.getElementById('game-panels-lock-overlay');
  if (panelsLock) panelsLock.style.display = 'flex';
  const voteBtnWrap = document.getElementById('vote-btn-wrap');
  if (voteBtnWrap) {
    voteBtnWrap.innerHTML = `<button class="btn-ghost" disabled style="width:100%;justify-content:center;font-size:12px;opacity:0.4;cursor:not-allowed">Game in progress</button>`;
  }
}

function unlockGamePanels() {
  const panelsLock = document.getElementById('game-panels-lock-overlay');
  if (panelsLock) panelsLock.style.display = 'none';
}

function renderVoteGrid() {
  const players = Object.values(state.lastKnownPlayers);
  const grid = document.getElementById('vote-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const dateCounts = {};
  players.forEach(p => {
    if (p.vote) {
      if (!dateCounts[p.vote]) dateCounts[p.vote] = { voters: [], meta: p.voteMeta || {} };
      dateCounts[p.vote].voters.push(p);
    }
  });

  if (!Object.keys(dateCounts).length) return;

  Object.entries(dateCounts).sort((a,b) => b[1].voters.length - a[1].voters.length)
    .forEach(([dateKey, {voters, meta}]) => {
      const isMyVote = state.myVote === dateKey;
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;cursor:pointer;transition:background .15s,border-color .15s;background:${isMyVote?'rgba(255,255,255,0.04)':'var(--card-bg)'};border:1.5px solid ${isMyVote?'var(--text)':'var(--border)'};outline:${isMyVote?'1px solid var(--text)':'none'};`;
      row.addEventListener('click', () => {
        if (!isMyVote) castVoteForDateKey(dateKey, meta.size, meta.diff);
      });
      const dots = voters.slice(0,6).map(v => {
        const bg = v.avatar ? `background-image:url(${v.avatar});background-size:cover;background-color:${v.colorHex}` : `background:${v.colorHex}`;
        const ch = v.avatar ? '' : (v.name||'?').charAt(0).toUpperCase();
        return `<div style="width:20px;height:20px;border-radius:50%;flex-shrink:0;${bg};display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#fff;border:2.5px solid ${v.colorHex};box-shadow:0 0 0 1.5px var(--bg)" title="${v.name||'Player'}">${ch}</div>`;
      }).join('');
      row.innerHTML = `
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${formatPuzzleVoteLabel(dateKey, meta.size, meta.diff)}</div>
        </div>
        <div style="display:flex;gap:-4px;align-items:center">${dots}</div>
      `;
      grid.appendChild(row);
    });
}

// ── Game mode selector ──
let _modeOverlayTimer = null;

function setLobbyMode(mode, fromSync = false) {
  if (!state.isHost && !fromSync) {
    const overlay = document.getElementById('mode-nonhost-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
      overlay.style.opacity = '1';
      clearTimeout(_modeOverlayTimer);
      _modeOverlayTimer = setTimeout(() => {
        overlay.style.transition = 'opacity .35s';
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.style.display = 'none'; overlay.style.transition = ''; overlay.style.opacity = '1'; }, 360);
      }, 1600);
    }
    return;
  }
  state.lobbyMode = mode;
  const togetherCard = document.getElementById('mode-card-together');
  const versusCard   = document.getElementById('mode-card-versus');
  if (togetherCard && versusCard) {
    const selBg = '#ffffff', selText = '#111111';
    togetherCard.style.border = `1.5px solid ${mode === 'together' ? 'var(--text)' : 'var(--border)'}`;
    togetherCard.style.background = mode === 'together' ? selBg : 'var(--bg2)';
    togetherCard.querySelectorAll('div').forEach(el => { el.style.color = mode === 'together' ? selText : ''; });
    versusCard.style.border = `1.5px solid ${mode === 'versus' ? 'var(--text)' : 'var(--border)'}`;
    versusCard.style.background = mode === 'versus' ? selBg : 'var(--bg2)';
    versusCard.querySelectorAll('div').forEach(el => { el.style.color = mode === 'versus' ? selText : ''; });
  }
  if (state.isHost && state.activeLobbyCode) {
    setLobbyModeFB(state.activeLobbyCode, mode).catch(() => {});
  }
}

function setLobbySize(size) {
  lobbySize = size;
  document.querySelectorAll('.lobby-size-btn').forEach(b => b.classList.toggle('active', b.dataset.size === size));
  const standardDiff = document.getElementById('lobby-diff-standard');
  const largeDiff    = document.getElementById('lobby-diff-large');
  if (size === 'large') {
    if (standardDiff) standardDiff.style.display = 'none';
    if (largeDiff) largeDiff.style.display = 'flex';
    lobbyDiff = 'medium';
  } else {
    if (standardDiff) standardDiff.style.display = 'flex';
    if (largeDiff) largeDiff.style.display = 'none';
  }
  castLobbyVote();
}

function setLobbyDiff(diff) {
  lobbyDiff = diff;
  document.querySelectorAll('.lobby-diff-btn').forEach(b => b.classList.toggle('active', b.dataset.diff === diff));
  castLobbyVote();
}

// ── Start button ──
async function joinActiveMatch() {
  if (!state.activeLobbyCode || !window._fb) return;
  try {
    const { get, ref, db } = window._fb;
    const snap = await get(ref(db, `lobbies/${state.activeLobbyCode}`));
    if (!snap.exists()) return;
    const data = snap.val();
    if (data.status !== 'started' || !data.puzzleDateKey) { showToast('No active match to join.'); return; }
    if (data.gameSettings?.gameEnded) { showToast('That match has already ended.'); return; }
    sessionStorage.setItem('gameMode', data.gameMode || 'together');
    sessionStorage.setItem('puzzleDateKey', data.puzzleDateKey);
    window.location.href = 'game.html';
  } catch { showToast('Could not join match.'); }
}

function renderStartBtn() {
  const wrap = document.getElementById('start-btn-wrap');
  if (!wrap) return;

  const data = state.lastLobbyData;
  if (data && data.status === 'started' && data.puzzleDateKey) {
    const gameIsEnded = data.gameSettings?.gameEnded === true;
    if (!gameIsEnded) {
      wrap.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn-primary" id="join-active-btn" style="width:100%;justify-content:center">Join active match →</button>
          <span style="font-size:12px;color:var(--text3)">A game is currently in progress<span id="game-progress-dots"></span></span>
        </div>`;
      document.getElementById('join-active-btn')?.addEventListener('click', joinActiveMatch);
      startDots('game-progress-dots', 'gameProgress');
      setGameInProgressLock();
      return;
    }
  }
  unlockGamePanels();

  if (!state.isHost) {
    wrap.innerHTML = `<p style="font-size:13px;color:#999">Waiting for the host to start<span id="host-start-dots"></span></p>`;
    startDots('host-start-dots', 'hostStart');
    return;
  }

  const players = Object.values(state.lastKnownPlayers);
  const totalPlayers   = players.length;
  const votedPlayers   = players.filter(p => p.vote).length;
  const inGamePlayers  = players.filter(p => p.inGame && !p.isHost);
  const allVoted       = totalPlayers > 0 && votedPlayers >= totalPlayers;
  const modeSelected   = state.lobbyMode !== null;
  const startDisabled  = inGamePlayers.length > 0 || !modeSelected;
  const startStyle     = startDisabled ? ' style="opacity:0.45;cursor:not-allowed"' : '';

  wrap.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn-primary" id="start-game-btn"${startStyle}>Start game →</button>
      </div>
      ${!modeSelected ? `<span style="font-size:12px;color:var(--text3);">Select a game mode to start</span>` : ''}
      ${modeSelected  ? `<span style="font-size:12px;color:${allVoted?'#27ae60':'var(--text3)'};">${votedPlayers}/${totalPlayers} players voted</span>` : ''}
      ${inGamePlayers.length > 0 ? `<span style="font-size:12px;color:#e05151;">Waiting for ${inGamePlayers.length} player${inGamePlayers.length>1?'s':''} to return<span id="return-dots"></span></span>` : ''}
    </div>`;

  document.getElementById('start-game-btn')?.addEventListener('click', () => {
    if (modeSelected && !startDisabled) startGame();
  });
  if (inGamePlayers.length > 0) startDots('return-dots', 'returnDots');
}

async function startGame() {
  if (!state.isHost) return;
  const allPlayers = Object.values(state.lastKnownPlayers);
  const inGamePlayers = allPlayers.filter(p => p.inGame && !p.isHost);
  if (inGamePlayers.length > 0) { showToast(`Waiting for players to return from the game.`); return; }
  const votedCount = allPlayers.filter(p => p.vote).length;
  if (votedCount === 0) { showToast('At least one player must vote for a puzzle before starting.'); return; }
  if (votedCount < allPlayers.length) {
    const msg = document.getElementById('start-anyway-msg');
    if (msg) msg.textContent = `${votedCount} of ${allPlayers.length} players have voted. Start the game anyway?`;
    openOverlay('start-anyway-overlay');
    return;
  }
  await _doStartGame();
}

async function doStartGame() {
  closeOverlay('start-anyway-overlay');
  await _doStartGame();
}

async function _doStartGame() {
  const players = Object.values(state.lastKnownPlayers);
  const dateCounts = {};
  players.forEach(p => {
    if (p.vote) {
      if (!dateCounts[p.vote]) dateCounts[p.vote] = { count: 0, meta: p.voteMeta || {} };
      dateCounts[p.vote].count++;
    }
  });

  let chosenDateKey;
  const entries = Object.entries(dateCounts).sort((a,b) => b[1].count - a[1].count);
  if (!entries.length) {
    chosenDateKey = pickRandomPuzzle('standard', 'medium') || '1994/3/28';
  } else {
    const maxVotes = entries[0][1].count;
    const tiedEntries = entries.filter(([,v]) => v.count === maxVotes);
    let resolvedKey;
    if (tiedEntries.length > 1) {
      // Simple random tiebreak (no animation in modular version to keep it light)
      resolvedKey = tiedEntries[Math.floor(Math.random() * tiedEntries.length)][0];
    } else {
      resolvedKey = entries[0][0];
    }
    if (resolvedKey && resolvedKey.startsWith('combo:')) {
      const parts = resolvedKey.split(':');
      chosenDateKey = pickRandomPuzzle(parts[1] || 'standard', parts[2] || 'medium') || '1994/3/28';
    } else {
      chosenDateKey = resolvedKey;
    }
  }

  const btn = document.querySelector('#start-btn-wrap .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading puzzle…'; }

  try {
    const rawData = await fetchNytPuzzle(chosenDateKey);
    const puzzle  = parseNytPuzzle(rawData, chosenDateKey);
    sessionStorage.setItem('soloPuzzle', JSON.stringify(puzzle));
    sessionStorage.setItem('gameMode', state.lobbyMode || 'together');
    sessionStorage.setItem('puzzleDateKey', chosenDateKey);
    await startLobbyGame(state.activeLobbyCode, chosenDateKey, state.lobbyMode);
    window.location.href = 'game.html';
  } catch (e) {
    showToast('Failed to load puzzle: ' + e.message.slice(0, 60));
    if (btn) { btn.disabled = false; btn.textContent = 'Start game →'; }
  }
}

// ── Firebase lobby subscription ──
function enterLobbyScreen() {
  const codeEl = document.getElementById('lobby-banner-code');
  if (codeEl) codeEl.textContent = state.activeLobbyCode;
  const copyLbl = document.getElementById('banner-copy-label');
  if (copyLbl) copyLbl.textContent = 'Copy link';
  applyCodeVisibility();

  // Clear chat
  const chatContainer = document.getElementById('chat-messages');
  if (chatContainer) {
    chatContainer.innerHTML = '';
    chatContainer.dataset.count = '0';
    const empty = document.getElementById('chat-empty');
    if (empty) { empty.style.display = 'flex'; chatContainer.appendChild(empty); }
  }

  state.myVote = null;
  state.myVoteMeta = { size: 'standard', diff: 'medium' };
  setIdentityLocked(false);
  initLobbyIdentityEditor();

  // Immediate snapshot for late-joiners
  if (window._fb) {
    const { get, ref, db } = window._fb;
    get(ref(db, `lobbies/${state.activeLobbyCode}`)).then(snap => {
      if (!snap.exists()) return;
      const data = snap.val();
      const players = data.players || {};
      state.lastKnownPlayers = {};
      Object.entries(players).forEach(([id, p]) => {
        state.lastKnownPlayers[id] = { name:p.name, colorHex:p.colorHex, avatar:p.avatar||null, vote:p.vote||null, voteMeta:p.voteMeta||null, isHost:p.isHost||false };
        if (id === state.myPlayerId) {
          state.isHost = p.isHost || false;
          if (p.vote) { state.myVote = p.vote; state.myVoteMeta = p.voteMeta || { size:'standard', diff:'medium' }; setIdentityLocked(true); }
        }
      });
      renderPlayerList(); renderVoteGrid(); renderStartBtn(); refreshLobbySwatches();
    }).catch(() => {});
  }

  subscribeLobbyFB();
  subscribeChatFB();
  window.scrollTo(0, 0);
}

function subscribeLobbyFB() {
  if (lobbyListener) { lobbyListener(); lobbyListener = null; }
  lobbyListener = subscribeLobby(state.activeLobbyCode, snap => {
    if (!snap.exists()) { showToast('Lobby closed.'); leaveLobby(); return; }
    const data = snap.val();
    state.lastLobbyData = data;
    const players = data.players || {};
    state.lastKnownPlayers = {};
    let stillInLobby = false;
    Object.entries(players).forEach(([id, p]) => {
      state.lastKnownPlayers[id] = { name:p.name, colorHex:p.colorHex, avatar:p.avatar||null, vote:p.vote||null, voteMeta:p.voteMeta||null, isHost:p.isHost||false, inGame:p.inGame||false };
      if (id === state.myPlayerId) {
        state.isHost = p.isHost || false;
        stillInLobby = true;
        if (p.vote) { state.myVote = p.vote; state.myVoteMeta = p.voteMeta || { size:'standard', diff:'medium' }; setIdentityLocked(true); }
        else { state.myVote = null; setIdentityLocked(false); }
      }
    });

    // Kicked detection
    if (state.myPlayerId && !stillInLobby) {
      if (lobbyListener) { lobbyListener(); lobbyListener = null; }
      state.activeLobbyCode = null; state.myPlayerId = null; state.isHost = false;
      showToast('You were kicked from the lobby.');
      window.location.href = 'index.html';
      return;
    }

    // Game started — redirect to game.html
    if (data.status === 'started' && data.puzzleDateKey) {
      const gameIsEnded = data.gameSettings?.gameEnded === true;
      const anyoneInGame = Object.values(players).some(p => p?.inGame);
      if (!gameIsEnded && anyoneInGame && !state.isHost) {
        sessionStorage.setItem('gameMode', data.gameMode || 'together');
        sessionStorage.setItem('puzzleDateKey', data.puzzleDateKey);
        window.location.href = 'game.html';
        return;
      }
    }

    if (data.gameMode && data.gameMode !== state.lobbyMode) setLobbyMode(data.gameMode, true);

    renderPlayerList();
    renderVoteGrid();
    renderStartBtn();
    refreshLobbySwatches();

    // Auto host transfer if host left
    const hostPresent = Object.values(state.lastKnownPlayers).some(p => p.isHost);
    if (!hostPresent && !state.isHost && state.activeLobbyCode && state.myPlayerId) {
      const ids = Object.keys(state.lastKnownPlayers).sort();
      if (ids.length > 0 && ids[0] === state.myPlayerId) {
        state.isHost = true;
        transferHost(state.activeLobbyCode, state.myPlayerId, null).catch(() => {});
        renderStartBtn();
      }
    }
  });
}

function subscribeChatFB() {
  if (chatListener) { chatListener(); chatListener = null; }
  chatListener = subscribeChat(state.activeLobbyCode, snap => {
    renderChat(snap.val() || {});
  });
}

// ── Leave lobby ──
async function leaveLobby() {
  if (lobbyListener) { lobbyListener(); lobbyListener = null; }
  if (chatListener)  { chatListener();  chatListener  = null; }
  if (state.activeLobbyCode && state.myPlayerId) {
    try {
      if (state.isHost) {
        const others = Object.keys(state.lastKnownPlayers).filter(id => id !== state.myPlayerId);
        if (others.length > 0) {
          await transferHost(state.activeLobbyCode, others[Math.floor(Math.random() * others.length)], state.myPlayerId);
        } else {
          await removeLobby(state.activeLobbyCode);
        }
      }
      await removePlayer(state.activeLobbyCode, state.myPlayerId);
    } catch {}
  }
  state.activeLobbyCode = null; state.myPlayerId = null; state.isHost = false; state.lastLobbyData = null;
  state.myVote = null; state.lastKnownPlayers = {};
  window.location.href = 'index.html';
}

// ── Settings ──
function openSettings() {
  if (!state.isHost) return;
  openOverlay('settings-overlay');
}

function saveSettings() {
  const settings = {
    hideCode:     document.getElementById('s-hide-code')?.checked,
    disableChat:  document.getElementById('s-disable-chat')?.checked,
    hostOverrule: document.getElementById('s-host-overrule')?.checked,
  };
  if (settings.hideCode) applyCodeVisibility();
  const chatInputRow = document.querySelector('.chat-input-row');
  const chatInput    = document.getElementById('chat-input');
  if (chatInputRow) chatInputRow.style.display = settings.disableChat ? 'none' : '';
  if (chatInput)    chatInput.disabled = settings.disableChat;
  closeOverlay('settings-overlay');
  showToast('Settings saved');
}

// ── Init ──
function init() {
  // Restore state from sessionStorage if in-memory state was lost (e.g. page navigation)
  if (!state.activeLobbyCode || !state.myPlayerId) {
    try {
      const saved = JSON.parse(sessionStorage.getItem('lobbyState') || 'null');
      if (saved && saved.activeLobbyCode && saved.myPlayerId) {
        state.activeLobbyCode = saved.activeLobbyCode;
        state.myPlayerId      = saved.myPlayerId;
        state.isHost          = saved.isHost || false;
        state.playerName      = saved.playerName || state.playerName;
        state.pixelAvatarData = saved.pixelAvatarData || null;
        if (saved.playerColorHex) {
          const found = COLORS.find(c => c.hex === saved.playerColorHex);
          if (found) state.playerColor = found;
        }
      }
    } catch {}
  }

  if (!state.activeLobbyCode || !state.myPlayerId) {
    window.location.href = 'index.html';
    return;
  }

  enterLobbyScreen();

  // Wire buttons
  document.getElementById('btn-leave-lobby')?.addEventListener('click', leaveLobby);
  document.getElementById('btn-settings')?.addEventListener('click', openSettings);
  document.getElementById('settings-save-btn')?.addEventListener('click', saveSettings);
  document.getElementById('settings-cancel-btn')?.addEventListener('click', () => closeOverlay('settings-overlay'));
  document.getElementById('btn-banner-copy')?.addEventListener('click', bannerCopy);
  document.getElementById('code-hide-btn')?.addEventListener('click', toggleCodeVisibility);
  document.getElementById('banner-reveal-overlay')?.addEventListener('click', revealCode);
  document.getElementById('lobby-name-input')?.addEventListener('input', onLobbyNameInput);
  document.getElementById('lobby-name-input')?.addEventListener('blur', saveLobbyIdentity);
  document.getElementById('lobby-name-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  document.getElementById('lobby-avatar')?.addEventListener('click', openLobbyPixelOverlay);
  document.getElementById('chat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
  document.getElementById('chat-input')?.addEventListener('input', e => {
    const btn = document.getElementById('chat-send');
    if (btn) btn.disabled = !e.target.value.trim();
  });
  document.getElementById('chat-send')?.addEventListener('click', sendChat);
  document.getElementById('lobby-pixel-cancel')?.addEventListener('click', lobbyCancel);
  document.getElementById('lobby-pixel-save')?.addEventListener('click', saveLobbyPixelAvatar);
  document.getElementById('start-anyway-confirm')?.addEventListener('click', doStartGame);
  document.getElementById('start-anyway-cancel')?.addEventListener('click', () => closeOverlay('start-anyway-overlay'));

  // Mode cards
  document.getElementById('mode-card-together')?.addEventListener('click', () => setLobbyMode('together'));
  document.getElementById('mode-card-versus')?.addEventListener('click', () => setLobbyMode('versus'));

  // Lobby size / diff
  document.querySelectorAll('.lobby-size-btn').forEach(b => b.addEventListener('click', () => setLobbySize(b.dataset.size)));
  document.querySelectorAll('.lobby-diff-btn').forEach(b => b.addEventListener('click', () => setLobbyDiff(b.dataset.diff)));

  // Context menu actions
  document.getElementById('player-ctx-give-host')?.addEventListener('click', () => ctxAction('giveHost'));
  document.getElementById('player-ctx-kick')?.addEventListener('click', () => ctxAction('kick'));
}

function waitAndInit() {
  if (window._fbReady) init();
  else document.addEventListener('fb-ready', init, { once: true });
}

// Expose to window for any remaining HTML handler refs
window.leaveLobby       = leaveLobby;
window.bannerCopy       = bannerCopy;
window.toggleCodeVisibility = toggleCodeVisibility;
window.revealCode       = revealCode;
window.onLobbyNameInput = onLobbyNameInput;
window.saveLobbyIdentity = saveLobbyIdentity;
window.openLobbyPixelOverlay = openLobbyPixelOverlay;
window.lobbyCancel      = lobbyCancel;
window.saveLobbyPixelAvatar = saveLobbyPixelAvatar;
window.setLobbyMode     = setLobbyMode;
window.setLobbySize     = setLobbySize;
window.setLobbyDiff     = setLobbyDiff;
window.castLobbyVote    = castLobbyVote;
window.removeVote       = removeVote;
window.startGame        = startGame;
window.doStartGame      = doStartGame;
window.joinActiveMatch  = joinActiveMatch;
window.setGameInProgressLock = setGameInProgressLock;
window.unlockGamePanels = unlockGamePanels;
window.openSettings     = openSettings;
window.saveSettings     = saveSettings;
window.ctxAction        = ctxAction;
window.closeOverlay     = closeOverlay;

waitAndInit();
