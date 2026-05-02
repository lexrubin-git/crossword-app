// ── lobby.controller.js ──
import { state, COLORS, showToast, takenColorHexes, chatNameColor } from '../state.js';
import { buildColorSwatches, updateChip, openOverlay, closeOverlay, openAvatarLightbox, startDots, stopDots } from '../ui.helpers.js';
import { mountDrawBlock, bakeAvatarDataUrl, drawVectorCanvas, updateAvatarPreview } from '../pixel-art.js';
import {
  updatePlayer, removePlayer, transferHost, setLobbyMode as setLobbyModeFB,
  castVote, removeVoteFB, sendChatMessage, startLobbyGame, removeLobby,
  subscribeLobby, subscribeChat, pruneStaleLobbies,
  registerPlayerDisconnect, cancelPlayerDisconnect
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

// ── Leave confirm overlay ──
function showLeaveConfirm() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div style="background:var(--card-bg);border:0.5px solid var(--border2);border-radius:14px;padding:28px 28px 24px;max-width:320px;width:90%;display:flex;flex-direction:column;gap:12px">
        <div style="font-size:16px;font-weight:700;color:var(--text)">Leave lobby?</div>
        <div style="font-size:13px;color:var(--text3);line-height:1.5">Go back to home page? You can always rejoin the lobby.</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
          <button id="leave-cancel-btn" class="btn-ghost" style="font-size:13px">Stay</button>
          <button id="leave-confirm-btn" style="font-size:13px;padding:7px 16px;background:#e05151;color:var(--bg);border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:600">Leave →</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#leave-cancel-btn').addEventListener('click', () => { overlay.remove(); resolve(false); });
    overlay.querySelector('#leave-confirm-btn').addEventListener('click', () => { overlay.remove(); resolve(true); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
  });
}

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
    const btn = document.getElementById('btn-banner-copy');
    if (btn) {
      btn.style.color = '#27ae60';
      btn.style.borderColor = 'rgba(39,174,96,0.4)';
      setTimeout(() => { btn.style.color = ''; btn.style.borderColor = ''; }, 2000);
    }
  });
}

// ── Identity editor ──
function initLobbyIdentityEditor() {
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
    av.style.backgroundPosition = 'center';
    av.style.backgroundColor = playerColor.hex;
    av.style.border = `3px solid ${playerColor.hex}`;
    av.textContent = '';
  } else {
    av.style.backgroundImage = '';
    av.style.backgroundSize = '';
    av.style.border = `3px solid ${playerColor.hex}`;
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
  const prevAvatar = state.pixelAvatarData;
  state.playerName = val;
  updateLobbyAvatar();
  updateChip();
  if (state.lastKnownPlayers[state.myPlayerId]) {
    state.lastKnownPlayers[state.myPlayerId].name     = state.playerName;
    state.lastKnownPlayers[state.myPlayerId].colorHex = state.playerColor.hex;
    state.lastKnownPlayers[state.myPlayerId].avatar = state.pixelAvatarData || null;
    renderPlayerList();
    renderVoteGrid();
  }
  if (state.playerColor.hex !== prevColor || state.pixelAvatarData !== prevAvatar) {
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
  mountDrawBlock('lobby-canvas-slot', state.pixelAvatarData || null);
  openOverlay('lobby-pixel-overlay');
}

function lobbyCancel() { closeOverlay('lobby-pixel-overlay'); }

async function saveLobbyPixelAvatar() {
  const avatarData = bakeAvatarDataUrl();
  if (avatarData) state.pixelAvatarData = avatarData;
  updateLobbyAvatar();
  closeOverlay('lobby-pixel-overlay');
  if (state.lastKnownPlayers[state.myPlayerId]) {
    state.lastKnownPlayers[state.myPlayerId].avatar   = state.pixelAvatarData || null;
    state.lastKnownPlayers[state.myPlayerId].colorHex = state.playerColor.hex;
    state.lastKnownPlayers[state.myPlayerId].name     = state.playerName;
  }
  _lastPlayerListKey = '';
  renderPlayerList();
  renderVoteGrid();
  repaintLobbyChatColor(state.myPlayerId, state.playerName, state.playerColor.hex);
  updateChip();
  if (state.activeLobbyCode && state.myPlayerId) {
    updatePlayer(state.activeLobbyCode, state.myPlayerId, {
      name: state.playerName,
      colorHex: state.playerColor.hex,
      avatar: state.pixelAvatarData || null,
    }).catch(() => {});
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
    try {
      await removePlayer(state.activeLobbyCode, _ctxTargetId);
      delete state.lastKnownPlayers[_ctxTargetId];
      _lastPlayerListKey = '';
      renderPlayerList();
      renderVoteGrid();
      renderStartBtn();
      refreshLobbySwatches();
      showToast('Player kicked.');
    } catch { showToast('Could not kick player.'); }
  } else if (action === 'giveHost') {
    try {
      await transferHost(state.activeLobbyCode, _ctxTargetId, state.myPlayerId);
      state.isHost = false;
      if (state.lastKnownPlayers[state.myPlayerId]) state.lastKnownPlayers[state.myPlayerId].isHost = false;
      if (state.lastKnownPlayers[_ctxTargetId]) state.lastKnownPlayers[_ctxTargetId].isHost = true;
      _lastPlayerListKey = '';
      renderPlayerList();
      showToast('Host transferred.');
      renderStartBtn();
    }
    catch { showToast('Could not transfer host.'); }
  }
  _ctxTargetId = null;
}

function renderPlayerList() {
  const players = Object.entries(state.lastKnownPlayers);
  const countEl = document.getElementById('player-count');
  if (countEl) countEl.textContent = players.length;

  const subtitleEl = document.getElementById('lobby-subtitle');

  console.log('renderPlayerList called, players:', JSON.stringify(players));
  const newKey = players.map(([id, p]) => `${id}:${p.name||''}:${p.colorHex}:${p.avatar||''}:${p.isHost?1:0}:${p.vote?1:0}:${p.inGame?1:0}`).join('|');
  if (newKey === _lastPlayerListKey) return;
  _lastPlayerListKey = newKey;

  const list = document.getElementById('player-list');
  if (!list) return;
  list.innerHTML = '';
  players.forEach(([id, p]) => {
    const displayName = p.name || (id === state.myPlayerId ? state.playerName : 'Player');
    const isMe = id === state.myPlayerId;
    const canCtx = state.isHost && !isMe;
    const row = document.createElement('div');
    row.className = 'player-row';
    if (isMe) row.classList.add('is-me');
    row.innerHTML = `
      <div class="player-dot" style="background:${p.colorHex};flex-shrink:0"></div>
      <div style="flex:1;min-width:0"><span style="font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${displayName}</span></div>
      <div style="display:flex;align-items:center;gap:4px;margin-left:auto">
        ${p.isHost ? '<span class="player-badge host" style="margin-left:0">host</span>' : ''}
        ${p.inGame ? '<span class="player-badge in-game" style="margin-left:0">in game</span>' : ''}
        ${canCtx ? `<button class="player-dots-btn" title="Player options">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
        </button>` : ''}
      </div>
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
    if (avatarEl) {
      const newAvatar = state.pixelAvatarData || null;
      if (newAvatar) {
        avatarEl.style.backgroundImage = `url(${newAvatar})`;
        avatarEl.style.backgroundSize  = 'cover';
        avatarEl.style.backgroundColor = newHex;
        avatarEl.style.border          = `2px solid ${newHex}`;
        avatarEl.style.boxSizing       = 'border-box';
        avatarEl.textContent           = '';
        avatarEl.dataset.avatar        = newAvatar;
      } else {
        avatarEl.style.backgroundImage = '';
        avatarEl.style.border          = '';
        avatarEl.style.backgroundColor = newHex;
        avatarEl.textContent           = (name || '?').charAt(0).toUpperCase();
        avatarEl.dataset.avatar        = '';
      }
      avatarEl.dataset.color = newHex;
      avatarEl.dataset.name  = name;
    }
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
  state.myVoteMeta = null;
  if (state.lastKnownPlayers[state.myPlayerId]) {
    state.lastKnownPlayers[state.myPlayerId].vote = null;
    state.lastKnownPlayers[state.myPlayerId].voteMeta = null;
  }
  lobbySize = null; lobbyDiff = null;
  document.querySelectorAll('.lobby-size-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.lobby-diff-btn').forEach(b => b.classList.remove('active'));
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

  const votesCard = document.getElementById('current-votes-card');
  if (!Object.keys(dateCounts).length) {
    if (votesCard) votesCard.style.display = 'none';
    return;
  }
  if (votesCard) votesCard.style.display = '';

  Object.entries(dateCounts).sort((a,b) => b[1].voters.length - a[1].voters.length)
    .forEach(([dateKey, {voters, meta}]) => {
      const isMyVote = state.myVote === dateKey;
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;transition:background .15s;`;
      if (grid.children.length > 0) row.style.borderTop = '0.5px solid var(--border)';
      // FIX 1: clicking your own vote row deselects it
      row.addEventListener('click', () => {
        if (isMyVote) removeVote();
        else castVoteForDateKey(dateKey, meta.size, meta.diff);
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
  // If deselecting game mode, also remove vote
  if (mode === null) { removeVote(); lobbySize = null; lobbyDiff = null; document.querySelectorAll('.lobby-size-btn').forEach(b => b.classList.remove('active')); document.querySelectorAll('.lobby-diff-btn').forEach(b => b.classList.remove('active')); }
  const togetherCard = document.getElementById('mode-card-together');
  const versusCard   = document.getElementById('mode-card-versus');
  const selBg = 'rgba(212,160,23,0.06)', selText = '#d4a017';
  if (togetherCard && versusCard) {
    togetherCard.style.background = mode === 'together' ? selBg : 'var(--bg2)';
    togetherCard.style.borderTop = mode === 'together' ? '2px solid rgba(212,160,23,0.7)' : '2px solid transparent';
    togetherCard.style.padding = '12px 14px 16px';
    const t1 = togetherCard.children[0], t2 = togetherCard.children[1];
    if (t1) t1.style.color = mode === 'together' ? selText : 'var(--text)';
    if (t2) t2.style.color = mode === 'together' ? 'rgba(212,160,23,0.5)' : 'var(--text2)';
    versusCard.style.background = mode === 'versus' ? selBg : 'var(--bg2)';
    versusCard.style.borderTop = mode === 'versus' ? '2px solid rgba(212,160,23,0.7)' : '2px solid transparent';
    versusCard.style.padding = '12px 14px 16px';
    const v1 = versusCard.children[0], v2 = versusCard.children[1];
    if (v1) v1.style.color = mode === 'versus' ? selText : 'var(--text)';
    if (v2) v2.style.color = mode === 'versus' ? 'rgba(212,160,23,0.5)' : 'var(--text2)';
  }
  const rankedCard = document.getElementById('mode-card-ranked');
  if (rankedCard) {
    rankedCard.style.background = mode === 'ranked' ? selBg : 'var(--bg2)';
    rankedCard.style.borderTop = mode === 'ranked' ? '2px solid rgba(212,160,23,0.7)' : '2px solid transparent';
    const rTitle = rankedCard.querySelector('div > div') || rankedCard.querySelector('div');
    if (rTitle) {
      rTitle.style.color = mode === 'ranked' ? selText : 'var(--text)';
      if (!rankedCard.dataset.renamed) {
        rankedCard.dataset.renamed = '1';
        // Rename all text nodes that say "Ranked" anywhere in the card
        rankedCard.querySelectorAll('*').forEach(el => {
          if (el.children.length === 0 && el.textContent.trim() === 'Ranked') {
            el.textContent = 'Race the Clock';
          }
        });
        if (rTitle.textContent.trim() === 'Ranked') rTitle.textContent = 'Race the Clock';
      }
    }
    const rDesc = rankedCard.children[1];
    if (rDesc) rDesc.style.color = mode === 'ranked' ? 'rgba(212,160,23,0.5)' : 'var(--text2)';
  }

  if (state.isHost && state.activeLobbyCode) {
    setLobbyModeFB(state.activeLobbyCode, mode || '').catch(() => {});
  }
  renderStartBtn();
}

function setLobbySize(size) {
  if (lobbySize === size) {
    lobbySize = null;
    lobbyDiff = null;
    document.querySelectorAll('.lobby-size-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.lobby-diff-btn').forEach(b => b.classList.remove('active'));
    removeVote();
    return;
  }
  lobbySize = size;
  document.querySelectorAll('.lobby-size-btn').forEach(b => b.classList.toggle('active', b.dataset.size === size));
  const standardDiff = document.getElementById('lobby-diff-standard');
  const largeDiff    = document.getElementById('lobby-diff-large');
  if (size === 'large') {
    if (standardDiff) standardDiff.style.display = 'none';
    if (largeDiff) largeDiff.style.display = 'flex';
    lobbyDiff = 'medium';
    castLobbyVote(); // large always has medium, so vote immediately
  } else {
    if (standardDiff) standardDiff.style.display = 'flex';
    if (largeDiff) largeDiff.style.display = 'none';
    // For standard, only cast vote once difficulty is also selected
    if (lobbyDiff) castLobbyVote();
  }
}

function setLobbyDiff(diff) {
  if (lobbyDiff === diff) {
    lobbyDiff = null;
    document.querySelectorAll('.lobby-diff-btn').forEach(b => b.classList.remove('active'));
    if (state.activeLobbyCode && state.myPlayerId) removeVoteFB(state.activeLobbyCode, state.myPlayerId).catch(() => {});
    state.myVote = null; state.myVoteMeta = null;
    if (state.lastKnownPlayers[state.myPlayerId]) { state.lastKnownPlayers[state.myPlayerId].vote = null; state.lastKnownPlayers[state.myPlayerId].voteMeta = null; }
    setIdentityLocked(false); renderVoteGrid(); if (state.isHost) renderStartBtn();
    return;
  }
  if (!lobbySize) {
    lobbySize = 'standard';
    document.querySelectorAll('.lobby-size-btn').forEach(b => b.classList.toggle('active', b.dataset.size === 'standard'));
    const standardDiff = document.getElementById('lobby-diff-standard');
    const largeDiff = document.getElementById('lobby-diff-large');
    if (standardDiff) standardDiff.style.display = 'flex';
    if (largeDiff) largeDiff.style.display = 'none';
  }
  lobbyDiff = diff;
  document.querySelectorAll('.lobby-diff-btn').forEach(b => b.classList.toggle('active', b.dataset.diff === diff));
  castLobbyVote();
}

// ── Start button ──
async function joinActiveMatch() {
  if (!state.activeLobbyCode || !window._fb) return;
  try {
    const { get, set, ref, db } = window._fb;
    const snap = await get(ref(db, `lobbies/${state.activeLobbyCode}`));
    if (!snap.exists()) return;
    const data = snap.val();
    if (data.status !== 'started' || !data.puzzleDateKey) { showToast('No active match to join.'); return; }
    if (data.gameSettings?.gameEnded) { showToast('That match has already ended.'); return; }
    // Ensure this player exists in the lobby before joining the game
    if (state.myPlayerId) {
      await set(ref(db, `lobbies/${state.activeLobbyCode}/players/${state.myPlayerId}`), {
        name: state.playerName,
        colorHex: state.playerColor.hex,
        avatar: state.pixelAvatarData || null,
        vote: null, voteMeta: null,
        isHost: false, inGame: false,
      }).catch(() => {});
    }
    sessionStorage.setItem('gameMode', data.gameMode || 'together');
    sessionStorage.setItem('puzzleDateKey', data.puzzleDateKey);
    // Fetch fresh player list before navigating so new joiner sees correct names/colors
    if (window._fb) {
      const { get: get2, ref: ref2, db: db2 } = window._fb;
      get2(ref2(db2, `lobbies/${state.activeLobbyCode}/players`)).then(snap2 => {
        const freshPlayers = snap2.val() || {};
        const merged = {};
        Object.entries(freshPlayers).forEach(([id, p]) => {
          if (!p) return;
          merged[id] = {
            name: (p.name && p.name.trim()) ? p.name.trim() : 'Player',
            colorHex: (p.colorHex && p.colorHex !== '#888' && p.colorHex !== '#888888') ? p.colorHex : '#888888',
            avatar: p.avatar !== undefined ? p.avatar : null,
            isHost: typeof p.isHost === 'boolean' ? p.isHost : false,
            inGame: p.inGame || false,
          };
        });
        try { sessionStorage.setItem('lastKnownPlayers', JSON.stringify(merged)); } catch {}
        window.location.href = 'game.html';
      }).catch(() => { window.location.href = 'game.html'; });
    } else {
      window.location.href = 'game.html';
    }
  } catch { showToast('Could not join match.'); }
}

function renderStartBtn() {
  const wrap = document.getElementById('start-btn-wrap');
  if (!wrap) return;

  const data = state.lastLobbyData;
  const players = Object.values(state.lastKnownPlayers);
  const totalPlayers = players.length;
  const votedPlayers = players.filter(p => p.vote).length;
  const allVoted     = totalPlayers > 0 && votedPlayers >= totalPlayers;

  const votedC = document.getElementById('footer-voted-count');
  const totalC = document.getElementById('footer-total-count');
  if (votedC) votedC.textContent = votedPlayers;
  if (totalC) totalC.textContent = totalPlayers;

  const allPlayersInLobby = Object.values(state.lastKnownPlayers).every(p => !p.inGame);
  if (data && data.status === 'started' && data.puzzleDateKey && !allPlayersInLobby) {
    const gameIsEnded = data.gameSettings?.gameEnded === true;
    if (!gameIsEnded) {
      if (!document.getElementById('join-active-btn')) {
        wrap.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:stretch;gap:8px">
              <button id="join-active-btn" style="justify-content:center;background:#2a2a2a;color:#ccc;border-radius:8px;padding:8px 16px;font-size:13px;font-family:inherit;font-weight:600;cursor:pointer;letter-spacing:.01em;border:1.5px solid rgba(210,210,210,0);animation:join-btn-pulse 1.8s ease-in-out infinite;">
                Join active match<span id="join-active-dots" style="display:inline-block;width:1.4em;text-align:left;vertical-align:bottom;font-size:1em;letter-spacing:0.06em;line-height:inherit;margin-bottom:0.0em"></span>
              </button>
              <style>
                @keyframes join-btn-pulse { 0%,100%{border-color:rgba(210,210,210,0.7)} 50%{border-color:rgba(210,210,210,0)} }
              </style>
              ${state.isHost ? `<button id="lobby-forfeit-active-btn" class="btn-ghost" style="flex-shrink:0;font-size:13px;color:#e05151;border-color:rgba(224,81,81,0.5);">Forfeit</button>` : ''}
            </div>
          </div>`;
        document.getElementById('join-active-btn')?.addEventListener('click', joinActiveMatch);
        startDots('join-active-dots', 'joinActiveDots');
        document.getElementById('lobby-forfeit-active-btn')?.addEventListener('click', () => {
        if (!state.activeLobbyCode || !window._fb) return;
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)';
        overlay.innerHTML = `
          <div style="background:var(--card-bg);border:0.5px solid var(--border2);border-radius:14px;padding:28px 28px 24px;max-width:320px;width:90%;display:flex;flex-direction:column;gap:12px">
            <div style="font-size:16px;font-weight:700;color:var(--text)">Forfeit game?</div>
            <div style="font-size:13px;color:var(--text3);line-height:1.5">This will end the current game for all players immediately.</div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
              <button id="lobby-forfeit-cancel" class="btn-ghost" style="font-size:13px">Cancel</button>
              <button id="lobby-forfeit-confirm" style="font-size:13px;padding:7px 16px;background:#e05151;color:var(--bg);border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:600">Forfeit →</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#lobby-forfeit-cancel').addEventListener('click', () => overlay.remove());
        overlay.querySelector('#lobby-forfeit-confirm').addEventListener('click', () => {
          overlay.remove();
          const { update, ref, db } = window._fb;
          update(ref(db, `lobbies/${state.activeLobbyCode}/gameSettings`), { gameEnded: true }).catch(() => {});
          showToast('Game ended.');
        });
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
      });
      startDots('game-progress-dots', 'gameProgress');
      setGameInProgressLock();
      } // end if !join-active-btn
      return;
    }
  }
  unlockGamePanels();

  // FIX 2: non-hosts see "waiting for host" + vote count below
  if (!state.isHost) {
    wrap.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <p style="font-size:13px;color:#999;margin:0">Waiting for host<span id="host-start-dots"></span></p>
          <span style="font-size:12px;color:${allVoted?'#27ae60':'#e05151'}">&nbsp;&nbsp;${votedPlayers}/${totalPlayers} players voted<span id="voted-dots" style="color:${allVoted?'#27ae60':'#e05151'}"></span></span>
        </div>
      </div>`;
    startDots('host-start-dots', 'hostStart');
    if (document.getElementById('voted-dots')) startDots('voted-dots', 'votedDots');
    return;
  }

  const inGamePlayers  = players.filter(p => p.inGame && !p.isHost);
  const modeSelected   = state.lobbyMode !== null;
  const puzzleSelected = players.some(p => p.vote);
  const rankedOk = state.lobbyMode !== 'ranked' || totalPlayers >= 2;
  const startDisabled  = inGamePlayers.length > 0 || !modeSelected || !puzzleSelected || !rankedOk;
  const startStyle     = startDisabled ? ' style="opacity:0.45;cursor:not-allowed"' : '';

  const gameActive = data && data.status === 'started' && !(data.gameSettings?.gameEnded);
  const showPull = inGamePlayers.length > 0;
  const showForfeit = false;
  wrap.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;gap:8px;align-items:stretch;flex-wrap:wrap">
        <button class="btn-primary" id="start-game-btn"${startStyle}>Start game →</button>
        ${showPull ? `<button class="btn-ghost" id="pull-players-btn" title="Pull players back to lobby" style="font-size:12px;color:#e05151;border-color:rgba(224,81,81,0.5);padding:7px 10px;display:flex;align-items:center;gap:5px;"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform:scaleX(-1)"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></button>` : ''}
        ${showForfeit ? `<button class="btn-ghost" id="lobby-forfeit-btn" style="font-size:12px;color:#e05151;border-color:#e05151">End game</button>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:12px;color:${allVoted?'#27ae60':'#e05151'}">${votedPlayers}/${totalPlayers} players voted<span id="voted-dots" style="color:${allVoted?'#27ae60':'#e05151'}"></span></span>
        ${inGamePlayers.length > 0 ? `<span style="font-size:12px;color:#e05151;">&nbsp;&nbsp;Waiting for ${inGamePlayers.length} player${inGamePlayers.length>1?'s':''}<span id="return-dots"></span></span>` : ''}
      </div>
    </div>`;

  document.getElementById('start-game-btn')?.addEventListener('click', () => {
    if (!startDisabled) { startGame(); return; }
    if (!rankedOk) {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)';
      overlay.innerHTML = `
        <div style="background:var(--card-bg);border:0.5px solid var(--border2);border-radius:14px;padding:28px 28px 24px;max-width:320px;width:90%;display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;align-items:center;gap:10px">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#e05151" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div style="font-size:15px;font-weight:700;color:var(--text)">Not enough players</div>
          </div>
          <div style="font-size:13px;color:var(--text3);line-height:1.5">Race the Clock mode requires at least <strong style="color:var(--text)">2 players</strong> to start.</div>
          <div style="display:flex;justify-content:flex-end;margin-top:4px">
            <button id="ranked-min-ok" style="font-size:13px;padding:7px 18px;background:var(--text);color:var(--bg);border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:600">Got it</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#ranked-min-ok').addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
      return;
    }
    const modeOverlay = document.getElementById('mode-missing-overlay');
    const puzzleOverlay = document.getElementById('puzzle-missing-overlay');
if (modeOverlay) { modeOverlay.style.pointerEvents = 'all'; modeOverlay.style.display = !modeSelected ? 'flex' : 'none'; if (!modeSelected) setTimeout(() => { modeOverlay.style.display = 'none'; modeOverlay.style.pointerEvents = 'none'; }, 1000); }
    if (puzzleOverlay) { puzzleOverlay.style.pointerEvents = 'all'; puzzleOverlay.style.display = !puzzleSelected ? 'flex' : 'none'; if (!puzzleSelected) setTimeout(() => { puzzleOverlay.style.display = 'none'; puzzleOverlay.style.pointerEvents = 'none'; }, 1000); }
  });
  if (inGamePlayers.length > 0) startDots('return-dots', 'returnDots');
  if (document.getElementById('voted-dots')) startDots('voted-dots', 'votedDots');
  document.getElementById('lobby-forfeit-btn')?.addEventListener('click', () => {
    if (!state.activeLobbyCode || !window._fb) return;
    if (!confirm('End the current game for all players?')) return;
    const { update, ref, db } = window._fb;
    update(ref(db, `lobbies/${state.activeLobbyCode}/gameSettings`), { gameEnded: true }).catch(() => {});
    showToast('Game ended.');
  });
  document.getElementById('pull-players-btn')?.addEventListener('click', () => {
    if (!state.activeLobbyCode || !window._fb) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)';
    overlay.innerHTML = `
      <div style="background:var(--card-bg);border:0.5px solid var(--border2);border-radius:14px;padding:28px 28px 24px;max-width:320px;width:90%;display:flex;flex-direction:column;gap:12px">
        <div style="font-size:15px;font-weight:700;color:var(--text)">Pull players from game?</div>
        <div style="font-size:13px;color:var(--text3);line-height:1.5">This will return all players to the lobby immediately.</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
          <button id="pull-players-cancel" class="btn-ghost" style="font-size:13px">Cancel</button>
          <button id="pull-players-confirm" style="font-size:13px;padding:7px 16px;background:#e05151;color:var(--bg);border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:600;display:flex;align-items:center;gap:6px;"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform:scaleX(-1)"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>Pull</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#pull-players-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#pull-players-confirm').addEventListener('click', async () => {
      overlay.remove();
      if (!window._fb) return;
      const { update, ref, db } = window._fb;
      try {
        const lobbyUpdates = { status: 'waiting', 'gameSettings/gameEnded': true, 'gameSettings/pullToLobby': Date.now() };
        Object.keys(state.lastKnownPlayers).forEach(id => {
          lobbyUpdates[`players/${id}/inGame`] = false;
        });
        await update(ref(db, `lobbies/${state.activeLobbyCode}`), lobbyUpdates);
        showToast('Players pulled back to lobby.');
      } catch { showToast('Could not pull players.'); }
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  });
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


 function showTiebreakerRoulette(options, nonHost = false, winnerKey = null) {
  return new Promise(resolve => {
    const n = options.length;
    const COLORS_WHEEL = ['#d4a017','#c0392b','#2980b9','#27ae60','#8e44ad','#e67e22','#16a085','#e74c3c'];
    const segColors = options.map((opt, i) => {
      const players = Object.values(state.lastKnownPlayers);
      const voter = players.find(p => p.vote === opt.key);
      return voter?.colorHex || COLORS_WHEEL[i % COLORS_WHEEL.length];
    });
    const segAngle = (2 * Math.PI) / n;

    const overlay = document.createElement('div');
    overlay.id = 'roulette-overlay';
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px`;

    const title = document.createElement('div');
    title.style.cssText = `color:var(--text,#e8e8e8);font-size:14px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;font-family:Inter,system-ui,sans-serif`;
    title.textContent = "It's a tie!";

    const card = document.createElement('div');
    card.style.cssText = `background:var(--card-bg,#1c1c1c);border:0.5px solid var(--border,#2e2e2e);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;align-items:center;font-family:Inter,system-ui,sans-serif`;

    const cardHeader = document.createElement('div');
    cardHeader.style.cssText = `width:100%;padding:12px 20px;border-bottom:0.5px solid var(--border,#2e2e2e);background:var(--bg3,#181818);display:flex;align-items:center;justify-content:space-between;box-sizing:border-box`;

    const cardBody = document.createElement('div');
    cardBody.style.cssText = `padding:28px;display:flex;flex-direction:column;align-items:center;gap:20px`;

    const pointerWrap = document.createElement('div');
    pointerWrap.style.cssText = `position:relative;width:420px;height:420px`;

    const pointer = document.createElement('div');
    pointer.style.cssText = `display:none`;

    const canvas = document.createElement('canvas');
    canvas.width = 420;
    canvas.height = 420;
    canvas.style.cssText = `border-radius:50%;display:block`;

    pointerWrap.appendChild(canvas);
    pointerWrap.appendChild(pointer);

    const subtitle = document.createElement('div');
    subtitle.style.cssText = `font-size:14px;color:#aaa;min-height:20px;text-align:center`;

    const headerRight = document.createElement('span');
    headerRight.style.cssText = `font-size:10px;color:var(--text3,#666);letter-spacing:.08em;font-family:Inter,system-ui,sans-serif`;
    cardHeader.appendChild(title);
    cardHeader.appendChild(headerRight);
    card.appendChild(cardHeader);
    cardBody.appendChild(pointerWrap);
    cardBody.appendChild(subtitle);
    card.appendChild(cardBody);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const ctx = canvas.getContext('2d');
    const cx = 210, cy = 210, r = 200, innerR = 30;

    function getLabel(opt) {
      const { size, diff } = opt.meta || {};
      const sl = size === 'large' ? '21×21' : '15×15';
      const dl = { easy:'Easy', medium:'Medium', hard:'Hard' }[diff] || diff || '';
      return `${sl} ${dl}`;
    }

    // Pre-load voter avatars
    const voterImages = options.map(opt => {
      const players = Object.values(state.lastKnownPlayers);
      const voter = players.find(p => p.vote === opt.key);
      if (voter?.avatar) {
        const img = new Image();
        img.src = voter.avatar;
        return { img, voter };
      }
      return { img: null, voter };
    });

    function darkenColor(hex, amount) {
      const num = parseInt(hex.replace('#',''), 16);
      const r = Math.max(0, (num >> 16) - Math.round(255 * amount));
      const g = Math.max(0, ((num >> 8) & 0xff) - Math.round(255 * amount));
      const b = Math.max(0, (num & 0xff) - Math.round(255 * amount));
      return `rgb(${r},${g},${b})`;
    }

    function drawPointer() {
      ctx.save();
      ctx.translate(cx, cy);
      const stemW = 8;
      const stemAngle = Math.asin(stemW / innerR);
      // Draw circle + arrow as one unified path
      ctx.beginPath();
      // Arrow tip
      ctx.moveTo(0, -(innerR + 36));
      // Right side of arrowhead
      ctx.lineTo(18, -(innerR + 8));
      ctx.lineTo(stemW, -(innerR + 8));
      // Arc from right stem down and around bottom back to left stem
      ctx.arc(0, 0, innerR, -(Math.PI / 2) + stemAngle, -(Math.PI / 2) - stemAngle + Math.PI * 2, false);
      // Left side of stem and arrowhead
      ctx.lineTo(-stemW, -(innerR + 8));
      ctx.lineTo(-18, -(innerR + 8));
      ctx.closePath();
      // Fill
      ctx.fillStyle = '#2a2a2a';
      ctx.fill();
      // Outline
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
    }

    function drawWheel(angle) {
      ctx.clearRect(0, 0, 420, 420);
      for (let i = 0; i < n; i++) {
        const start = angle + i * segAngle;
        const end = start + segAngle;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, start, end);
        ctx.closePath();
        ctx.fillStyle = segColors[i];
        ctx.fill();
        ctx.strokeStyle = darkenColor(segColors[i], 0.3);
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(start + segAngle / 2);
        // Label
        ctx.textAlign = 'right';
        ctx.fillStyle = darkenColor(segColors[i], 0.45);
        ctx.font = `bold ${n > 5 ? 11 : 13}px Inter, system-ui, sans-serif`;
        ctx.shadowBlur = 0;
        ctx.fillText(getLabel(options[i]), r - 12, -14);
        // Avatar
        const avatarR = 16;
        const avatarX = r - 60;
        const { img, voter } = voterImages[i];
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarX, 8, avatarR, 0, 2 * Math.PI);
        ctx.closePath();
        ctx.clip();
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, avatarX - avatarR, 8 - avatarR, avatarR * 2, avatarR * 2);
        } else {
          ctx.fillStyle = voter?.colorHex || '#888';
          ctx.fill();
          ctx.restore();
          // Border around default avatar
          ctx.save();
          ctx.beginPath();
          ctx.arc(avatarX, 8, avatarR, 0, 2 * Math.PI);
          ctx.strokeStyle = 'rgba(0,0,0,0.4)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(avatarX, 8, avatarR, 0, 2 * Math.PI);
          ctx.clip();
          ctx.fillStyle = '#fff';
          ctx.font = `bold 9px Inter, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.shadowBlur = 0;
          ctx.fillText((voter?.name || '?').charAt(0).toUpperCase(), avatarX, 8 + 3);
        }
        ctx.restore();
        ctx.restore();
      }
      drawPointer();
    }

    const winnerIdx = winnerKey
      ? options.findIndex(o => o.key === winnerKey)
      : Math.floor(Math.random() * options.length);
    const safeWinnerIdx = winnerIdx >= 0 ? winnerIdx : 0;

    const spins = 8;
    // Deterministic offset based on winnerKey so host and non-host match
    const seed = winnerKey ? winnerKey.split('').reduce((a, c) => a + c.charCodeAt(0), 0) : 0;
    const randomOffset = ((seed % 100) / 100 - 0.5) * segAngle * 0.6;
    // Arrow points up (-π/2). We want winner segment center at -π/2.
    // Segment i center is at: angle + i*segAngle + segAngle/2
    // So: angle + safeWinnerIdx*segAngle + segAngle/2 = -π/2
    // angle = -π/2 - safeWinnerIdx*segAngle - segAngle/2
    const targetAngle = -(spins * 2 * Math.PI) - Math.PI / 2 - (safeWinnerIdx * segAngle + segAngle / 2) + randomOffset;
    const duration = 7000;

    function easeOut(t) {
      // Cubic ease — fast start, clearly visible slowdown
      return 1 - Math.pow(1 - t, 3);
    }

    let startTime = null;

    function animate(ts) {
      if (!startTime) startTime = ts;
      const elapsed = ts - startTime;
      const t = Math.min(elapsed / duration, 1);
      const currentAngle = targetAngle * easeOut(t);
      drawWheel(currentAngle);

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        drawWheel(targetAngle);
        const winner = options[safeWinnerIdx];
        const winnerVoter = Object.values(state.lastKnownPlayers).find(p => p.vote === winner.key);
        title.innerHTML = `The wheel landed on <span style="color:${winnerVoter?.colorHex || '#d4a017'}">${winnerVoter?.name || 'a player'}</span>!`;
        setTimeout(() => {
          if (nonHost) {
            title.textContent = 'Starting game…';
            setTimeout(() => { overlay.remove(); }, 2000);
          } else {
            overlay.remove();
            resolve(winner.key);
          }
        }, 1800);
      }
    }

    drawWheel(0);
    requestAnimationFrame(animate);
  });
}
let _startGameInProgress = false;
async function _doStartGame() {
  if (_startGameInProgress) return;
  _startGameInProgress = true;
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
      const rouletteOptions = tiedEntries.map(([k, v]) => ({ key: k, meta: v.meta }));
      const winnerIdx = Math.floor(Math.random() * rouletteOptions.length);
      const winnerKey = rouletteOptions[winnerIdx].key;
      // Write options + winner to Firebase so non-hosts can run the same animation
      if (window._fb) {
        const { update, ref, db } = window._fb;
        try { await update(ref(db, `lobbies/${state.activeLobbyCode}`), {
          rouletteActive: true,
          rouletteWinnerKey: winnerKey,
          rouletteOptions: rouletteOptions.map(o => ({ key: o.key, size: o.meta?.size || '', diff: o.meta?.diff || '' }))
        }); } catch {}
      }
      // Resolve the actual puzzle date key NOW before animating, so all players get the same one
      const winnerMeta = rouletteOptions[winnerIdx].meta || {};
      const prePicked = winnerKey.startsWith('combo:')
        ? (pickRandomPuzzle(winnerMeta.size || 'standard', winnerMeta.diff || 'medium') || '1994/3/28')
        : winnerKey;

      // Write puzzle + roulette signal atomically so non-hosts have the key immediately
      if (window._fb) {
        const { update, ref, db } = window._fb;
        try { await update(ref(db, `lobbies/${state.activeLobbyCode}`), {
          rouletteActive: true,
          rouletteWinnerKey: winnerKey,
          rouletteOptions: rouletteOptions.map(o => ({ key: o.key, size: o.meta?.size || '', diff: o.meta?.diff || '' })),
          pendingPuzzleDateKey: prePicked
        }); } catch {}
      }

      resolvedKey = await showTiebreakerRoulette(rouletteOptions, false, winnerKey);
      if (window._fb) {
        const { update, ref, db } = window._fb;
        update(ref(db, `lobbies/${state.activeLobbyCode}`), { rouletteActive: false, rouletteWinnerKey: null, rouletteOptions: null }).catch(() => {});
      }
      // chosenDateKey is already determined — use prePicked directly
      chosenDateKey = prePicked;
    } else {
      resolvedKey = entries[0][0];
      if (resolvedKey && resolvedKey.startsWith('combo:')) {
        const parts = resolvedKey.split(':');
        chosenDateKey = pickRandomPuzzle(parts[1] || 'standard', parts[2] || 'medium') || '1994/3/28';
      } else {
        chosenDateKey = resolvedKey;
      }

      if (window._fb) {
        const { update, ref, db } = window._fb;
        try {
          await update(ref(db, `lobbies/${state.activeLobbyCode}`), {
            pendingPuzzleDateKey: chosenDateKey,
          });
        } catch {}
      }
    }
  }



  console.log('[START GAME] chosenDateKey:', chosenDateKey, 'isHost:', state.isHost);
  const btn = document.querySelector('#start-btn-wrap .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading puzzle…'; }

  try {
    const rawData = await fetchNytPuzzle(chosenDateKey);
    const puzzle  = parseNytPuzzle(rawData, chosenDateKey);
    sessionStorage.removeItem('soloPuzzle');
    sessionStorage.setItem('gameMode', state.lobbyMode || 'together');
    sessionStorage.setItem('puzzleDateKey', chosenDateKey);
    sessionStorage.setItem('freshGameStart', '1');
    const voteClears = {};
    Object.keys(state.lastKnownPlayers).forEach(id => {
      voteClears[`players/${id}/vote`] = null;
      voteClears[`players/${id}/voteMeta`] = null;
    });
    if (window._fb) {
      const { update, ref, db } = window._fb;
      try {
        await update(ref(db, `lobbies/${state.activeLobbyCode}`), {
          status: 'started',
          puzzleDateKey: chosenDateKey,
          pendingPuzzleDateKey: chosenDateKey,
          startedAt: window._fb.serverTimestamp(),
          gameMode: state.lobbyMode,
          rouletteActive: false,
          rouletteWinnerKey: null,
          rouletteOptions: null,
          ...voteClears,
        });
      } catch {}
    }
    // Write complete fresh player data right before navigating
    if (window._fb) {
      const { get, ref, db } = window._fb;
      get(ref(db, `lobbies/${state.activeLobbyCode}/players`)).then(snap => {
        const fresh = {};
        Object.entries(snap.val() || {}).forEach(([id, p]) => {
          if (!p) return;
          fresh[id] = {
            name: p.name || state.lastKnownPlayers[id]?.name || 'Player',
            colorHex: p.colorHex || state.lastKnownPlayers[id]?.colorHex || '#888888',
            avatar: p.avatar !== undefined ? p.avatar : (state.lastKnownPlayers[id]?.avatar || null),
            isHost: typeof p.isHost === 'boolean' ? p.isHost : false,
            inGame: p.inGame || false,
          };
        });
        console.log('[LOBBY PRE-NAV] writing lastKnownPlayers:', JSON.stringify(fresh));
        sessionStorage.setItem('lastKnownPlayers', JSON.stringify(fresh));
      }).catch(() => {
        try { sessionStorage.setItem('lastKnownPlayers', JSON.stringify(state.lastKnownPlayers)); } catch {}
      }).finally(() => { window.location.href = 'game.html'; });
    } else {
      try { sessionStorage.setItem('lastKnownPlayers', JSON.stringify(state.lastKnownPlayers)); } catch {}
      window.location.href = 'game.html';
    }
  } catch (e) {
    showToast('Failed to load puzzle: ' + e.message.slice(0, 60));
    if (btn) { btn.disabled = false; btn.textContent = 'Start game →'; }
    _startGameInProgress = false;
  }
}

// ── Firebase lobby subscription ──
function enterLobbyScreen() {
  const codeEl = document.getElementById('lobby-banner-code');
  if (codeEl) codeEl.textContent = state.activeLobbyCode;
  
  applyCodeVisibility();

  const chatContainer = document.getElementById('chat-messages');
  if (chatContainer) {
    chatContainer.innerHTML = '';
    chatContainer.dataset.count = '0';
    const empty = document.getElementById('chat-empty');
    if (empty) { empty.style.display = 'flex'; chatContainer.appendChild(empty); }
  }

  state.myVote = null;
  state.myVoteMeta = { size: 'standard', diff: 'medium' };
  state._suppressGameRedirect = false;
  state._lastKnownStartedAt = null;
  setIdentityLocked(false);
  document.querySelectorAll('.lobby-diff-btn').forEach(b => { b.style.opacity = ''; b.style.pointerEvents = ''; });

state.lastKnownPlayers[state.myPlayerId] = {
  name: state.playerName,
  colorHex: state.playerColor.hex,
  avatar: state.pixelAvatarData || null,
  vote: null,
  voteMeta: null,
  isHost: state.isHost || false,
  inGame: false,
};
  // Rename "Ranked" → "Race the Clock" on every load, regardless of selected mode
  const rankedCard = document.getElementById('mode-card-ranked');
  if (rankedCard && !rankedCard.dataset.renamed) {
    rankedCard.dataset.renamed = '1';
    rankedCard.querySelectorAll('*').forEach(el => {
      if (el.children.length === 0 && el.textContent.trim() === 'Ranked') {
        el.textContent = 'Race the Clock';
      }
    });
  }

  initLobbyIdentityEditor();
  renderPlayerList();
  renderStartBtn();

  

  if (state.activeLobbyCode && state.myPlayerId && window._fb) {
  const { ref, set, db } = window._fb;
  set(ref(db, `lobbies/${state.activeLobbyCode}/players/${state.myPlayerId}`), {
    name: state.playerName,
    colorHex: state.playerColor.hex,
    avatar: state.pixelAvatarData || null,
    vote: null,
    voteMeta: null,
    isHost: state.isHost || false,
    inGame: false,
  }).then(() => {
    registerPlayerDisconnect(state.activeLobbyCode, state.myPlayerId);
  }).catch(() => {});
}

subscribeChatFB();
subscribeLobbyFB();

// Eagerly fetch all players so color swatches show taken colors immediately for new joiners
if (state.activeLobbyCode && window._fb) {
  const { get, ref, db } = window._fb;
  get(ref(db, `lobbies/${state.activeLobbyCode}/players`)).then(snap => {
    if (!snap.exists()) return;
    const players = snap.val() || {};
    Object.entries(players).forEach(([id, p]) => {
      if (!p || id === state.myPlayerId) return;
      if (!state.lastKnownPlayers[id]) state.lastKnownPlayers[id] = {};
      state.lastKnownPlayers[id].name = (p.name && p.name.trim()) ? p.name.trim() : (state.lastKnownPlayers[id].name || 'Player');
      state.lastKnownPlayers[id].colorHex = (p.colorHex && p.colorHex !== '#888' && p.colorHex !== '#888888') ? p.colorHex : (state.lastKnownPlayers[id].colorHex || '#888888');
      if (p.avatar !== undefined) state.lastKnownPlayers[id].avatar = p.avatar;
      if (typeof p.isHost === 'boolean') state.lastKnownPlayers[id].isHost = p.isHost;
    });
    refreshLobbySwatches();
    renderPlayerList();
  }).catch(() => {});
}
// Persist session for rejoin on page close
localStorage.setItem('cwf_session', JSON.stringify({
  lobbyCode: state.activeLobbyCode,
  playerId: state.myPlayerId,
  playerName: state.playerName,
  colorHex: state.playerColor.hex,
  avatar: state.pixelAvatarData || null,
  savedAt: Date.now(),
}));

  // Fallback: if after 2 seconds we still only see ourselves, do a one-time get
  setTimeout(() => {
    if (Object.keys(state.lastKnownPlayers).length <= 1 && window._fb) {
      const { get, ref, db } = window._fb;
      get(ref(db, `lobbies/${state.activeLobbyCode}/players`)).then(snap => {
        if (!snap.exists()) return;
        const players = snap.val() || {};
        Object.entries(players).forEach(([id, p]) => {
          const existing = state.lastKnownPlayers[id] || {};
          state.lastKnownPlayers[id] = {
            name:     (p.name && p.name.trim()) ? p.name.trim() : (existing.name || 'Player'),
            colorHex: (p.colorHex && p.colorHex !== '#888' && p.colorHex !== '#888888') ? p.colorHex : (existing.colorHex || '#888888'),
            avatar:   p.avatar   !== undefined ? p.avatar   : (existing.avatar   || null),
            vote:     p.vote     || null,
            voteMeta: p.voteMeta || null,
            isHost:   typeof p.isHost === 'boolean' ? p.isHost : (existing.isHost || false),
            inGame:   typeof p.inGame === 'boolean' ? p.inGame : (existing.inGame || false),
          };
        });
        _lastPlayerListKey = '';
        renderPlayerList();
        renderStartBtn();
        refreshLobbySwatches();
      }).catch(() => {});
    }
  }, 2000);

  window.scrollTo(0, 0);
}

function subscribeLobbyFB() {
  if (lobbyListener) { lobbyListener(); lobbyListener = null; }
  let _firstSnapshotDone = false;
  let _hasReceivedValidSnapshot = false;

  // Load full player list once before subscription fires
  if (window._fb) {
    const { get, ref, db } = window._fb;
    get(ref(db, `lobbies/${state.activeLobbyCode}`)).then(snap => {
      if (!snap.exists()) return;
      const data = snap.val();
      const players = data.players || {};
      Object.entries(players).forEach(([id, p]) => {
        if (id === state.myPlayerId) return;
        state.lastKnownPlayers[id] = {
          name:     (p.name && p.name.trim()) ? p.name.trim() : 'Player',
          colorHex: (p.colorHex && p.colorHex !== '#888' && p.colorHex !== '#888888') ? p.colorHex : '#888888',
          avatar:   p.avatar   || null,
          vote:     p.vote     || null,
          voteMeta: p.voteMeta || null,
          isHost:   p.isHost   || false,
          inGame:   p.inGame   || false,
        };
      });
      _firstSnapshotDone = true;
      _lastPlayerListKey = '';
      renderPlayerList();
      renderStartBtn();
      refreshLobbySwatches();
    }).catch(() => { _firstSnapshotDone = true; });
  }

  lobbyListener = subscribeLobby(state.activeLobbyCode, snap => {
    console.log('[SNAP]', { exists: snap.exists(), status: snap.val()?.status, puzzleDateKey: snap.val()?.puzzleDateKey, pendingKey: snap.val()?.pendingPuzzleDateKey, gameEnded: snap.val()?.gameSettings?.gameEnded });
    if (!snap.exists()) {
      if (_hasReceivedValidSnapshot) { showToast('Lobby closed.'); leaveLobby(true); }
      return;
    }
    _hasReceivedValidSnapshot = true;
    const data = snap.val();
    state.lastLobbyData = data;
    const players = data.players || {};
    console.log('subscription fired, players:', JSON.stringify(players));
    if (!Object.keys(players).length) {
      console.log('subscription got empty players, lastKnownPlayers:', JSON.stringify(state.lastKnownPlayers));
      // Only bail if we haven't received a valid snapshot yet — otherwise trust the empty list
      if (!_hasReceivedValidSnapshot) return;
    }
    // Merge incoming players with existing state, preserving local data for missing fields
    // Start with existing players, then merge incoming on top
    const incoming = {};
    let stillInLobby = false;
    Object.entries(players).forEach(([id, p]) => {
      const existing = state.lastKnownPlayers[id] || {};
      if (id === state.myPlayerId) {
        incoming[id] = existing;
      } else {
        incoming[id] = {
          name:     (p.name && p.name.trim()) ? p.name.trim() : (existing.name || 'Player'),
          colorHex: (p.colorHex && p.colorHex !== '#888' && p.colorHex !== '#888888') ? p.colorHex : (existing.colorHex || '#888888'),
          avatar:   p.avatar   !== undefined ? p.avatar   : (existing.avatar   || null),
          vote:     p.vote     || null,
          voteMeta: p.voteMeta || null,
          isHost:   p.isHost !== undefined ? p.isHost : (existing.isHost || false),
          inGame:   p.inGame !== undefined ? p.inGame : (existing.inGame || false),
        };
      }
      if (id === state.myPlayerId) {
        state.isHost = p.isHost || false;
        stillInLobby = true;
        if (p.vote) { state.myVote = p.vote; state.myVoteMeta = p.voteMeta || { size:'standard', diff:'medium' }; setIdentityLocked(true); }
        else { state.myVote = null; state.myVoteMeta = null; lobbySize = null; lobbyDiff = null; document.querySelectorAll('.lobby-size-btn,.lobby-diff-btn').forEach(b => b.classList.remove('active')); setIdentityLocked(false); }
      }
    });
       // Preserve inGame=false for the returning player so host knows they're back
      if (sessionStorage.getItem('returningFromGame') === '1' && state.myPlayerId && incoming[state.myPlayerId]) {
        incoming[state.myPlayerId].inGame = false;
      }
      state.lastKnownPlayers = incoming;

    // Kicked detection
    if (stillInLobby) state._seenInLobby = true;
    if (state.myPlayerId && !stillInLobby && state._seenInLobby) {
      if (lobbyListener) { lobbyListener(); lobbyListener = null; }
      state.activeLobbyCode = null; state.myPlayerId = null; state.isHost = false;
      state._seenInLobby = false;
      showToast('You were kicked from the lobby.');
      if (lobbyListener) { lobbyListener(); lobbyListener = null; }
      if (chatListener)  { chatListener();  chatListener  = null; }
      window.location.href = 'index.html';
      return;
    }

    // Tiebreaker roulette for non-hosts
    if (data.rouletteActive === true && !state.isHost && !window._rouletteShown) {
      window._rouletteShown = true;
      const winnerKey = data.rouletteWinnerKey || null;
      const opts = data.rouletteOptions;
      if (opts && Array.isArray(opts) && opts.length > 1) {
        const rouletteOptions = opts.map(o => ({ key: o.key, meta: { size: o.size, diff: o.diff } }));
        showTiebreakerRoulette(rouletteOptions, true, winnerKey);
      }
    }
    if (data.rouletteActive === false) {
      window._rouletteShown = false;
      // Remove overlay if still showing — redirect will happen on next snapshot
      const existingOverlay = document.getElementById('roulette-overlay');
      if (existingOverlay) existingOverlay.remove();
    }

    // Reset suppress flag when lobby returns to waiting
    if (data.status === 'waiting') {
      state._suppressGameRedirect = false;
      state._suppressedAtStartedAt = null;
    }
    // Also lift suppression when gameEnded clears — means a fresh game is now live
    const gameIsNowLive = data.status === 'started' && !data.gameSettings?.gameEnded;
    if (state._suppressGameRedirect && gameIsNowLive && state._suppressedWhenGameEnded) {
      state._suppressGameRedirect = false;
    }
    if (data.status === 'started' && data.gameSettings?.gameEnded) {
      state._suppressedWhenGameEnded = true;
    } else {
      state._suppressedWhenGameEnded = false;
    }
    if (data.startedAt) state._lastKnownStartedAt = data.startedAt;

    // Game started — redirect to game.html
    if (data.status === 'started' && data.puzzleDateKey) {
      const gameIsEnded = data.gameSettings?.gameEnded === true;
      const returningFromGame = sessionStorage.getItem('returningFromGame') === '1';
      console.log('[REDIRECT CHECK]', { status: data.status, gameIsEnded, returningFromGame, isHost: state.isHost, suppress: state._suppressGameRedirect, suppressedAt: state._suppressedAtStartedAt, dataStartedAt: data.startedAt, puzzleKey: data.puzzleDateKey, suppressedPuzzleKey: state._suppressedAtPuzzleKey });
      if (returningFromGame) {
        sessionStorage.removeItem('returningFromGame');
        state._suppressedAtStartedAt = data.startedAt || null;
        state._suppressedAtPuzzleKey = data.puzzleDateKey || null;
        state._suppressGameRedirect = true;
      }
      if (state._suppressGameRedirect && data.startedAt && data.startedAt !== state._suppressedAtStartedAt) {
        state._suppressGameRedirect = false;
      }
      // If suppress was set but startedAt is missing (serverTimestamp not yet resolved),
      // treat a fresh puzzleDateKey change as a new game and lift suppression
      if (state._suppressGameRedirect && !data.startedAt && data.puzzleDateKey && data.puzzleDateKey !== state._suppressedAtPuzzleKey) {
        state._suppressGameRedirect = false;
      }
      if (!gameIsEnded && !state.isHost && !returningFromGame && !state._suppressGameRedirect) {
        const puzzleKey = data.pendingPuzzleDateKey || data.puzzleDateKey;
        console.log('[REDIRECT] pendingPuzzleDateKey:', data.pendingPuzzleDateKey, '| puzzleDateKey:', data.puzzleDateKey, '| using:', puzzleKey, '| gameMode:', data.gameMode);
        if (!puzzleKey) {
          console.warn('[REDIRECT] status=started but no puzzleKey yet, waiting for next snapshot...');
          return;
        }
        if (!data.gameMode) {
          console.warn('[REDIRECT] status=started but no gameMode yet, waiting for next snapshot...');
          return;
        }
        sessionStorage.setItem('gameMode', data.gameMode || 'together');
        sessionStorage.setItem('puzzleDateKey', puzzleKey);
        sessionStorage.removeItem('returningFromGame');
        sessionStorage.removeItem('freshGameStart');
        // Fetch fresh player list right before navigating so mid-game joiners get current data
        if (window._fb) {
          const { get, ref, db } = window._fb;
          get(ref(db, `lobbies/${state.activeLobbyCode}/players`)).then(snap => {
            const freshPlayers = snap.val() || {};
            const merged = {};
            Object.entries(freshPlayers).forEach(([id, p]) => {
              if (!p) return;
              merged[id] = {
                name: p.name || state.lastKnownPlayers[id]?.name || 'Player',
                colorHex: p.colorHex || state.lastKnownPlayers[id]?.colorHex || '#888888',
                avatar: p.avatar !== undefined ? p.avatar : (state.lastKnownPlayers[id]?.avatar || null),
                isHost: typeof p.isHost === 'boolean' ? p.isHost : (state.lastKnownPlayers[id]?.isHost || false),
                inGame: p.inGame || false,
              };
            });
            try { sessionStorage.setItem('lastKnownPlayers', JSON.stringify(merged)); } catch {}
            window.location.href = 'game.html';
          }).catch(() => {
            try { sessionStorage.setItem('lastKnownPlayers', JSON.stringify(state.lastKnownPlayers)); } catch {}
            window.location.href = 'game.html';
          });
        } else {
          try { sessionStorage.setItem('lastKnownPlayers', JSON.stringify(state.lastKnownPlayers)); } catch {}
          window.location.href = 'game.html';
        }
        return;
      }
    }

    if (data.gameMode && data.gameMode !== state.lobbyMode) setLobbyMode(data.gameMode, true);

    _lastPlayerListKey = '';
    renderPlayerList();
    renderVoteGrid();
    renderStartBtn();
    refreshLobbySwatches();

    // Live-update chat messages if a player changed their name/color/avatar
    const container = document.getElementById('chat-messages');
    if (container) {
      Object.entries(state.lastKnownPlayers).forEach(([id, p]) => {
        container.querySelectorAll('.chat-msg').forEach(msgEl => {
          if (msgEl.dataset.playerId !== id) return;
          msgEl.style.cssText = `border-left:2.5px solid ${p.colorHex};padding-left:8px;margin-left:2px`;
          const avatarEl = msgEl.querySelector('.chat-msg-avatar');
          if (avatarEl) {
            if (p.avatar) {
              avatarEl.style.backgroundImage = `url(${p.avatar})`;
              avatarEl.style.backgroundColor = p.colorHex;
              avatarEl.style.border = `2px solid ${p.colorHex}`;
              avatarEl.textContent = '';
            } else {
              avatarEl.style.backgroundImage = '';
              avatarEl.style.backgroundColor = p.colorHex;
              avatarEl.textContent = (p.name||'?').charAt(0).toUpperCase();
            }
          }
          const nameEl = msgEl.querySelector('.chat-msg-name');
          if (nameEl) {
            nameEl.textContent = p.name || '';
            nameEl.style.color = chatNameColor(p.colorHex);
          }
        });
      });
    }

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
    const msgs = snap.val() || {};
    // Force re-render by clearing the count cache
    const container = document.getElementById('chat-messages');
    if (container) container.dataset.count = '0';
    renderChat(msgs);
  });
}

// ── Leave lobby ──
async function leaveLobby(skipConfirm = false) {
  if (!skipConfirm) {
    const confirmed = await showLeaveConfirm();
    if (!confirmed) return;
  }
  if (lobbyListener) { lobbyListener(); lobbyListener = null; }
  if (chatListener)  { chatListener();  chatListener  = null; }
  if (state.activeLobbyCode && state.myPlayerId) {
    cancelPlayerDisconnect(state.activeLobbyCode, state.myPlayerId);
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
  localStorage.removeItem('cwf_session');
  state.activeLobbyCode = null; state.myPlayerId = null; state.isHost = false; state.lastLobbyData = null;
  state.myVote = null; state.lastKnownPlayers = {};
  state._seenInLobby = false;
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
  console.log('[INIT]', { activeLobbyCode: state.activeLobbyCode, myPlayerId: state.myPlayerId, isHost: state.isHost, sessionLobbyState: sessionStorage.getItem('lobbyState') });
  // If arriving directly via ?code= URL with no session, redirect to home to handle join
  const _directCode = new URLSearchParams(window.location.search).get('code');
  const _savedState = (() => { try { return JSON.parse(sessionStorage.getItem('lobbyState') || 'null'); } catch { return null; } })();
  if (_directCode && !state.activeLobbyCode && !_savedState?.activeLobbyCode) {
    window.location.href = `/index.html?code=${_directCode}`;
    return;
  }

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

  // Always sync state from Firebase before entering lobby
  if (window._fb) {
    const { get, ref, db } = window._fb;
    get(ref(db, `lobbies/${state.activeLobbyCode}/players/${state.myPlayerId}`)).then(snap => {
      if (snap.exists()) {
        const p = snap.val();
        if (p.name) state.playerName = p.name;
        if (p.colorHex) {
          const found = COLORS.find(c => c.hex === p.colorHex);
          if (found) state.playerColor = found;
        }
        if (p.avatar) state.pixelAvatarData = p.avatar;
      }
      enterLobbyScreen();
    }).catch(() => enterLobbyScreen());
  } else {
    enterLobbyScreen();
  }

  document.getElementById('btn-leave-lobby')?.addEventListener('click', () => leaveLobby(false));
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

  document.getElementById('mode-card-together')?.addEventListener('click', () => {
    if (state.lobbyMode === 'together') setLobbyMode(null); else setLobbyMode('together');
  });
  document.getElementById('mode-card-versus')?.addEventListener('click', () => {
    if (state.lobbyMode === 'versus') setLobbyMode(null); else setLobbyMode('versus');
  });

  document.getElementById('mode-card-ranked')?.addEventListener('click', () => {
    if (state.lobbyMode === 'ranked') setLobbyMode(null); else setLobbyMode('ranked');
  });

  document.querySelectorAll('.lobby-size-btn').forEach(b => b.addEventListener('click', () => setLobbySize(b.dataset.size)));
  document.querySelectorAll('.lobby-diff-btn').forEach(b => b.addEventListener('click', () => setLobbyDiff(b.dataset.diff)));

  document.getElementById('player-ctx-give-host')?.addEventListener('click', () => ctxAction('giveHost'));
  document.getElementById('player-ctx-kick')?.addEventListener('click', () => ctxAction('kick'));
}

function waitAndInit() {
  if (window._fbReady && window._fb) { init(); return; }
  const handler = () => {
    document.removeEventListener('fb-ready', handler);
    window.removeEventListener('firebase-ready', handler);
    clearInterval(poll);
    init();
  };
  document.addEventListener('fb-ready', handler, { once: true });
  window.addEventListener('firebase-ready', handler, { once: true });
  let attempts = 0;
  const poll = setInterval(() => {
    if (window._fbReady && window._fb) {
      clearInterval(poll);
      document.removeEventListener('fb-ready', handler);
      window.removeEventListener('firebase-ready', handler);
      init();
    }
    if (++attempts > 100) clearInterval(poll);
  }, 50);
}

window.leaveLobby            = leaveLobby;
window.bannerCopy            = bannerCopy;
window.toggleCodeVisibility  = toggleCodeVisibility;
window.revealCode            = revealCode;
window.onLobbyNameInput      = onLobbyNameInput;
window.saveLobbyIdentity     = saveLobbyIdentity;
window.openLobbyPixelOverlay = openLobbyPixelOverlay;
window.lobbyCancel           = lobbyCancel;
window.saveLobbyPixelAvatar  = saveLobbyPixelAvatar;
window.setLobbyMode          = setLobbyMode;
window.setLobbySize          = setLobbySize;
window.setLobbyDiff          = setLobbyDiff;
window.castLobbyVote         = castLobbyVote;
window.removeVote            = removeVote;
window.startGame             = startGame;
window.doStartGame           = doStartGame;
window.joinActiveMatch       = joinActiveMatch;
window.setGameInProgressLock = setGameInProgressLock;
window.unlockGamePanels      = unlockGamePanels;
window.openSettings          = openSettings;
window.saveSettings          = saveSettings;
window.ctxAction             = ctxAction;
window.closeOverlay          = closeOverlay;
window.showTiebreakerRoulette = showTiebreakerRoulette;

waitAndInit();
