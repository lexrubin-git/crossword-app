// ── home.controller.js ──
import { state, COLORS, showToast } from '../state.js';
import { buildColorSwatches, updateChip, openOverlay, closeOverlay, openAvatarLightbox } from '../ui.helpers.js';
import { mountDrawBlock, bakeAvatarDataUrl, drawVectorCanvas, updateAvatarPreview, toggleEraser, clearPixelCanvas, stepBrushSize, stepOpacity, onSizeSlider, onOpacitySlider, toggleAdvanced, undoPixel, redoPixel } from '../pixel-art.js';
import { createLobby, joinLobby, getLobbyPlayers, pruneStaleLobbies } from '../api.service.js';
import { pickRandomPuzzle, puzzleLabel, parseNytPuzzle, formatNytDateLabel } from '../puzzle.js';
import { fetchNytPuzzle } from '../api.service.js';

// ── Profile overlay ──
function initColorSwatches() {
  buildColorSwatches('color-swatches', state.playerColor.hex, new Set(), (color) => {
    state.playerColor = color;
    const wrap = document.getElementById('profile-avatar-preview');
    if (wrap) wrap.style.borderColor = color.hex;
  });
}

function onNameInput() {
  document.getElementById('player-name').classList.remove('error');
  document.getElementById('name-error').classList.remove('visible');
}

function confirmProfile() {
  const val = document.getElementById('player-name').value.trim();
  if (!val) {
    document.getElementById('player-name').classList.add('error');
    document.getElementById('name-error').classList.add('visible');
    return;
  }
  state.playerName = val;
  const sel = document.querySelector('#color-swatches .swatch.selected');
  if (sel) {
    const found = COLORS.find(c => c.hex === sel.dataset.hex);
    if (found) state.playerColor = found;
  }
  const avatarData = bakeAvatarDataUrl();
  if (avatarData) state.pixelAvatarData = avatarData;
  closeOverlay('profile-overlay');
  updateChip();
}

function profileCancel() {
  closeOverlay('profile-overlay');
}

function openProfile() {
  document.getElementById('player-name').value = state.playerName;
  buildColorSwatches('color-swatches', state.playerColor.hex, new Set(), (color) => {
    state.playerColor = color;
    const wrap = document.getElementById('profile-avatar-preview');
    if (wrap) wrap.style.borderColor = color.hex;
  });
  openOverlay('profile-overlay');
  mountDrawBlock('profile-canvas-slot');
  updateAvatarPreview();
}

// ── Join lobby overlay ──
let joinCodeDebounce = null;

function joinLobbyUI() {
  const ci = document.getElementById('join-code');
  const ni = document.getElementById('join-name');
  ci.value = '';
  ni.value = state.playerName;
  [ci, ni].forEach(el => el.classList.remove('error'));
  ['join-error','join-name-error'].forEach(id => document.getElementById(id).classList.remove('visible'));

  const container = document.getElementById('join-color-swatches');
  container.innerHTML = '';
  COLORS.forEach(c => {
    const s = document.createElement('div');
    s.className = 'swatch taken';
    s.style.background = c.hex;
    container.appendChild(s);
  });
  container.style.opacity = '0.35';
  container.style.pointerEvents = 'none';
  document.getElementById('join-color-locked').style.display = '';
  openOverlay('join-overlay');
  setTimeout(() => ci.focus(), 50);
}

function onJoinInput() {
  document.getElementById('join-code').classList.remove('error');
  document.getElementById('join-error').classList.remove('visible');
  const swatchWrap = document.getElementById('join-color-swatches');
  const lockMsg    = document.getElementById('join-color-locked');
  swatchWrap.style.opacity = '0.35';
  swatchWrap.style.pointerEvents = 'none';
  lockMsg.style.display = '';
  clearTimeout(joinCodeDebounce);
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (code.length < 4) return;
  joinCodeDebounce = setTimeout(() => fetchLobbyColors(code), 500);
}

async function fetchLobbyColors(code) {
  try {
    const players = await getLobbyPlayers(code);
    const takenHexes = new Set(Object.values(players).map(p => p.colorHex));
    initJoinSwatches(takenHexes);
  } catch {}
}

function initJoinSwatches(takenHexes) {
  const taken = takenHexes || new Set();
  const firstFree = COLORS.find(c => !taken.has(c.hex)) || COLORS[0];
  const container = document.getElementById('join-color-swatches');
  const lockMsg   = document.getElementById('join-color-locked');
  container.innerHTML = '';
  COLORS.forEach(c => {
    const isTaken = taken.has(c.hex);
    const s = document.createElement('div');
    s.className = 'swatch' + (!isTaken && c.hex === firstFree.hex ? ' selected' : '') + (isTaken ? ' taken' : '');
    s.style.background = c.hex;
    s.title = isTaken ? `${c.name} (taken)` : c.name;
    s.dataset.hex = c.hex;
    if (!isTaken) {
      s.addEventListener('click', () => {
        container.querySelectorAll('.swatch').forEach(el => el.classList.remove('selected'));
        s.classList.add('selected');
      });
    }
    container.appendChild(s);
  });
  container.style.opacity = '1';
  container.style.pointerEvents = '';
  lockMsg.style.display = 'none';
}

function onJoinNameInput() {
  document.getElementById('join-name').classList.remove('error');
  document.getElementById('join-name-error').classList.remove('visible');
}

async function doJoin() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  const name = document.getElementById('join-name').value.trim();
  let ok = true;

  if (!code) {
    document.getElementById('join-code').classList.add('error');
    document.getElementById('join-error').textContent = 'Please enter a lobby code.';
    document.getElementById('join-error').classList.add('visible');
    ok = false;
  }
  if (!name) {
    document.getElementById('join-name').classList.add('error');
    document.getElementById('join-name-error').classList.add('visible');
    ok = false;
  }
  if (!ok) return;

  const selSwatch = document.querySelector('#join-color-swatches .swatch.selected');
  const chosenHex = selSwatch?.dataset.hex;
  if (!chosenHex) {
    document.getElementById('join-error').textContent = 'Please pick a color.';
    document.getElementById('join-error').classList.add('visible');
    return;
  }
  const playerColor = COLORS.find(c => c.hex === chosenHex) || COLORS[0];

  const btn = document.getElementById('join-btn');
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const { playerId } = await joinLobby(code, name, playerColor, state.pixelAvatarData);
    state.playerName     = name;
    state.playerColor    = playerColor;
    state.activeLobbyCode = code;
    state.isHost         = false;
    state.myPlayerId     = playerId;
    sessionStorage.setItem('lobbyState', JSON.stringify({
      activeLobbyCode: code,
      myPlayerId: playerId,
      isHost: false,
      playerName: name,
      playerColorHex: playerColor.hex,
      pixelAvatarData: state.pixelAvatarData || null,
    }));
    updateChip();
    closeOverlay('join-overlay');
    window.location.href = 'lobby.html';
  } catch (e) {
    let errMsg = e.message;
    if (errMsg === 'name_taken')   errMsg = 'That name is already taken. Please choose another.';
    if (errMsg === 'color_taken')  errMsg = 'That color was just taken — please pick another.';
    document.getElementById('join-error').textContent = errMsg;
    document.getElementById('join-error').classList.add('visible');
  } finally {
    btn.disabled = false; btn.textContent = 'Join →';
  }
}

// ── Create lobby ──
async function goToLobby() {
  try {
    const { code, playerId } = await createLobby(state.playerName, state.playerColor, state.pixelAvatarData);
    state.activeLobbyCode = code;
    state.isHost          = true;
    state.myPlayerId      = playerId;
    sessionStorage.setItem('lobbyState', JSON.stringify({
      activeLobbyCode: code,
      myPlayerId: playerId,
      isHost: true,
      playerName: state.playerName,
      playerColorHex: state.playerColor.hex,
      pixelAvatarData: state.pixelAvatarData || null,
    }));
    pruneStaleLobbies();
    window.location.href = 'lobby.html';
  } catch (e) {
    showToast('Failed to create lobby: ' + e.message.slice(0, 60));
  }
}

// ── Puzzle picker (solo play) ──
let pickerSize = 'standard';
let pickerDiff = 'medium';

function updatePickerPreview() {
  const el = document.getElementById('puzzle-picker-preview');
  if (el) el.textContent = puzzleLabel(pickerSize, pickerDiff) + ' — random puzzle from archive';
}

function setPuzzleSize(size) {
  pickerSize = size;
  document.querySelectorAll('.puzzle-size-btn').forEach(b => b.classList.toggle('active', b.dataset.size === size));
  const diffRow = document.getElementById('puzzle-diff-row');
  if (size === 'large') {
    if (diffRow) diffRow.style.display = 'none';
    pickerDiff = 'medium';
    document.querySelectorAll('.puzzle-diff-btn').forEach(b => b.classList.toggle('active', b.dataset.diff === 'medium'));
  } else {
    if (diffRow) diffRow.style.display = '';
  }
  updatePickerPreview();
}

function setPuzzleDiff(diff) {
  pickerDiff = diff;
  document.querySelectorAll('.puzzle-diff-btn').forEach(b => b.classList.toggle('active', b.dataset.diff === diff));
  updatePickerPreview();
}

async function confirmPuzzlePick() {
  const dateKey = pickRandomPuzzle(pickerSize, pickerDiff);
  if (!dateKey) {
    document.getElementById('puzzle-picker-error').textContent = 'No puzzles available for that combination.';
    document.getElementById('puzzle-picker-error').style.display = 'block';
    return;
  }
  const btn = document.getElementById('puzzle-picker-btn');
  btn.disabled = true; btn.textContent = 'Loading…';
  document.getElementById('puzzle-picker-error').style.display = 'none';

  if (!state.myPlayerId) state.myPlayerId = 'solo_' + Math.random().toString(36).slice(2,8);
  try {
    const rawData = await fetchNytPuzzle(dateKey);
    const puzzle = parseNytPuzzle(rawData, dateKey);
    // Store puzzle for the game page to pick up
    sessionStorage.setItem('soloPuzzle', JSON.stringify(puzzle));
    sessionStorage.setItem('gameMode', 'together');
    closeOverlay('puzzle-picker-overlay');
    window.location.href = 'game.html';
  } catch (e) {
    document.getElementById('puzzle-picker-error').textContent = 'Failed to load: ' + e.message.slice(0,80);
    document.getElementById('puzzle-picker-error').style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Play →';
  }
}

// ── URL-based auto-join ──
function checkUrlLobbyCode() {
  const params = new URLSearchParams(window.location.search);
  let code = (params.get('code') || '').trim().toUpperCase();
  if (!code) {
    const segs = window.location.pathname.split('/').filter(Boolean);
    const last = segs[segs.length - 1] || '';
    if (/^[A-Z0-9]{4}$/i.test(last)) code = last.toUpperCase();
  }
  if (code.length === 4) {
    setTimeout(() => {
      joinLobbyUI();
      const codeInput = document.getElementById('join-code');
      if (codeInput) { codeInput.value = code; onJoinInput(); }
      if (window.history?.replaceState) {
        const base = window.location.pathname.replace(new RegExp('[/]?' + code + '[/]?$', 'i'), '/');
        window.history.replaceState(null, '', base);
      }
    }, 300);
  }
}

// ── Init ──
function init() {
  document.getElementById('config-notice').style.display = 'none';
  initColorSwatches();
  updateChip();
  updatePickerPreview();
  checkUrlLobbyCode();

  // Wire all buttons via addEventListener (no inline onclick in HTML)
  document.getElementById('btn-create-lobby')?.addEventListener('click', goToLobby);
  document.getElementById('btn-join-lobby')?.addEventListener('click', joinLobbyUI);
  document.getElementById('btn-open-profile')?.addEventListener('click', openProfile);
  document.getElementById('player-chip')?.addEventListener('click', openProfile);
  document.getElementById('join-btn')?.addEventListener('click', doJoin);
  document.getElementById('join-cancel-btn')?.addEventListener('click', () => closeOverlay('join-overlay'));
  document.getElementById('player-name')?.addEventListener('input', onNameInput);
  document.getElementById('join-code')?.addEventListener('input', onJoinInput);
  document.getElementById('join-code')?.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
  document.getElementById('join-name')?.addEventListener('input', onJoinNameInput);
  document.getElementById('profile-save-btn')?.addEventListener('click', confirmProfile);
  document.getElementById('profile-cancel-btn')?.addEventListener('click', profileCancel);

  // Puzzle picker
  document.getElementById('puzzle-picker-confirm')?.addEventListener('click', confirmPuzzlePick);
  document.getElementById('puzzle-picker-cancel')?.addEventListener('click', () => closeOverlay('puzzle-picker-overlay'));
  document.querySelectorAll('.puzzle-size-btn').forEach(b => {
    b.addEventListener('click', () => setPuzzleSize(b.dataset.size));
  });
  document.querySelectorAll('.puzzle-diff-btn').forEach(b => {
    b.addEventListener('click', () => setPuzzleDiff(b.dataset.diff));
  });

  // Avatar lightbox close
  document.getElementById('avatar-lightbox')?.addEventListener('click', () => {
    document.getElementById('avatar-lightbox').style.display = 'none';
  });
}

// Wait for Firebase, then init
function waitAndInit() {
  if (window._fbReady) { init(); }
  else { document.addEventListener('fb-ready', init, { once: true }); }
}

// Expose window globals needed by HTML event handlers still in use
window.goToLobby    = goToLobby;
window.joinLobby    = joinLobbyUI;
window.openProfile  = openProfile;
window.profileCancel = profileCancel;
window.confirmProfile = confirmProfile;
window.onNameInput  = onNameInput;
window.onJoinInput  = onJoinInput;
window.doJoin       = doJoin;
window.onJoinNameInput = onJoinNameInput;
window.setPuzzleSize = setPuzzleSize;
window.setPuzzleDiff = setPuzzleDiff;
window.confirmPuzzlePick = confirmPuzzlePick;
window.openPuzzlePicker = () => { updatePickerPreview(); openOverlay('puzzle-picker-overlay'); };
window.closeOverlay = (id) => closeOverlay(id);
window.updateChip   = updateChip;

waitAndInit();
