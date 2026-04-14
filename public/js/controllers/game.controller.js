/**
 * game.controller.js — Controls the in-game crossword page.
 *
 * Responsibilities:
 *  - Build and render the crossword grid
 *  - Handle keyboard / touch input for cell filling
 *  - Sync cell values to Firebase in real time
 *  - Render remote player cursors
 *  - Clue panel — highlight active clue, mark completed
 *  - Sidebar scores, player dots, in-game chat
 *  - Host toolbar: check, reveal, autocheck
 *  - Chat-guess mode
 *  - Game timer
 *  - Game-over overlay (podium)
 *  - Leave / forfeit / back-to-lobby flows
 */

import {
  loadPlayerIdentity,
  session,
  navigate,
} from '/js/state.js';

import {
  showToast,
  openOverlay,
  closeOverlay,
  renderSwatches,
  applyAvatar,
  formatTime,
  openCtxMenu,
} from '/js/ui.helpers.js';

import {
  submitCell,
  checkGrid,
  revealGrid,
  sendChatMessage,
  updatePlayerProfile,
  forfeitGame,
} from '../api.service.js';

// ── Session ────────────────────────────────────────
session.lobbyCode = sessionStorage.getItem('lobbyCode') || '';
session.playerId  = sessionStorage.getItem('playerId')  || '';
session.isHost    = sessionStorage.getItem('isHost') === '1';

if (!session.lobbyCode) navigate('index');

const identity = loadPlayerIdentity();

// ── DOM refs ───────────────────────────────────────
const gameGrid             = document.getElementById('game-grid');
const gameMapLabel         = document.getElementById('game-map-label');
const gameTimer            = document.getElementById('game-timer');
const gameActiveClueInner  = document.getElementById('game-active-clue-inner');
const clueAcross           = document.getElementById('clue-across');
const clueDown             = document.getElementById('clue-down');
const gameScoreList        = document.getElementById('game-score-list');
const gamePlayersStrip     = document.getElementById('game-players-strip');
const gameChatList         = document.getElementById('game-chat-list');
const gameChatInput        = document.getElementById('game-chat-input');
const gameHiddenInput      = document.getElementById('game-hidden-input');
const hostToolbar          = document.getElementById('game-host-toolbar');
const hostToolbarHeader    = document.getElementById('host-toolbar-header');
const hostToolbarBody      = document.getElementById('host-toolbar-body');
const hostToolbarChevron   = document.getElementById('host-toolbar-chevron');
const autocheckPill        = document.getElementById('autocheck-pill');
const chatGuessBtn         = document.getElementById('chat-guess-btn');

// ── Game state ─────────────────────────────────────
let puzzle           = null;   // loaded puzzle object
let cells            = {};     // 'r,c' → { letter, correct, owner }
let selectedCell     = null;   // { row, col }
let direction        = 'across';
let timerSec         = 0;
let timerInterval    = null;
let autocheckEnabled = false;
let chatGuessMode    = false;
let players          = {};     // playerId → playerObj
let scores           = {};     // playerId → points
let remoteCursors    = {};     // playerId → DOM element

// ── Utility ────────────────────────────────────────
const key = (r, c) => `${r},${c}`;
const cellEl = (r, c) => gameGrid.querySelector(`[data-row="${r}"][data-col="${c}"]`);

// ── Grid rendering ─────────────────────────────────
function buildGrid(pz) {
  puzzle = pz;
  const size = pz.size; // e.g. 15
  gameGrid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  gameGrid.innerHTML = '';
  gameMapLabel.textContent = `${pz.title || 'Classic'} · ${size}×${size}`;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = document.createElement('div');
      cell.className = 'game-cell';
      cell.dataset.row = r;
      cell.dataset.col = c;

      const isBlack = pz.grid[r][c] === '.';
      if (isBlack) {
        cell.classList.add('black');
      } else {
        // Cell number
        const num = pz.numbers?.[r]?.[c];
        if (num) {
          const numEl = document.createElement('div');
          numEl.className = 'game-cell-num';
          numEl.textContent = num;
          cell.appendChild(numEl);
        }
        // Letter container
        const letterEl = document.createElement('div');
        letterEl.className = 'game-cell-letter';
        cell.appendChild(letterEl);

        cell.addEventListener('click', () => onCellClick(r, c));
      }
      gameGrid.appendChild(cell);
    }
  }
  buildClues(pz);
}

// ── Clue list ──────────────────────────────────────
function buildClues(pz) {
  clueAcross.innerHTML = '';
  clueDown.innerHTML   = '';

  (pz.clues?.across || []).forEach(({ num, clue }) => {
    clueAcross.appendChild(makeClueEl(num, clue, 'across'));
  });
  (pz.clues?.down || []).forEach(({ num, clue }) => {
    clueDown.appendChild(makeClueEl(num, clue, 'down'));
  });
}

function makeClueEl(num, text, dir) {
  const el = document.createElement('div');
  el.className = 'game-clue-item';
  el.dataset.num = num;
  el.dataset.dir = dir;
  el.innerHTML = `<span class="game-clue-num">${num}</span><span class="game-clue-text">${text}</span>`;
  el.addEventListener('click', () => navigateToClue(num, dir));
  return el;
}

function highlightActiveClue(clueNum, dir) {
  document.querySelectorAll('.game-clue-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.num == clueNum && el.dataset.dir === dir);
  });
  // Scroll active clue into view
  const active = document.querySelector(`.game-clue-item.active`);
  active?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  // Update active clue text
  const clueData = (dir === 'across' ? puzzle?.clues?.across : puzzle?.clues?.down)
    ?.find((c) => c.num == clueNum);
  if (clueData && gameActiveClueInner) {
    gameActiveClueInner.innerHTML = `<strong>${clueNum}${dir === 'across' ? 'A' : 'D'}</strong> ${clueData.clue}`;
  }
}

function navigateToClue(num, dir) {
  // Find the first cell of this clue
  if (!puzzle) return;
  for (let r = 0; r < puzzle.size; r++) {
    for (let c = 0; c < puzzle.size; c++) {
      if (puzzle.numbers?.[r]?.[c] == num) {
        selectCell(r, c, dir);
        return;
      }
    }
  }
}

// ── Cell selection & navigation ────────────────────
function onCellClick(r, c) {
  if (puzzle?.grid[r][c] === '.') return;
  if (selectedCell?.row === r && selectedCell?.col === c) {
    // Toggle direction on second click
    direction = direction === 'across' ? 'down' : 'across';
  }
  selectCell(r, c, direction);
  gameHiddenInput.focus({ preventScroll: true });
}

function selectCell(r, c, dir = direction) {
  if (!puzzle || puzzle.grid[r][c] === '.') return;
  direction = dir;
  selectedCell = { row: r, col: c };

  // Highlight
  gameGrid.querySelectorAll('.game-cell').forEach((el) => {
    el.classList.remove('selected', 'word-highlight');
  });

  // Find the word cells
  const wordCells = getWordCells(r, c, dir);
  wordCells.forEach(([wr, wc]) => cellEl(wr, wc)?.classList.add('word-highlight'));
  cellEl(r, c)?.classList.remove('word-highlight');
  cellEl(r, c)?.classList.add('selected');

  // Find clue number
  const clueNum = getClueNum(r, c, dir);
  highlightActiveClue(clueNum, dir);

  // Broadcast cursor position to Firebase
  broadcastCursor(r, c);
}

function getWordCells(r, c, dir) {
  if (!puzzle) return [];
  const size = puzzle.size;
  const result = [];
  if (dir === 'across') {
    let sc = c;
    while (sc > 0 && puzzle.grid[r][sc - 1] !== '.') sc--;
    while (sc < size && puzzle.grid[r][sc] !== '.') {
      result.push([r, sc++]);
    }
  } else {
    let sr = r;
    while (sr > 0 && puzzle.grid[sr - 1][c] !== '.') sr--;
    while (sr < size && puzzle.grid[sr][c] !== '.') {
      result.push([sr++, c]);
    }
  }
  return result;
}

function getClueNum(r, c, dir) {
  // Walk back to start of word and return its number
  if (!puzzle) return null;
  let sr = r, sc = c;
  if (dir === 'across') {
    while (sc > 0 && puzzle.grid[r][sc - 1] !== '.') sc--;
  } else {
    while (sr > 0 && puzzle.grid[sr - 1][c] !== '.') sr--;
  }
  return puzzle.numbers?.[sr]?.[sc] || null;
}

function advanceCursor() {
  if (!selectedCell || !puzzle) return;
  let { row, col } = selectedCell;
  const size = puzzle.size;
  if (direction === 'across') {
    col++;
    while (col < size && puzzle.grid[row][col] === '.') col++;
    if (col < size) selectCell(row, col, 'across');
  } else {
    row++;
    while (row < size && puzzle.grid[row][col] === '.') row++;
    if (row < size) selectCell(row, col, 'down');
  }
}

function retreatCursor() {
  if (!selectedCell || !puzzle) return;
  let { row, col } = selectedCell;
  if (direction === 'across') {
    col--;
    while (col >= 0 && puzzle.grid[row][col] === '.') col--;
    if (col >= 0) selectCell(row, col, 'across');
  } else {
    row--;
    while (row >= 0 && puzzle.grid[row][col] === '.') row--;
    if (row >= 0) selectCell(row, col, 'down');
  }
}

// ── Keyboard handler ───────────────────────────────
function onKeyDown(e) {
  if (!selectedCell) return;
  const { row, col } = selectedCell;

  if (e.key === 'ArrowRight') { direction = 'across'; selectCell(row, col + 1, 'across'); e.preventDefault(); return; }
  if (e.key === 'ArrowLeft')  { direction = 'across'; selectCell(row, col - 1, 'across'); e.preventDefault(); return; }
  if (e.key === 'ArrowDown')  { direction = 'down';   selectCell(row + 1, col, 'down');   e.preventDefault(); return; }
  if (e.key === 'ArrowUp')    { direction = 'down';   selectCell(row - 1, col, 'down');   e.preventDefault(); return; }
  if (e.key === 'Tab') { e.preventDefault(); /* jump to next clue — stub */ return; }

  if (e.key === 'Backspace' || e.key === 'Delete') {
    const existing = cells[key(row, col)]?.letter;
    if (existing) {
      updateCell(row, col, '');
    } else {
      retreatCursor();
    }
    return;
  }

  const letter = e.key.toUpperCase();
  if (/^[A-Z]$/.test(letter)) {
    updateCell(row, col, letter);
    advanceCursor();
  }
}

// For mobile: capture from hidden input
function onHiddenInput(e) {
  const val = gameHiddenInput.value.toUpperCase();
  gameHiddenInput.value = '';
  if (!selectedCell || !val) return;
  const letter = val.slice(-1);
  if (/^[A-Z]$/.test(letter)) {
    updateCell(selectedCell.row, selectedCell.col, letter);
    advanceCursor();
  }
}

// ── Cell value update ──────────────────────────────
async function updateCell(r, c, letter) {
  cells[key(r, c)] = { ...(cells[key(r, c)] || {}), letter };
  renderCellLetter(r, c, letter);
  if (autocheckEnabled) runAutocheckCell(r, c);

  try {
    await submitCell(session.lobbyCode, r, c, letter, session.playerId);
  } catch { /* retry logic omitted for brevity */ }
}

function renderCellLetter(r, c, letter, colorOverride) {
  const el = cellEl(r, c);
  if (!el) return;
  const lEl = el.querySelector('.game-cell-letter');
  if (lEl) lEl.textContent = letter || '';
  if (colorOverride) lEl.style.color = colorOverride;
}

// ── Autocheck ──────────────────────────────────────
function runAutocheckCell(r, c) {
  const answer = puzzle?.solution?.[r]?.[c];
  const entered = cells[key(r, c)]?.letter;
  const el = cellEl(r, c);
  if (!el || !entered) return;
  el.classList.toggle('correct', entered === answer);
  el.classList.toggle('wrong',   entered !== answer);
}

// ── Remote cursors ─────────────────────────────────
function broadcastCursor(r, c) {
  if (!window._fb) return;
  const { set, ref, db } = window._fb;
  set(ref(db, `lobbies/${session.lobbyCode}/cursors/${session.playerId}`), {
    row: r, col: c, color: identity.color,
  }).catch(() => {});
}

function renderRemoteCursor(playerId, row, col, color) {
  if (playerId === session.playerId) return;
  let el = remoteCursors[playerId];
  if (!el) {
    el = document.createElement('div');
    el.className = 'remote-cursor';
    el.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20">
        <path d="M2 2 L2 16 L6 12 L10 18 L12 17 L8 11 L14 11 Z"
              fill="${color}" stroke="#000" stroke-width="1"/>
      </svg>
      <div class="remote-cursor-label" style="color:${color}">${players[playerId]?.name || ''}</div>`;
    gameGrid.appendChild(el);
    remoteCursors[playerId] = el;
  }
  const target = cellEl(row, col);
  if (target) {
    const rect = target.getBoundingClientRect();
    const gridRect = gameGrid.getBoundingClientRect();
    el.style.left = `${rect.left - gridRect.left}px`;
    el.style.top  = `${rect.top  - gridRect.top}px`;
  }
}

// ── Timer ──────────────────────────────────────────
function startTimer() {
  timerSec = 0;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timerSec++;
    gameTimer.textContent = formatTime(timerSec);
    if (timerSec > 3600) gameTimer.classList.add('warn');
  }, 1000);
}

// ── Scores & players ───────────────────────────────
function renderScores() {
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
  gameScoreList.innerHTML = '';
  sorted.forEach(([id, pts], i) => {
    const p = players[id] || {};
    const row = document.createElement('div');
    row.className = 'game-score-row';
    row.innerHTML = `
      <span class="game-score-rank">${i + 1}</span>
      <span class="game-score-name" style="color:${p.color || 'var(--text)'}">${p.name || 'Player'}</span>
      <span class="game-score-pts">${pts}</span>`;
    gameScoreList.appendChild(row);
  });
}

function renderPlayerDots() {
  gamePlayersStrip.innerHTML = '';
  Object.entries(players).forEach(([id, p]) => {
    const dot = document.createElement('div');
    dot.className = 'game-player-dot';
    applyAvatar(dot, p);
    dot.innerHTML += `<span class="gpd-tooltip">${p.name || 'Player'}</span>`;
    if (session.isHost && id !== session.playerId) {
      dot.style.cursor = 'pointer';
      dot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openCtxMenu('game-player-ctx-menu', e);
      });
    }
    gamePlayersStrip.appendChild(dot);
  });
}

// ── In-game chat ───────────────────────────────────
function appendGameChat({ name, color, text }) {
  const msg = document.createElement('div');
  msg.style.cssText = 'font-size:12px;padding:2px 0;color:var(--text2);line-height:1.4';
  msg.innerHTML = `<span style="color:${color || 'var(--text2)'};font-weight:600">${name}: </span>${text}`;
  gameChatList.appendChild(msg);
  gameChatList.scrollTop = gameChatList.scrollHeight;
}

async function sendGameChat() {
  const text = gameChatInput.value.trim();
  if (!text) return;
  gameChatInput.value = '';
  try {
    await sendChatMessage(session.lobbyCode, session.playerId, text);
  } catch { showToast('Could not send.'); }
}

// ── Host toolbar ───────────────────────────────────
function toggleHostToolbar() {
  const open = hostToolbarBody.style.display !== 'none';
  hostToolbarBody.style.display = open ? 'none' : 'block';
  hostToolbarChevron.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
}

async function hostCheck(scope) {
  try {
    await checkGrid(session.lobbyCode, scope, selectedCell, session.playerId);
  } catch { showToast('Check failed.'); }
}

async function hostReveal(scope) {
  if (scope === 'grid') {
    openOverlay('reveal-grid-overlay');
  } else {
    try {
      await revealGrid(session.lobbyCode, scope, selectedCell);
    } catch { showToast('Reveal failed.'); }
  }
}

function toggleAutocheck() {
  autocheckEnabled = !autocheckEnabled;
  autocheckPill.classList.toggle('on', autocheckEnabled);
  autocheckPill.querySelector('.pill-label').textContent = autocheckEnabled ? 'Autocheck On' : 'Autocheck';
}

// ── Game over ──────────────────────────────────────
function showGameOver(isTogetherMode) {
  clearInterval(timerInterval);
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
  const podium = document.getElementById('game-over-podium');
  if (!podium) return;
  podium.innerHTML = '';
  sorted.forEach(([id, pts], i) => {
    const p = players[id] || {};
    const row = document.createElement('div');
    row.className = 'game-over-row' + (!isTogetherMode && i === 0 ? ' winner' : '');
    const dot = document.createElement('div');
    dot.style.cssText = `width:28px;height:28px;border-radius:50%;flex-shrink:0;
      background:${p.color};display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;color:#fff`;
    applyAvatar(dot, p);
    row.innerHTML = `<span style="font-size:13px;color:var(--text3);min-width:20px">${i + 1}</span>`;
    row.appendChild(dot);
    row.innerHTML += `<span style="flex:1;font-weight:600">${p.name || 'Player'}</span>
                      <span style="font-weight:700">${pts} pts</span>`;
    podium.appendChild(row);
  });

  const timeStr = formatTime(timerSec);
  document.getElementById('game-over-title').textContent =
    isTogetherMode ? `Puzzle completed in ${timeStr}` : 'Game Ended';
  document.getElementById('game-over-subtitle').textContent =
    isTogetherMode ? '' : `Completed in ${timeStr}`;

  openOverlay('game-over-overlay');
}

function doLeaveGame() {
  closeOverlay('leave-confirm-overlay');
  clearInterval(timerInterval);
  sessionStorage.setItem('isHost', '0');
  navigate('index');
}

function doGoBackToLobby() {
  closeOverlay('back-to-lobby-confirm-overlay');
  closeOverlay('game-over-overlay');
  clearInterval(timerInterval);
  navigate('lobby');
}

async function doForfeit() {
  closeOverlay('forfeit-confirm-overlay');
  try { await forfeitGame(session.lobbyCode); }
  catch { /* ignore */ }
  showGameOver(session.gameMode === 'together');
}

// ── Firebase subscription ──────────────────────────
function subscribeToGame() {
  if (!window._fb) {
    console.warn('Firebase not available — game sync disabled');
    return () => {};
  }
  const { onValue, ref, db } = window._fb;

  // Cell sync
  const cellsRef = ref(db, `games/${session.lobbyCode}/cells`);
  const unCells = onValue(cellsRef, (snap) => {
    const data = snap.val() || {};
    Object.entries(data).forEach(([k, v]) => {
      cells[k] = v;
      const [r, c] = k.split(',').map(Number);
      renderCellLetter(r, c, v.letter, players[v.owner]?.color);
    });
  });

  // Score sync
  const scoresRef = ref(db, `games/${session.lobbyCode}/scores`);
  const unScores = onValue(scoresRef, (snap) => {
    scores = snap.val() || {};
    renderScores();
  });

  // Cursor sync
  const cursorsRef = ref(db, `lobbies/${session.lobbyCode}/cursors`);
  const unCursors = onValue(cursorsRef, (snap) => {
    const data = snap.val() || {};
    Object.entries(data).forEach(([pid, cur]) => {
      const p = players[pid];
      renderRemoteCursor(pid, cur.row, cur.col, p?.color || '#fff');
    });
  });

  // Game-end signal
  const gameRef = ref(db, `lobbies/${session.lobbyCode}/gameSettings`);
  const unGame = onValue(gameRef, (snap) => {
    const gs = snap.val() || {};
    if (gs.gameEnded) showGameOver(session.gameMode === 'together');
    if (gs.autocheckEnabled !== undefined) {
      autocheckEnabled = gs.autocheckEnabled;
      autocheckPill?.classList.toggle('on', autocheckEnabled);
    }
  });

  return () => { unCells(); unScores(); unCursors(); unGame(); };
}

// ── Event listeners ────────────────────────────────
document.addEventListener('keydown', onKeyDown);
gameHiddenInput.addEventListener('input', onHiddenInput);
gameChatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendGameChat(); });

hostToolbarHeader?.addEventListener('click', toggleHostToolbar);
document.getElementById('host-check-letter-btn')?.addEventListener('click', () => hostCheck('letter'));
document.getElementById('host-check-word-btn')?.addEventListener('click',   () => hostCheck('word'));
document.getElementById('host-check-grid-btn')?.addEventListener('click',   () => hostCheck('grid'));
document.getElementById('host-reveal-letter-btn')?.addEventListener('click',() => hostReveal('letter'));
document.getElementById('host-reveal-word-btn')?.addEventListener('click',  () => hostReveal('word'));
document.getElementById('host-reveal-grid-btn')?.addEventListener('click',  () => hostReveal('grid'));
autocheckPill?.addEventListener('click', toggleAutocheck);

document.getElementById('reveal-grid-cancel-btn')?.addEventListener('click', () => closeOverlay('reveal-grid-overlay'));
document.getElementById('reveal-grid-confirm-btn')?.addEventListener('click', async () => {
  closeOverlay('reveal-grid-overlay');
  try { await revealGrid(session.lobbyCode, 'grid', null); }
  catch { showToast('Reveal failed.'); }
});

document.getElementById('action-confirm-cancel-btn')?.addEventListener('click', () => closeOverlay('action-confirm-overlay'));
document.getElementById('forfeit-cancel-btn')?.addEventListener('click', () => closeOverlay('forfeit-confirm-overlay'));
document.getElementById('forfeit-confirm-btn')?.addEventListener('click', doForfeit);

document.getElementById('back-to-lobby-btn')?.addEventListener('click', () => openOverlay('back-to-lobby-confirm-overlay'));
document.getElementById('back-to-lobby-stay-btn')?.addEventListener('click', () => closeOverlay('back-to-lobby-confirm-overlay'));
document.getElementById('back-to-lobby-confirm-btn')?.addEventListener('click', doGoBackToLobby);

document.getElementById('game-quit-btn')?.addEventListener('click', () => openOverlay('leave-confirm-overlay'));
document.getElementById('leave-game-stay-btn')?.addEventListener('click', () => closeOverlay('leave-confirm-overlay'));
document.getElementById('leave-game-confirm-btn')?.addEventListener('click', doLeaveGame);

document.getElementById('game-over-leave-btn')?.addEventListener('click', doLeaveGame);
document.getElementById('game-over-play-again-btn')?.addEventListener('click', doGoBackToLobby);

document.getElementById('game-rename-cancel-btn')?.addEventListener('click', () => closeOverlay('game-rename-overlay'));
document.getElementById('game-rename-save-btn')?.addEventListener('click', async () => {
  const name  = document.getElementById('game-rename-input').value.trim();
  const color = identity.color;
  if (!name) return;
  closeOverlay('game-rename-overlay');
  try { await updatePlayerProfile(session.lobbyCode, session.playerId, name, color); }
  catch { showToast('Profile update failed.'); }
});

chatGuessBtn?.addEventListener('click', () => {
  chatGuessMode = !chatGuessMode;
  chatGuessBtn.classList.toggle('active', chatGuessMode);
});

// ── Bootstrap ──────────────────────────────────────
(async function init() {
  // Show host toolbar if applicable
  if (session.isHost && hostToolbar) hostToolbar.style.display = 'flex';

  // Load puzzle and player data from server
  try {
    const res = await fetch(`/api/games/${session.lobbyCode}/state`);
    const state = await res.json();
    puzzle  = state.puzzle;
    players = state.players || {};
    scores  = state.scores  || {};
    session.gameMode = state.mode || 'together';

    buildGrid(puzzle);
    renderPlayerDots();
    renderScores();
  } catch (err) {
    showToast('Could not load game. Returning to lobby…');
    console.error(err);
    setTimeout(() => navigate('lobby'), 2000);
    return;
  }

  startTimer();
  const unsubscribe = subscribeToGame();

  // Cleanup on navigation away
  window.addEventListener('beforeunload', () => {
    clearInterval(timerInterval);
    unsubscribe();
  });
})();
