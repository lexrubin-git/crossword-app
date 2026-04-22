// ── game.controller.js ──
import { state, COLORS, showToast, chatNameColor } from '../state.js';
import { openOverlay, closeOverlay, openAvatarLightbox, buildColorSwatches, updateChip } from '../ui.helpers.js';
import {
  pushCellToFB, fetchGridSnapshot as fetchGridSnapshotFB,
  startCellSyncListener, startScoreSyncListener, pushScoreToFB, pushAllScoresToFB,
  startPlayerInfoListener, pushGameSettingFB, startGameSettingsListener,
  sendGameChatFB, startGameChatListener,
  startCursorListener, pushCursorToFB, removeCursorFromFB, setupCursorDisconnect,
  pushVersusGridToFB, removeVersusGridFromFB, startVersusGridListener,
  pushVersusPlayerCellToFB, fetchVersusPlayerGrid, clearVersusPlayerGrid,
  setPlayerInGame, clearGameGridFB,
  transferHost, removePlayer, updatePlayer,
} from '../api.service.js';
import { parseNytPuzzle, formatNytDateLabel } from '../puzzle.js';
import { fetchNytPuzzle } from '../api.service.js';

// ── Game state ──
let currentMap    = null;
let gameGrid      = [];
let gameScores    = {};
let gameWords     = [];
let selectedCell  = null;
let selectedDir   = 'across';
let selectedWord  = null;
let gameTimerSec  = 0;
let gameTimerInterval = null;
let autocheckEnabled = false;
let chatGuessMode = false;
let chatGuessHard = false;

// Listener unsubscribe functions
let _stopCellSync     = null;
let _stopScoreSync    = null;
let _stopPlayerInfo   = null;
let _stopGameSettings = null;
let _stopGameChat     = null;
let _stopCursor       = null;
let _stopVersusGrid   = null;

// Cursor tracking
const remoteCursorEls = {};
let cursorMoveHandler = null;
let cursorLeaveHandler = null;
let cursorThrottleTimer = null;
let _cursorContainer = null;

// Versus grid
let _versusGridPushTimer = null;

// Cell element cache
const cellElCache = {};
function getCellEl(r, c) { return cellElCache[r+'_'+c] || null; }

// Highlight tracking
let _highlightedCells = new Set();
let _selectedCellKey  = null;
let _wordHighlightKeys = new Set();

// Fake clue bank
const CLUE_BANK = {
  across: ['Start of a chess match','Body of water','Opposite of night','Greek letter','It follows do re','Before beta','Winged mammal','Color of sky','Not false','Cooking vessel','Rodent','Feline pet','Canine companion','Citrus fruit','Hot drink','Cold season','Warm season','Opposite of cold','Number after one','Shape with three sides','Royal headwear','Writing instrument','Open fire','Type of tree','Ocean motion','Day star','Night luminary','Musical note','Unit of time','Compass direction','Carpenter\'s tool','Precious stone'],
  down:   ['Opposite of yes','Greeting word','Farewell word','Small insect','Flying mammal at night','Type of pasta','Spice rack staple','Unit of weight','Element symbol for gold','Roman numeral for 4','Archaic \'you\'','Conclude','Swift bird','Alpine song style','Baby sheep','Shoe part','Bone connector','Feathered flyer','River blocker','Carpenter\'s adhesive','Icy precipitation','Desert plant','Musical tempo word','Pronoun for a ship','Small measurement','Before noon abbr.','After noon abbr.','Exist','Frozen water','Large body of water','In that place','Opposite of off'],
};
function pickClue(bank, idx) { return bank[idx % bank.length]; }

// ── Build word list ──
function buildWords(map) {
  if (map._nytWords) return { words: map._nytWords, cellNum: map._nytCellNum };
  const size = map.size;
  const blackSet = new Set(map.blacks.map(([r,c]) => r+'_'+c));
  const isBlack = (r,c) => blackSet.has(r+'_'+c);
  const inBounds = (r,c) => r>=0 && r<size && c>=0 && c<size;
  let words = [], cellNum = {}, num = 1;
  for (let r=0; r<size; r++) {
    for (let c=0; c<size; c++) {
      if (isBlack(r,c)) continue;
      const startAcross = (c===0||isBlack(r,c-1)) && inBounds(r,c+1) && !isBlack(r,c+1);
      const startDown   = (r===0||isBlack(r-1,c)) && inBounds(r+1,c) && !isBlack(r+1,c);
      if (startAcross || startDown) {
        cellNum[r+'_'+c] = num;
        if (startAcross) {
          let cells = [];
          for (let cc=c; cc<size && !isBlack(r,cc); cc++) cells.push({row:r,col:cc});
          words.push({ num, dir:'across', row:r, col:c, length:cells.length, cells,
            answer: cells.map((_,i)=>String.fromCharCode(65+((num*7+i*3)%26))).join(''),
            clue: pickClue(CLUE_BANK.across, num-1) });
        }
        if (startDown) {
          let cells = [];
          for (let rr=r; rr<size && !isBlack(rr,c); rr++) cells.push({row:rr,col:c});
          words.push({ num, dir:'down', row:r, col:c, length:cells.length, cells,
            answer: cells.map((_,i)=>String.fromCharCode(65+((num*11+i*5)%26))).join(''),
            clue: pickClue(CLUE_BANK.down, num-1) });
        }
        num++;
      }
    }
  }
  return { words, cellNum };
}

// ── Enter game ──
function enterGame(map, gameMode) {
  window._gameMode = gameMode || 'together';
  window._joiningGame = false;
  window._puzzleCompletionAllowed = false;
  window._snapshotLoaded = false;
  autocheckEnabled = false;
  chatGuessMode = false;
  chatGuessHard = false;

  document.getElementById('game-over-overlay')?.classList.add('hidden');

  currentMap = map;
  window.currentMap = map;
  const size = map.size;
  const numCols = map.cols || size;
  const blackSet = new Set(map.blacks.map(([r,c]) => r+'_'+c));

  // Mark in-game
  if (state.activeLobbyCode && state.myPlayerId) {
    setPlayerInGame(state.activeLobbyCode, state.myPlayerId, true);
  }

  // Init grid
  gameGrid = Array.from({length:size}, () =>
    Array.from({length:numCols}, () => ({ letter:'', filledBy:null, filledColor:null, isBlack:false }))
  );
  window.gameGrid = gameGrid;
  map.blacks.forEach(([r,c]) => {
    if (r < size && c < numCols) gameGrid[r][c].isBlack = true;
  });

  const built = buildWords(map);
  gameWords = built.words;
  window.gameWords = gameWords;
  const cellNum = built.cellNum;

  gameScores = {};
  Object.keys(state.lastKnownPlayers).forEach(id => { gameScores[id] = 0; });
  if (state.myPlayerId && !gameScores[state.myPlayerId]) gameScores[state.myPlayerId] = 0;

  // Timer
  gameTimerSec = 0;
  clearInterval(gameTimerInterval);
  if (state.activeLobbyCode && window._fb) {
    const { get, ref, db } = window._fb;
    get(ref(db, `lobbies/${state.activeLobbyCode}/startedAt`)).then(snap => {
      if (snap.exists()) {
        const ts = snap.val();
        window._lastGameStartedAt = ts;
        const elapsed = Math.floor((Date.now() - ts) / 1000);
        if (elapsed > 0) gameTimerSec = elapsed;
      }
    }).catch(() => {});
  }
  gameTimerInterval = setInterval(() => {
    gameTimerSec++;
    const m = Math.floor(gameTimerSec/60), s = gameTimerSec%60;
    const el = document.getElementById('game-timer');
    if (el) el.textContent = m+':'+(s<10?'0':'')+s;
  }, 1000);

  // UI
  selectedCell = null; selectedDir = 'across'; selectedWord = null;
  const gcm = document.getElementById('game-chat-messages');
  if (gcm) gcm.innerHTML = '<div class="game-chat-empty" id="game-chat-empty">No messages yet…</div>';
  const gcs = document.getElementById('game-chat-send');
  if (gcs) gcs.disabled = true;
  const gci = document.getElementById('game-chat-input');
  if (gci) gci.value = '';

  // Render
  renderGameGrid(size, cellNum, blackSet);
  renderClues();
  renderGameScores();
  window.scrollTo(0,0);

  // Post-layout pass
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      renderGameGrid(size, cellNum, blackSet);
      Object.values(cellElCache).forEach(el => el.classList.remove('wrong','correct','has-letter'));
      window._gridReady = true;
      applyChatGuessModeUI(false, false);

      // Show host toolbar
      const toolbar = document.getElementById('game-host-toolbar');
      if (toolbar) toolbar.style.display = state.isHost ? 'flex' : 'none';
      const codeEl = document.getElementById('game-lobby-code');
      if (codeEl) codeEl.textContent = state.activeLobbyCode || '—';

      if (window._gameMode === 'versus') {
        autocheckEnabled = true;
        updateAutocheckPill(true);
        // Hide check/reveal in versus
        ['host-check-group','host-check-divider','host-reveal-group','host-reveal-divider']
          .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        stopCursorTracking();
        window._puzzleCompletionAllowed = true;
        if (_stopGameSettings) { _stopGameSettings(); _stopGameSettings = null; }
        _stopGameSettings = startGameSettingsListener(state.activeLobbyCode, snap => {
          const s = snap.val() || {};
          applyGameSettings(s);
        });
        // Restore this player's own versus grid from private path
        fetchVersusPlayerGrid(state.activeLobbyCode, state.myPlayerId).then(snap => {
          if (snap) applyFullGridSnapshot(snap);
          window._snapshotLoaded = true;
          pushVersusGridState();
        }).catch(() => { window._snapshotLoaded = true; });
        startVersusGridPreview();
      } else {
        // Restore check/reveal
        ['host-check-group','host-check-divider','host-reveal-group','host-reveal-divider']
          .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
        startCursorTracking();
        if (_stopCellSync) { _stopCellSync(); _stopCellSync = null; }
        fetchGridSnapshotFB(state.activeLobbyCode).then(snap => {
          if (snap) applyFullGridSnapshot(snap);
          window._snapshotLoaded = true;
          _stopCellSync = startCellSyncListener(state.activeLobbyCode, applySnap, applySnap);
          if (_stopGameSettings) { _stopGameSettings(); _stopGameSettings = null; }
          _stopGameSettings = startGameSettingsListener(state.activeLobbyCode, s => applyGameSettings(s.val() || {}));
          if (state.isHost) window._snapshotLoaded = true;
        }).catch(() => {
          window._snapshotLoaded = true;
          if (_stopGameSettings) { _stopGameSettings(); _stopGameSettings = null; }
          _stopGameSettings = startGameSettingsListener(state.activeLobbyCode, s => applyGameSettings(s.val() || {}));
        });
        setTimeout(() => { window._puzzleCompletionAllowed = true; }, 500);
        if (state.isHost) window._snapshotLoaded = true;
      }

      if (_stopGameChat) { _stopGameChat(); _stopGameChat = null; }
      _stopGameChat = startGameChatListener(state.activeLobbyCode, snap => {
        const msgs = snap.val();
        if (!msgs) return;
        const list = Object.values(msgs).sort((a,b) => a.ts - b.ts);
        renderGameChatMessages(list);
      });

      // Non-host mode indicator
      setTimeout(() => {
        const nhIndicator = document.getElementById('nonhost-mode-indicator');
        if (!nhIndicator) return;
        const isVersus = window._gameMode === 'versus';
        if (isVersus) {
          nhIndicator.style.display = '';
          nhIndicator.innerHTML = '<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;background:rgba(255,255,255,0.1);border:1px solid var(--border2);color:var(--text);letter-spacing:.05em;text-transform:uppercase;vertical-align:middle">Versus</span>&nbsp; Race to complete the grid first — your grid is private';
        } else if (!state.isHost) {
          nhIndicator.style.display = '';
          nhIndicator.innerHTML = 'Mode: type into grid to guess';
          nhIndicator.style.color = 'var(--text3)';
        } else {
          nhIndicator.style.display = 'none';
        }
      }, 200);

      // ResizeObserver for grid re-render
      const gridWrap = document.querySelector('.game-grid-wrap');
      if (gridWrap && window._gridResizeObserver) window._gridResizeObserver.disconnect();
      if (gridWrap && typeof ResizeObserver !== 'undefined') {
        let _resizeTimer;
        window._gridResizeObserver = new ResizeObserver(() => {
          clearTimeout(_resizeTimer);
          _resizeTimer = setTimeout(() => {
            renderGameGrid(size, cellNum, blackSet);
            restoreGridLetters();
            updateGridHighlight();
          }, 80);
        });
        window._gridResizeObserver.observe(gridWrap);
      }
    });
  });

  // Stop old listeners, start fresh
  if (_stopScoreSync)    { _stopScoreSync();    _stopScoreSync    = null; }
  if (_stopPlayerInfo)   { _stopPlayerInfo();   _stopPlayerInfo   = null; }
  stopCursorTracking();
  if (_stopCellSync)     { _stopCellSync();     _stopCellSync     = null; }
  if (_stopGameSettings) { _stopGameSettings(); _stopGameSettings = null; }

  const _returningFromGame = sessionStorage.getItem('returningFromGame') === '1';
  sessionStorage.removeItem('returningFromGame');
  const _freshStart = sessionStorage.getItem('freshGameStart') === '1';
  sessionStorage.removeItem('freshGameStart');
  if (state.isHost && !window._isRejoin && !_returningFromGame && _freshStart) {
    clearGameGridFB(state.activeLobbyCode);
    pushGameSettingFB(state.activeLobbyCode, 'chatGuessMode', false);
    pushGameSettingFB(state.activeLobbyCode, 'chatGuessHard', false);
    pushGameSettingFB(state.activeLobbyCode, 'autocheck', false);
  }
  window._isRejoin = false;

  _stopScoreSync = startScoreSyncListener(state.activeLobbyCode, snap => {
    const data = snap.val() || {};
    const knownIds = new Set(Object.keys(state.lastKnownPlayers));
    if (state.myPlayerId) knownIds.add(state.myPlayerId);
    Object.entries(data).forEach(([id, entry]) => {
      if (!state.isHost && id === state.myPlayerId) { gameScores[id] = entry.score || 0; return; }
      if (id === state.myPlayerId) return;
      if (knownIds.has(id)) gameScores[id] = entry.score || 0;
    });
    renderGameScores();
  });

  _stopPlayerInfo = startPlayerInfoListener(state.activeLobbyCode, snap => {
    const players = snap.val() || {};

    // FIX: kicked detection — if we're no longer in the players list, redirect
    if (state.myPlayerId && !players[state.myPlayerId] && !state.isHost) {
      stopAllListeners();
      showToast('You were kicked from the game.');
      setTimeout(() => { window.location.href = 'index.html'; }, 1200);
      return;
    }

    Object.entries(players).forEach(([id, p]) => {
      if (!p) return;
      if (!state.lastKnownPlayers[id]) state.lastKnownPlayers[id] = {};
      const prev = state.lastKnownPlayers[id].colorHex;
      if (p.name) state.lastKnownPlayers[id].name = p.name;
      if (p.colorHex) state.lastKnownPlayers[id].colorHex = p.colorHex;
      if (p.avatar !== undefined) state.lastKnownPlayers[id].avatar = p.avatar;
      if (typeof p.isHost === 'boolean') state.lastKnownPlayers[id].isHost = p.isHost;

      if (id !== state.myPlayerId && p.colorHex && prev && p.colorHex !== prev) {
        repaintGameChatColor(id, p.name || state.lastKnownPlayers[id].name, p.colorHex);
        // Repaint grid cells
        if (gameWords && gameGrid) {
          const processed = new Set();
          gameWords.forEach(w => w.cells.forEach(c => {
            const key = c.row+'_'+c.col;
            if (processed.has(key)) return;
            processed.add(key);
            const cell = gameGrid[c.row]?.[c.col];
            if (!cell || !cell.letter || cell.filledBy !== id || cell.revealed) return;
            cell.filledColor = p.colorHex;
            const letterEl = document.getElementById(`cell-letter-${c.row}-${c.col}`);
            if (letterEl) letterEl.style.color = p.colorHex;
          }));
        }
      }

      if (id === state.myPlayerId) {
        if (p.name) state.playerName = p.name;
        if (p.colorHex) { const found = COLORS.find(c => c.hex === p.colorHex); if (found) state.playerColor = found; }
        if (typeof p.isHost === 'boolean' && p.isHost !== state.isHost) {
          state.isHost = p.isHost;
          const toolbar = document.getElementById('game-host-toolbar');
          if (toolbar) toolbar.style.display = state.isHost ? 'flex' : 'none';
          const nhIndicator = document.getElementById('nonhost-mode-indicator');
          if (nhIndicator) nhIndicator.style.display = state.isHost ? 'none' : '';
        }
      }
    });
    // Host disconnect in-game
    const hostPresent = Object.values(players).some(p => p?.isHost);
    if (!hostPresent && !state.isHost && state.activeLobbyCode && state.myPlayerId) {
      const ids = Object.keys(players).sort();
      if (ids.length > 0 && ids[0] === state.myPlayerId) {
        state.isHost = true;
        if (window._fb) {
          const { update, ref, db } = window._fb;
          const upd = {};
          upd[`players/${state.myPlayerId}/isHost`] = true;
          upd['host'] = state.myPlayerId;
          update(ref(db, `lobbies/${state.activeLobbyCode}`), upd).catch(() => {});
        }
        const toolbar = document.getElementById('game-host-toolbar');
        if (toolbar) toolbar.style.display = 'flex';
        const nhIndicator = document.getElementById('nonhost-mode-indicator');
        if (nhIndicator) nhIndicator.style.display = 'none';
      }
    }
    // Live-update versus preview grid player info
    if (window._gameMode === 'versus') {
      const wrap = document.getElementById('versus-previews-wrap');
      if (wrap) {
        Object.entries(players).forEach(([id, p]) => {
          if (id === state.myPlayerId || !p) return;
          const colorHex = state.lastKnownPlayers[id]?.colorHex || '#888';
          const name = state.lastKnownPlayers[id]?.name || 'Player';
          const avatarData = state.lastKnownPlayers[id]?.avatar || null;
          wrap.querySelectorAll('.versus-preview-player').forEach(playerDiv => {
            const nameEl = playerDiv.querySelector('div[style*="text-align:center"]');
            const avatarEl = playerDiv.querySelector('div[style*="border-radius:50%"]');
            if (!nameEl || !avatarEl) return;
            nameEl.style.color = colorHex;
            nameEl.textContent = name;
            avatarEl.style.backgroundColor = colorHex;
            avatarEl.style.borderColor = colorHex;
            if (avatarData) {
              avatarEl.style.backgroundImage = `url(${avatarData})`;
              avatarEl.textContent = '';
            } else {
              avatarEl.style.backgroundImage = '';
              avatarEl.textContent = (name || '?').charAt(0).toUpperCase();
            }
          });
        });
      }
    }
    renderGameScores();
  });
}

// ── Grid rendering ──
function renderGameGrid(size, cellNum, blackSet) {
  const numCols = (currentMap?.cols) || size;
  const container = document.getElementById('game-grid');
  if (!container) return;
  const gridWrap = document.querySelector('.game-grid-wrap');
  let availW = 0;
  if (gridWrap && gridWrap.clientWidth > 20) availW = gridWrap.clientWidth - 28;
  else availW = Math.max(300, window.innerWidth - 380 - 340 - 28);
  availW = Math.min(availW, 680);
  const cellPx = Math.floor(availW / numCols);
  const totalW = cellPx * numCols;
  const totalH = cellPx * size;

  container.style.gridTemplateColumns = `repeat(${numCols}, ${cellPx}px)`;
  container.style.gridTemplateRows    = `repeat(${size}, ${cellPx}px)`;
  container.style.width  = totalW + 'px';
  container.style.height = totalH + 'px';
  container.style.aspectRatio = 'unset';
  container.innerHTML = '';
  Object.keys(cellElCache).forEach(k => delete cellElCache[k]);

  for (let r=0; r<size; r++) {
    for (let c=0; c<numCols; c++) {
      const cell = document.createElement('div');
      cell.className = 'game-cell' + (gameGrid[r][c].isBlack ? ' black' : '');
      cell.dataset.row = r; cell.dataset.col = c;
      cell.style.width  = cellPx + 'px';
      cell.style.height = cellPx + 'px';
      if (!gameGrid[r][c].isBlack) {
        cellElCache[r+'_'+c] = cell;
        const n = cellNum[r+'_'+c];
        if (n) {
          const num = document.createElement('div');
          num.className = 'game-cell-num';
          num.textContent = n;
          cell.appendChild(num);
        }
        const letter = document.createElement('div');
        letter.className = 'game-cell-letter';
        letter.id = `cell-letter-${r}-${c}`;
        cell.appendChild(letter);
        const dot = document.createElement('div');
        dot.className = 'game-cell-owner';
        dot.id = `cell-owner-${r}-${c}`;
        cell.appendChild(dot);
        cell.addEventListener('click', () => onCellClick(r, c));
      }
      container.appendChild(cell);
    }
  }
}

function restoreGridLetters() {
  if (!gameWords || !gameGrid) return;
  const size = currentMap?.size;
  if (!size) return;
  const numCols = currentMap?.cols || size;
  for (let r=0; r<size; r++) {
    for (let c=0; c<numCols; c++) {
      const cell = gameGrid[r]?.[c];
      if (!cell || cell.isBlack || !cell.letter) continue;
      const letterEl = document.getElementById(`cell-letter-${r}-${c}`);
      if (letterEl) { letterEl.textContent = cell.letter; letterEl.style.color = cell.revealed ? '#000000' : (cell.filledColor || '#1a1a1a'); }
      const cellEl = getCellEl(r, c);
      if (cellEl) {
        cellEl.classList.add('has-letter');
        if (cell.revealed) { cellEl.classList.add('correct'); cellEl.classList.remove('wrong'); }
        else if (autocheckEnabled || chatGuessMode) autocheckCell(r, c);
      }
    }
  }
}

// ── Cell click ──
function onCellClick(r, c) {
  if (gameGrid[r][c].isBlack) return;
  if (selectedCell && selectedCell.row===r && selectedCell.col===c) {
    selectedDir = selectedDir==='across' ? 'down' : 'across';
  }
  selectedCell = {row:r, col:c};
  let word = gameWords.find(w => w.dir===selectedDir && w.cells.some(cc=>cc.row===r&&cc.col===c));
  if (!word) word = gameWords.find(w => w.cells.some(cc=>cc.row===r&&cc.col===c));
  if (word) selectedDir = word.dir;
  selectedWord = word || null;
  updateGridHighlight();
  updateActiveClue();
  updateClueList();
  focusGameInput();
}

// ── Highlight ──
function updateGridHighlight() {
  const newSelKey = selectedCell ? selectedCell.row+'_'+selectedCell.col : null;
  const newWordKeys = new Set();
  if (selectedWord && selectedCell) {
    selectedWord.cells.forEach(({row:r,col:c}) => {
      const k = r+'_'+c;
      if (k !== newSelKey) newWordKeys.add(k);
    });
  }
  _wordHighlightKeys.forEach(k => {
    if (!newWordKeys.has(k) && k !== newSelKey) { const el = cellElCache[k]; if (el) el.classList.remove('word-highlight'); }
  });
  if (_selectedCellKey && _selectedCellKey !== newSelKey) { const el = cellElCache[_selectedCellKey]; if (el) el.classList.remove('selected'); }
  newWordKeys.forEach(k => { const el = cellElCache[k]; if (el) el.classList.add('word-highlight'); });
  if (newSelKey) { const el = cellElCache[newSelKey]; if (el) { el.classList.remove('word-highlight'); el.classList.add('selected'); } }
  _selectedCellKey = newSelKey;
  _wordHighlightKeys = newWordKeys;
}

// ── Active clue ──
function updateActiveClue() {
  const el = document.getElementById('game-active-clue-inner') || document.getElementById('game-active-clue');
  if (!el) return;
  if (!selectedWord) { el.textContent = 'Select a cell to begin'; return; }
  el.innerHTML = `<strong>${selectedWord.num} ${selectedWord.dir.charAt(0).toUpperCase()+selectedWord.dir.slice(1)}.</strong> ${selectedWord.clue}`;
}

// ── Clue list ──
function renderClues() {
  ['across','down'].forEach(dir => {
    const list = document.getElementById(`clue-${dir}`);
    if (!list) return;
    list.innerHTML = '';
    gameWords.filter(w=>w.dir===dir).forEach(w => {
      const item = document.createElement('div');
      item.className = 'game-clue-item';
      item.id = `clue-item-${dir}-${w.num}`;
      item.innerHTML = `<span class="game-clue-num">${w.num}</span><span class="game-clue-text">${w.clue}</span>`;
      item.addEventListener('click', () => {
        selectedDir = dir; selectedCell = {row:w.row,col:w.col}; selectedWord = w;
        updateGridHighlight(); updateActiveClue(); updateClueList(); focusGameInput();
      });
      list.appendChild(item);
    });
  });
}

function updateClueList() {
  document.querySelectorAll('.game-clue-item').forEach(el => el.classList.remove('active'));
  if (selectedWord) {
    const el = document.getElementById(`clue-item-${selectedWord.dir}-${selectedWord.num}`);
    if (el) { el.classList.add('active'); el.scrollIntoView({block:'nearest'}); }
  }
}

// ── Input ──
function focusGameInput() {
  if (chatGuessMode) { const ci = document.getElementById('game-chat-input'); if (ci) ci.focus(); return; }
  const inp = document.getElementById('game-hidden-input');
  if (inp) { inp.value = ''; inp.focus({preventScroll:true}); }
}

// ── Keyboard ──
function setupKeyboard() {
  const hiddenInput = document.getElementById('game-hidden-input');
  if (hiddenInput) {
    hiddenInput.addEventListener('input', e => {
      const gameActive = document.getElementById('screen-game')?.classList.contains('active') ?? true;
      if (!gameActive || !selectedCell) { hiddenInput.value = ''; return; }
      const val = hiddenInput.value.replace(/[^a-zA-Z]/g,'').toUpperCase();
      hiddenInput.value = '';
      if (!val) return;
      const {row, col} = selectedCell;
      const cellEl = getCellEl(row, col);
      if (autocheckEnabled && cellEl?.classList.contains('correct')) { advanceInWordAlways(); return; }
      typeLetter(val[val.length-1]);
    });
    hiddenInput.addEventListener('keydown', e => {
      if (e.key==='Backspace'||e.key==='Delete') { e.preventDefault(); eraseLetter(); }
      else if (e.key==='Tab')        { e.preventDefault(); }
      else if (e.key==='ArrowLeft')  { e.preventDefault(); moveCell(0,-1); }
      else if (e.key==='ArrowRight') { e.preventDefault(); moveCell(0, 1); }
      else if (e.key==='ArrowUp')    { e.preventDefault(); moveCell(-1,0); }
      else if (e.key==='ArrowDown')  { e.preventDefault(); moveCell( 1,0); }
    });
    document.addEventListener('click', e => {
      const renameOpen = !document.getElementById('game-rename-overlay')?.classList.contains('hidden');
      if (renameOpen) return;
      const chatInput = document.getElementById('game-chat-input');
      if (chatGuessMode) {
        if (e.target.closest('.game-cell') || e.target.closest('.game-clue-item')) setTimeout(() => chatInput?.focus(), 20);
        return;
      }
      if (document.activeElement === chatInput) return;
      if (e.target.closest('.game-cell') || e.target.closest('.game-clue-item')) setTimeout(() => hiddenInput.focus({preventScroll:true}), 50);
    });
  }

  document.addEventListener('keydown', e => {
    const renameOpen = !document.getElementById('game-rename-overlay')?.classList.contains('hidden');
    if (renameOpen) return;
    if (e.key==='Tab') {
      e.preventDefault();
      const chatInput = document.getElementById('game-chat-input');
      if (chatGuessMode) { advanceWord(e.shiftKey?-1:1); setTimeout(() => chatInput?.focus({preventScroll:true}), 0); return; }
      if (document.activeElement === chatInput) { hiddenInput?.focus({preventScroll:true}); return; }
      if (!selectedCell) return;
      advanceWord(e.shiftKey?-1:1); return;
    }
    if (document.activeElement === document.getElementById('game-chat-input')) {
      if (chatGuessMode && selectedCell) {
        for (const [key, dr, dc] of [['ArrowLeft',0,-1],['ArrowRight',0,1],['ArrowUp',-1,0],['ArrowDown',1,0]]) {
          if (e.key===key) { e.preventDefault(); moveCell(dr,dc); setTimeout(() => document.getElementById('game-chat-input')?.focus(), 0); return; }
        }
      }
      return;
    }
    if (!selectedCell) return;
    if (e.key==='ArrowLeft')  { e.preventDefault(); moveCell(0,-1); return; }
    if (e.key==='ArrowRight') { e.preventDefault(); moveCell(0, 1); return; }
    if (e.key==='ArrowUp')    { e.preventDefault(); moveCell(-1,0); return; }
    if (e.key==='ArrowDown')  { e.preventDefault(); moveCell( 1,0); return; }
    if (e.key==='Backspace'||e.key==='Delete') { e.preventDefault(); eraseLetter(); return; }
    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      if (chatGuessMode) {
        const ci = document.getElementById('game-chat-input');
        if (ci) { ci.focus(); ci.value += e.key.toUpperCase(); ci.dispatchEvent(new Event('input')); }
        return;
      }
      typeLetter(e.key.toUpperCase());
    }
  });
}

function moveCell(dr, dc) {
  if (!selectedCell) return;
  let {row,col} = selectedCell;
  const _rows = currentMap.size, _cols = currentMap.cols||currentMap.size;
  const nr=row+dr, nc=col+dc;
  if (nr<0||nr>=_rows||nc<0||nc>=_cols||gameGrid[nr][nc].isBlack) return;
  if (dr!==0) selectedDir='down';
  if (dc!==0) selectedDir='across';
  selectedCell={row:nr,col:nc};
  selectedWord = gameWords.find(w=>w.dir===selectedDir&&w.cells.some(c=>c.row===nr&&c.col===nc))
    || gameWords.find(w=>w.cells.some(c=>c.row===nr&&c.col===nc)) || null;
  if (selectedWord) selectedDir = selectedWord.dir;
  updateGridHighlight(); updateActiveClue(); updateClueList();
}

function advanceWord(delta) {
  const dir = selectedWord ? selectedWord.dir : selectedDir;
  const sameDir = [...gameWords].filter(w=>w.dir===dir).sort((a,b)=>a.num-b.num);
  if (!sameDir.length) return;
  const idx = selectedWord ? sameDir.indexOf(selectedWord) : -1;
  const total = sameDir.length;
  let next = null;
  for (let step=1; step<=total; step++) {
    const candidate = sameDir[(idx+delta*step+total*Math.abs(delta))%total];
    if (!candidate.cells.every(c=>!!gameGrid[c.row][c.col].letter)) { next=candidate; break; }
  }
  if (!next) next = sameDir[(idx+delta+total)%total];
  selectedWord=next; selectedDir=next.dir; selectedCell={row:next.row,col:next.col};
  const firstEmpty = next.cells.find(c=>!gameGrid[c.row][c.col].letter);
  if (firstEmpty) selectedCell=firstEmpty;
  updateGridHighlight(); updateActiveClue(); updateClueList(); focusGameInput();
}

function typeLetter(letter) {
  if (!selectedCell || chatGuessMode) return;
  const {row,col} = selectedCell;
  const cellEl = getCellEl(row,col);
  if (autocheckEnabled && cellEl?.classList.contains('correct')) { advanceInWordAlways(); return; }
  gameGrid[row][col].letter = letter;
  gameGrid[row][col].filledBy = state.myPlayerId;
  gameGrid[row][col].filledColor = state.playerColor.hex;
  const letterEl = document.getElementById(`cell-letter-${row}-${col}`);
  if (letterEl) { letterEl.textContent=letter; letterEl.style.color=state.playerColor.hex; }
  if (cellEl) cellEl.classList.add('has-letter');
  if (autocheckEnabled) recomputeScores();
  if (state.activeLobbyCode) {
    if (window._gameMode==='versus') {
      pushVersusPlayerCellToFB(state.activeLobbyCode, state.myPlayerId, row, col, letter, state.myPlayerId, state.playerColor.hex);
    } else {
      pushCellToFB(state.activeLobbyCode, row, col, letter, state.myPlayerId, state.playerColor.hex);
    }
  }
  if (window._gameMode==='versus' && state.activeLobbyCode) pushVersusGridState();
  advanceInWordAlways();
  autocheckCell(row,col);
  checkWordComplete();
  renderGameScores();
}

function advanceInWordAlways() {
  if (!selectedWord||!selectedCell) return;
  const cells = selectedWord.cells;
  const idx = cells.findIndex(c=>c.row===selectedCell.row&&c.col===selectedCell.col);
  for (let i=idx+1; i<cells.length; i++) {
    if (!gameGrid[cells[i].row][cells[i].col].letter) { selectedCell=cells[i]; updateGridHighlight(); return; }
  }
  if (idx < cells.length-1) selectedCell=cells[idx+1];
  else selectedCell=cells[cells.length-1];
  updateGridHighlight();
}

function eraseLetter() {
  if (!selectedCell) return;
  const {row,col} = selectedCell;
  const cellEl = getCellEl(row,col);
  if (autocheckEnabled && cellEl?.classList.contains('correct')) {
    if (selectedWord) { const cells=selectedWord.cells; const idx=cells.findIndex(c=>c.row===row&&c.col===col); if (idx>0) { selectedCell=cells[idx-1]; updateGridHighlight(); } }
    return;
  }
  if (gameGrid[row][col].letter) {
    gameGrid[row][col].letter=''; gameGrid[row][col].filledBy=null; gameGrid[row][col].filledColor=null;
    const letterEl=document.getElementById(`cell-letter-${row}-${col}`);
    if (letterEl) { letterEl.textContent=''; letterEl.style.color=''; }
    if (cellEl) cellEl.classList.remove('has-letter','wrong');
    if (state.activeLobbyCode) {
      if (window._gameMode==='versus') {
        pushVersusPlayerCellToFB(state.activeLobbyCode, state.myPlayerId, row, col, '', null, null);
      } else {
        pushCellToFB(state.activeLobbyCode,row,col,'',null,null);
      }
    }
    if (window._gameMode==='versus') pushVersusGridState();
  } else {
    if (selectedWord) { const cells=selectedWord.cells; const idx=cells.findIndex(c=>c.row===row&&c.col===col); if (idx>0) { selectedCell=cells[idx-1]; updateGridHighlight(); } }
  }
}

// ── Firebase cell sync ──
function applySnap(snap) {
  if (!window._gridReady) return;
  const key=snap.key; const val=snap.val();
  if (!val||!key) return;
  const [r,c]=key.split('_').map(Number);
  if (!gameGrid[r]||!gameGrid[r][c]||gameGrid[r][c].isBlack) return;
  applyRemoteCell(r,c,val.letter||'',val.filledBy,val.filledColor,val.revealed);
}

function applyFullGridSnapshot(snap) {
  snap.forEach(child => {
    const key=child.key; const val=child.val();
    if (!val||!key||!val.letter) return;
    const [r,c]=key.split('_').map(Number);
    if (!gameGrid[r]||!gameGrid[r][c]||gameGrid[r][c].isBlack) return;
    
    const revealed=!!(val.filledBy==='revealed'||val.revealed);
    gameGrid[r][c].letter=val.letter||'';
    gameGrid[r][c].filledBy=val.filledBy||'';
    gameGrid[r][c].filledColor=val.filledColor||'#888';
    gameGrid[r][c].revealed=revealed;
    const letterEl=document.getElementById(`cell-letter-${r}-${c}`);
    if (letterEl) { letterEl.textContent=val.letter; letterEl.style.color=revealed?'#000000':(val.filledColor||'#888'); }
    const cellEl=getCellEl(r,c);
    if (cellEl) {
      cellEl.classList.toggle('has-letter',!!val.letter);
      if (revealed) { cellEl.classList.add('correct','has-letter'); cellEl.classList.remove('wrong'); }
    }
  });
  window._snapshotLoaded=true;
  if (autocheckEnabled) { runAutocheck(); if (state.isHost) recomputeScores(); renderGameScores(); }
}

function applyRemoteCell(r,c,letter,filledBy,filledColor,revealed) {
  if (!gameGrid[r]||!gameGrid[r][c]||gameGrid[r][c].isBlack) return;
  const cellEl=getCellEl(r,c);
  const isColorOnly=letter&&letter===gameGrid[r][c].letter&&filledBy===gameGrid[r][c].filledBy;
  if (autocheckEnabled&&cellEl?.classList.contains('correct')&&filledBy!==state.myPlayerId&&!isColorOnly) return;
  const color=filledColor||'#1a1a1a';
  const isRevealed=filledBy==='revealed'||!!revealed;
  gameGrid[r][c].letter=letter; gameGrid[r][c].filledBy=filledBy; gameGrid[r][c].filledColor=color;
  gameGrid[r][c].revealed=isRevealed;
  const letterEl=document.getElementById(`cell-letter-${r}-${c}`);
  if (letterEl) { letterEl.textContent=letter||''; letterEl.style.color=letter?(isRevealed?'#000000':color):''; }
  if (cellEl) {
    cellEl.classList.toggle('has-letter',!!letter);
    if (!letter) cellEl.classList.remove('wrong','correct');
    else if (isRevealed) { cellEl.classList.add('correct','has-letter'); cellEl.classList.remove('wrong'); }
  }
  if (letter) autocheckCell(r,c);
  if (autocheckEnabled&&letter&&state.isHost) recomputeScores();
  gameWords.filter(w=>w.cells.some(cc=>cc.row===r&&cc.col===c)).forEach(w=>{
    const prev=selectedWord; selectedWord=w; checkWordComplete(); selectedWord=prev;
  });
  checkPuzzleComplete();
  renderGameScores();
}

// ── Autocheck ──
function autocheckCell(row,col) {
  if (!autocheckEnabled) return;
  const el=getCellEl(row,col);
  if (!el||!gameGrid[row]?.[col]) return;
  const cell=gameGrid[row][col];
  if (!cell.letter) { el.classList.remove('wrong','correct'); return; }
  if (cell.revealed) { el.classList.add('correct'); el.classList.remove('wrong'); return; }
  const allWords=gameWords.filter(w=>w.cells.some(c=>c.row===row&&c.col===col));
  if (!allWords.length) return;
  const correctInAll=allWords.every(w=>{
    const ii=w.cells.findIndex(c=>c.row===row&&c.col===col);
    return cell.letter===w.answer[ii];
  });
  if (correctInAll) { el.classList.remove('wrong'); el.classList.add('correct'); }
  else { el.classList.add('wrong'); el.classList.remove('correct'); }
}

function runAutocheck() {
  if (!autocheckEnabled||!window._snapshotLoaded) return;
  const processed=new Set();
  gameWords.forEach(w=>w.cells.forEach(c=>{
    const k=c.row+'_'+c.col;
    if (processed.has(k)) return;
    processed.add(k);
    autocheckCell(c.row,c.col);
  }));
}

function updateAutocheckPill(on) {
  const pill=document.getElementById('autocheck-pill');
  if (!pill) return;
  if (on) pill.classList.add('on'); else pill.classList.remove('on');
  const checkGroup=document.getElementById('host-check-group');
  if (checkGroup) {
    checkGroup.style.opacity=on?'0.35':'';
    checkGroup.style.pointerEvents=on?'none':'';
  }
}

// ── Scores ──
function recomputeScores() {
  Object.keys(gameScores).forEach(id=>{gameScores[id]=0;});
  gameWords.forEach(w=>{
    w.cells.forEach((c,i)=>{
      const cell=gameGrid[c.row][c.col];
      if (!cell.letter||cell.letter!==w.answer[i]) return;
      const allCorrect=gameWords.filter(ww=>ww.cells.some(cc=>cc.row===c.row&&cc.col===c.col))
        .every(ww=>{const ii=ww.cells.findIndex(cc=>cc.row===c.row&&cc.col===c.col);return gameGrid[c.row][c.col].letter===ww.answer[ii];});
      if (!allCorrect) return;
      const filler=cell.filledBy;
      if (filler&&filler!=='revealed'&&!cell._scored) {
        if (!gameScores.hasOwnProperty(filler)) gameScores[filler]=0;
        cell._scored=true;
        gameScores[filler]++;
      }
    });
  });
  gameWords.forEach(w=>w.cells.forEach(c=>{ delete gameGrid[c.row][c.col]._scored; }));
  if ((autocheckEnabled||chatGuessMode)&&state.activeLobbyCode&&state.myPlayerId) {
    if (state.isHost) {
      const scoresMap={};
      Object.entries(gameScores).forEach(([id,score])=>{
        const p=id===state.myPlayerId
          ? {name:state.playerName,colorHex:state.playerColor.hex,avatar:state.pixelAvatarData||null}
          : (state.lastKnownPlayers[id]||{});
        scoresMap[id]={score,name:p.name||'Player',colorHex:p.colorHex||'#888',avatar:p.avatar||null};
      });
      pushAllScoresToFB(state.activeLobbyCode,scoresMap);
    } else {
      pushScoreToFB(state.activeLobbyCode,state.myPlayerId,{score:gameScores[state.myPlayerId]||0,name:state.playerName,colorHex:state.playerColor.hex,avatar:state.pixelAvatarData||null});
    }
  }
}

function renderGameScores() {
  const list=document.getElementById('game-score-list');
  if (!list) return;
  const meId=state.myPlayerId;
  const knownIds=new Set(Object.keys(state.lastKnownPlayers));
  if (meId) knownIds.add(meId);
  const sorted=[...knownIds].map(id=>[id,gameScores[id]||0]).sort((a,b)=>b[1]-a[1]);
  list.innerHTML='';
  sorted.forEach(([id,score])=>{
    const p=state.lastKnownPlayers[id]||(id===meId?{name:state.playerName||'Player',colorHex:state.playerColor.hex||'#888',avatar:state.pixelAvatarData||null}:null);
    if (!p) return;
    const isGone=state.lastKnownPlayers[id]&&(state.lastKnownPlayers[id]._disconnected||state.lastKnownPlayers[id]._kicked);
    if (isGone&&score<1&&id!==meId) return;
    const displayP=id===meId?{...p,name:state.playerName||p.name,colorHex:state.playerColor.hex||p.colorHex,avatar:state.pixelAvatarData||p.avatar||null}:p;
    const row=document.createElement('div');
    row.className='game-score-row'+(id===meId?' me':'');
    if (id===meId) row.style.border='1px solid rgba(255,255,255,0.85)';
    const avatarStyle=displayP.avatar?`background-image:url(${displayP.avatar});background-color:${displayP.colorHex}`:`background-color:${displayP.colorHex}`;
    const initial=(displayP.name||'?').charAt(0).toUpperCase();
    const displayScore=(autocheckEnabled||chatGuessMode)?score:'—';
    // FIX 6: host tag next to score, not name
    const hostTag=state.lastKnownPlayers[id]?.isHost?'<span class="player-badge host" style="margin-left:6px">host</span>':'';
    row.innerHTML=`
      <div class="game-score-avatar" style="${avatarStyle};cursor:pointer" data-avatar="${(displayP.avatar||'').replace(/"/g,'&quot;')}" data-color="${displayP.colorHex}" data-name="${(displayP.name||'Player').replace(/"/g,'&quot;')}" data-initial="${initial}">${displayP.avatar?'':initial}</div>
      <div class="game-score-name">${displayP.name||'Player'}${hostTag}</div>
      <div class="game-score-val">${displayScore}</div>
    `;
    row.querySelector('.game-score-avatar').addEventListener('click', function(e) {
      e.stopPropagation();
      openAvatarLightbox(this.dataset.avatar, this.dataset.color, this.dataset.name, this.dataset.initial);
    });
    if (id===meId) { row.title='Click to change name & color'; row.addEventListener('click', e => { e.stopPropagation(); openRenameOverlay(); }); }
    else if (state.isHost) {
      row.style.cursor='context-menu';
      row.addEventListener('contextmenu', e => { e.preventDefault(); showGamePlayerCtxMenu(e.clientX, e.clientY, id, displayP.name); });
    }
    list.appendChild(row);
  });
}

// ── Check / Reveal ──
function checkLetter() {
  if (!selectedCell) return;
  const {row,col}=selectedCell; const letter=gameGrid[row][col].letter;
  if (!letter) return;
  const correctWords=gameWords.filter(w=>w.cells.some(c=>c.row===row&&c.col===col));
  const isCorrect=correctWords.every(w=>{const idx=w.cells.findIndex(c=>c.row===row&&c.col===col);return w.answer[idx]===letter;});
  const el=getCellEl(row,col);
  if (el) { el.classList.toggle('wrong',!isCorrect); el.classList.toggle('correct',isCorrect); }
}

function checkWord() {
  if (!selectedWord) return;
  selectedWord.cells.forEach((c,i)=>{
    const letter=gameGrid[c.row][c.col].letter; const el=getCellEl(c.row,c.col);
    if (!el||el.classList.contains('correct')) return;
    if (letter) { const correct=letter===selectedWord.answer[i]; el.classList.toggle('wrong',!correct); }
  });
}

function checkGrid() {
  gameWords.forEach(w=>w.cells.forEach((c,i)=>{
    const letter=gameGrid[c.row][c.col].letter; const el=getCellEl(c.row,c.col);
    if (!el||el.classList.contains('correct')) return;
    if (letter) { el.classList.toggle('wrong',letter!==w.answer[i]); }
  }));
}

function revealCell(row,col) {
  let correctLetter=null;
  for (const w of gameWords) { const idx=w.cells.findIndex(c=>c.row===row&&c.col===col); if (idx!==-1) { correctLetter=w.answer[idx]; break; } }
  if (!correctLetter) return;
  gameGrid[row][col].letter=correctLetter; gameGrid[row][col].filledBy='revealed'; gameGrid[row][col].revealed=true;
  const letterEl=document.getElementById(`cell-letter-${row}-${col}`);
  if (letterEl) { letterEl.textContent=correctLetter; letterEl.style.color='#000000'; }
  const cellEl=getCellEl(row,col);
  if (cellEl) { cellEl.classList.remove('wrong'); cellEl.classList.add('has-letter','correct'); }
  if (state.activeLobbyCode) pushCellToFB(state.activeLobbyCode,row,col,correctLetter,'revealed',state.playerColor.hex,true);
  checkWordComplete();
}

function checkWordComplete() {
  if (!selectedWord) return;
  const w=selectedWord;
  const fullyFilled=w.cells.every(c=>!!gameGrid[c.row][c.col].letter);
  const fullyCorrect=fullyFilled&&w.cells.every((c,i)=>gameGrid[c.row][c.col].letter===w.answer[i]);
  const clueEl=document.getElementById(`clue-item-${w.dir}-${w.num}`);
  if (clueEl) {
    const textEl=clueEl.querySelector('.game-clue-text');
    if (fullyFilled) { clueEl.classList.add('completed'); if (textEl) textEl.style.textDecoration='line-through'; }
    else { clueEl.classList.remove('completed'); if (textEl) textEl.style.textDecoration=''; }
  }
  if (fullyCorrect&&(autocheckEnabled||chatGuessMode)) {
    w.cells.forEach(c=>{ const el=getCellEl(c.row,c.col); if (el) { el.classList.add('correct'); el.classList.remove('wrong'); } });
    checkPuzzleComplete();
  }
}

function checkPuzzleComplete() {
  if (!window._puzzleCompletionAllowed) return;
  const overlay=document.getElementById('game-over-overlay');
  if (overlay&&!overlay.classList.contains('hidden')) return;
  if (!gameWords||!gameWords.length) return;
  const allDone=gameWords.every(w=>w.cells.every((c,i)=>gameGrid[c.row][c.col].letter===w.answer[i]));
  if (allDone) {
    clearInterval(gameTimerInterval);
    if (window._gameMode==='versus') {
      const finishSec=gameTimerSec;
      if (window._fb&&state.activeLobbyCode&&state.myPlayerId) {
        const {update,ref,db}=window._fb;
        update(ref(db,`lobbies/${state.activeLobbyCode}/versusFinish/${state.myPlayerId}`),{finishSec,name:state.playerName,colorHex:state.playerColor.hex,ts:Date.now()}).catch(()=>{});
      }
      setTimeout(showGameOver,600);
    } else {
      if (state.isHost) {
        recomputeScores();
        setTimeout(()=>{ if (state.activeLobbyCode) pushGameSettingFB(state.activeLobbyCode,'gameEnded',true); },200);
      }
      setTimeout(showGameOver,600);
    }
  }
}

// ── Game settings from Firebase ──
function applyGameSettings(settings) {
  if (typeof settings.autocheck==='boolean') {
    autocheckEnabled=settings.autocheck;
    updateAutocheckPill(settings.autocheck);
    if (settings.autocheck) {
      const tryAC=(n)=>{ if (window._snapshotLoaded) { runAutocheck(); if (state.isHost) recomputeScores(); renderGameScores(); } else if (n>0) setTimeout(()=>tryAC(n-1),150); };
      tryAC(10);
    } else {
      Object.values(cellElCache).forEach(el=>{ el.classList.remove('wrong','correct'); });
      document.querySelectorAll('.game-clue-item.completed').forEach(el=>{ el.classList.remove('completed'); const t=el.querySelector('.game-clue-text'); if (t) t.style.textDecoration=''; });
    }
    renderGameScores();
  }
  const cgOn  = typeof settings.chatGuessMode==='boolean'?settings.chatGuessMode:chatGuessMode;
  const cgHard= typeof settings.chatGuessHard==='boolean'?settings.chatGuessHard:chatGuessHard;
  if (cgOn!==chatGuessMode||cgHard!==chatGuessHard) applyChatGuessModeUI(cgOn,cgHard);
  if (settings.gameEnded===true&&!state.isHost) {
    const goOverlay=document.getElementById('game-over-overlay');
    if (goOverlay?.classList.contains('hidden')&&window._puzzleCompletionAllowed&&state.activeLobbyCode) {
      clearInterval(gameTimerInterval);
      setTimeout(showGameOver,400);
    }
  }
}

function toggleAutocheckWithConfirm() {
  if (!state.isHost) return;
  if (!autocheckEnabled) { openOverlay('autocheck-confirm-overlay'); return; }
  toggleAutocheck(false);
}

function toggleAutocheck(on) {
  autocheckEnabled=on;
  updateAutocheckPill(on);
  if (state.isHost&&state.activeLobbyCode) pushGameSettingFB(state.activeLobbyCode,'autocheck',on);
  if (on) { window._snapshotLoaded=true; runAutocheck(); recomputeScores(); }
  else { Object.values(cellElCache).forEach(el=>{ el.classList.remove('wrong','correct'); }); }
  renderGameScores();
}

// ── Chat Guess Mode ──
function applyChatGuessModeUI(on, hard) {
  chatGuessMode=on; chatGuessHard=hard;
  const btn=document.getElementById('chat-guess-btn');
  const modeToggle=document.getElementById('chat-guess-mode-toggle');
  const easyBtn=document.getElementById('toggle-easy-btn');
  const hardBtn2=document.getElementById('toggle-hard-btn');
  const chatInput=document.getElementById('game-chat-input');
  const grid=document.getElementById('game-grid');
  const hiddenInput=document.getElementById('game-hidden-input');
  const gridTypeBtn=document.getElementById('grid-type-btn');
  if (btn) btn.style.outline=on?(hard?'2px solid #e05151':'2px solid #27ae60'):'none';
  if (gridTypeBtn) gridTypeBtn.style.outline=on?'none':'2px solid rgba(255,255,255,0.85)';
  if (on) {
    if (btn) { btn.classList.add('active'); btn.classList.toggle('hard-active',hard); }
    if (modeToggle&&state.isHost) {
      modeToggle.style.display='flex';
      if (easyBtn) { easyBtn.style.background=hard?'var(--bg2)':'#27ae60'; easyBtn.style.color=hard?'var(--text3)':'#fff'; }
      if (hardBtn2) { hardBtn2.style.background=hard?'#e05151':'var(--bg2)'; hardBtn2.style.color=hard?'#fff':'var(--text3)'; }
    }
    if (grid) grid.classList.add('chat-guess-mode');
    if (chatInput) { chatInput.classList.add('guess-mode'); chatInput.classList.toggle('hard-mode',hard); chatInput.placeholder=hard?'e.g. "2a apple" or "5d river"…':'Type to guess anywhere on the board…'; }
    if (hiddenInput) hiddenInput.disabled=true;
    const pill=document.getElementById('autocheck-pill');
    if (pill) pill.classList.add('autocheck-blurred');
    const nhIndicator=document.getElementById('nonhost-mode-indicator');
    if (nhIndicator&&!state.isHost) {
      nhIndicator.style.display='';
      nhIndicator.innerHTML=hard?'<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;background:rgba(224,81,81,0.18);border:1px solid #e05151;color:#e05151;letter-spacing:.05em;text-transform:uppercase;vertical-align:middle">Hard</span>&nbsp; Mode: type into chat to guess':'<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;background:rgba(39,174,96,0.18);border:1px solid #27ae60;color:#27ae60;letter-spacing:.05em;text-transform:uppercase;vertical-align:middle">Easy</span>&nbsp; Mode: type into chat to guess';
    }
    setTimeout(()=>chatInput&&chatInput.focus(),50);
  } else {
    if (btn) btn.classList.remove('active','hard-active');
    if (modeToggle) modeToggle.style.display='none';
    if (chatInput) { chatInput.classList.remove('guess-mode','hard-mode'); chatInput.placeholder='Say something…'; }
    if (grid) grid.classList.remove('chat-guess-mode','hard-guess-mode');
    if (hiddenInput) hiddenInput.disabled=false;
    const pill=document.getElementById('autocheck-pill');
    if (pill) pill.classList.remove('autocheck-blurred');
    const nhIndicator=document.getElementById('nonhost-mode-indicator');
    if (nhIndicator&&!state.isHost) { nhIndicator.style.display=''; nhIndicator.innerHTML='Mode: type into grid to guess'; nhIndicator.style.color='var(--text3)'; }
  }
  renderGameScores();
}

function setChatGuessMode(wantOn) {
  if (!state.isHost||wantOn===chatGuessMode) return;
  if (state.activeLobbyCode) { pushGameSettingFB(state.activeLobbyCode,'chatGuessMode',wantOn); pushGameSettingFB(state.activeLobbyCode,'chatGuessHard',chatGuessHard); }
  applyChatGuessModeUI(wantOn,chatGuessHard);
}

function toggleChatGuessHard() {
  if (!state.isHost) return;
  const newHard=!chatGuessHard;
  if (state.activeLobbyCode) pushGameSettingFB(state.activeLobbyCode,'chatGuessHard',newHard);
  applyChatGuessModeUI(chatGuessMode,newHard);
}

function parsePrefixedGuess(text) {
  const m=text.trim().match(/^(\d+)\s*(a(?:cross)?|d(?:own)?)\s+([a-zA-Z]+)$/i);
  if (!m) return null;
  return { num:parseInt(m[1]), dir:m[2].toLowerCase().startsWith('a')?'across':'down', guess:m[3].toUpperCase() };
}

function fillWordInGrid(word,guess,playerId,playerColorHex,skipFBPush) {
  word.cells.forEach((c,i)=>{
    const cellEl=getCellEl(c.row,c.col);
    if (cellEl?.classList.contains('correct')) return;
    gameGrid[c.row][c.col].letter=guess[i]; gameGrid[c.row][c.col].filledBy=playerId; gameGrid[c.row][c.col].filledColor=playerColorHex;
    const letterEl=document.getElementById(`cell-letter-${c.row}-${c.col}`);
    if (letterEl) { letterEl.textContent=guess[i]; letterEl.style.color=playerColorHex; }
    if (cellEl) { cellEl.classList.add('has-letter','correct'); cellEl.classList.remove('wrong'); }
    if (!skipFBPush&&state.activeLobbyCode) pushCellToFB(state.activeLobbyCode,c.row,c.col,guess[i],playerId,playerColorHex);
  });
  const clueEl=document.getElementById(`clue-item-${word.dir}-${word.num}`);
  if (clueEl) { clueEl.classList.add('completed'); const t=clueEl.querySelector('.game-clue-text'); if (t) t.style.textDecoration='line-through'; }
  recomputeScores(); renderGameScores(); checkPuzzleComplete(); updateGridHighlight();
  if (!state.isHost&&state.activeLobbyCode) pushScoreToFB(state.activeLobbyCode,state.myPlayerId,{score:gameScores[state.myPlayerId]||0,name:state.playerName,colorHex:state.playerColor.hex,avatar:state.pixelAvatarData||null});
}

function processChatGuess(text,playerId,playerColorHex) {
  const guess=text.trim().toUpperCase();
  if (chatGuessHard) {
    const parsed=parsePrefixedGuess(text);
    if (!parsed) return null;
    const word=gameWords.find(w=>w.num===parsed.num&&w.dir===parsed.dir);
    if (!word||parsed.guess.length!==word.length) return {isGuess:true,correct:false,resultMessage:null};
    if (parsed.guess===word.answer) { fillWordInGrid(word,parsed.guess,playerId,playerColorHex); return {isGuess:true,correct:true,resultMessage:null}; }
    return {isGuess:true,correct:false,resultMessage:null};
  } else {
    if (!/^[A-Z]+$/.test(guess)) return null;
    const prefixed=parsePrefixedGuess(text);
    if (prefixed) {
      const word=gameWords.find(w=>w.num===prefixed.num&&w.dir===prefixed.dir);
      if (word&&prefixed.guess===word.answer) {
        const cellEl=getCellEl(word.cells[0].row,word.cells[0].col);
        if (cellEl?.classList.contains('correct')) return {isGuess:true,correct:false,resultMessage:null};
        fillWordInGrid(word,prefixed.guess,playerId,playerColorHex);
        return {isGuess:true,correct:true,resultMessage:null};
      }
    }
    const matches=gameWords.filter(w=>{
      if (w.answer!==guess) return false;
      return !w.cells.every(c=>{ const el=getCellEl(c.row,c.col); return el?.classList.contains('correct'); });
    });
    if (!matches.length) return {isGuess:true,correct:false,resultMessage:null};
    matches.forEach(word=>fillWordInGrid(word,guess,playerId,playerColorHex));
    return {isGuess:true,correct:true,resultMessage:null};
  }
}

// ── Game chat ──
async function sendGameChat() {
  const input=document.getElementById('game-chat-input');
  const sendBtn=document.getElementById('game-chat-send');
  const text=input.value.trim();
  if (!text) return;
  input.value=''; if (sendBtn) sendBtn.disabled=true;
  const pId=state.myPlayerId||'solo';
  const pColor=state.playerColor.hex||'#888';
  if (chatGuessMode) {
    const pointsBefore=gameScores[pId]||0;
    const result=processChatGuess(text,pId,pColor);
    if (result!==null) {
      const pointsAfter=gameScores[pId]||0;
      const pointsEarned=result.correct?Math.max(0,pointsAfter-pointsBefore):0;
      const extra={isGuess:true,guessResult:result.correct?'correct':'wrong',filledBy:pId,colorHex:pColor,points:pointsEarned};
      if (state.activeLobbyCode) sendGameChatFB(state.activeLobbyCode,{name:state.playerName,colorHex:pColor,text,ts:Date.now(),avatar:state.pixelAvatarData||null,...extra});
      setTimeout(()=>{ if (sendBtn) sendBtn.disabled=false; },300);
      return;
    }
  }
  if (state.activeLobbyCode) sendGameChatFB(state.activeLobbyCode,{name:state.playerName,colorHex:pColor,text,ts:Date.now(),avatar:state.pixelAvatarData||null});
  setTimeout(()=>{ if (sendBtn) sendBtn.disabled=false; },300);
}

function buildGameChatMsgEl(m) {
  const div=document.createElement('div');
  div.className='game-chat-msg';
  div.dataset.playerId=m.filledBy||m.playerId||'';
  div.dataset.colorHex=m.colorHex||'';
  div.style.cssText=`border-left:2.5px solid ${m.colorHex};padding-left:8px;margin-left:2px`;
  const avatarStyle=m.avatar?`background-image:url(${m.avatar});background-color:${m.colorHex}`:`background-color:${m.colorHex}`;
  const isOwnMessage=(m.filledBy||m.playerId)===state.myPlayerId;
  let bodyHtml;
  if (m.isGuess&&isOwnMessage) {
    const guessColor=m.guessResult==='correct'?'#4caf7d':'#e05151';
    const pointsTag=(m.guessResult==='correct'&&m.points)?` <em style="font-size:11px;color:var(--text3);font-weight:400">+${m.points} pt${m.points!==1?'s':''}</em>`:'';
    bodyHtml=`<div class="game-chat-msg-text" style="color:${guessColor};font-weight:700">${m.text.replace(/</g,'&lt;')}${pointsTag}</div>`;
  } else {
    bodyHtml=`<div class="game-chat-msg-text">${m.text.replace(/</g,'&lt;')}</div>`;
  }
  const initial=(m.name||'?').charAt(0).toUpperCase();
  div.innerHTML=`
    <div class="game-chat-msg-meta">
      <div class="game-chat-msg-avatar" style="${avatarStyle}" data-avatar="${(m.avatar||'').replace(/"/g,'&quot;')}" data-color="${m.colorHex}" data-name="${(m.name||'').replace(/"/g,'&quot;')}" data-initial="${initial}">${m.avatar?'':initial}</div>
      <span class="game-chat-msg-name" style="color:${chatNameColor(m.colorHex)}">${m.name}</span>
    </div>
    ${bodyHtml}
  `;
  div.querySelector('.game-chat-msg-avatar').addEventListener('click', function() {
    openAvatarLightbox(this.dataset.avatar,this.dataset.color,this.dataset.name,this.dataset.initial);
  });
  return div;
}

function renderGameChatMessages(list) {
  const container=document.getElementById('game-chat-messages');
  if (!container) return;
  const empty=document.getElementById('game-chat-empty');
  if (empty) empty.style.display=list.length?'none':'';
  Array.from(container.children).forEach(ch=>{ if (ch.id!=='game-chat-empty') ch.remove(); });
  list.forEach(m=>{
    // FIX 3/4: in versus mode, hide other players' guesses from everyone
    if (window._gameMode==='versus'&&m.isGuess&&(m.filledBy||m.playerId)!==state.myPlayerId) return;
    // FIX 3/4: in versus mode, don't apply other players' correct guesses to this player's board
    if (m.isGuess&&m.guessResult==='correct'&&m.filledBy!==state.myPlayerId&&window._gameMode!=='versus') {
      const parsed=parsePrefixedGuess(m.text||'');
      if (parsed) {
        const word=gameWords.find(w=>w.num===parsed.num&&w.dir===parsed.dir);
        if (word&&parsed.guess===word.answer) fillWordInGrid(word,parsed.guess,m.filledBy||'remote',m.colorHex||'#888',true);
      } else {
        const guess=(m.text||'').trim().toUpperCase().replace(/[^A-Z]/g,'');
        if (/^[A-Z]+$/.test(guess)) {
          gameWords.filter(w=>w.answer===guess).forEach(word=>{
            const alreadySolved=word.cells.every(c=>{ const el=getCellEl(c.row,c.col); return el?.classList.contains('correct'); });
            if (!alreadySolved) fillWordInGrid(word,guess,m.filledBy||'remote',m.colorHex||'#888',true);
          });
        }
      }
    }
    container.appendChild(buildGameChatMsgEl(m));
  });
  container.scrollTop=container.scrollHeight;
  const sendBtn=document.getElementById('game-chat-send');
  const gci=document.getElementById('game-chat-input');
  if (sendBtn&&gci&&!gci.value.trim()) sendBtn.disabled=false;
}

function repaintGameChatColor(playerId,name,newHex) {
  const container=document.getElementById('game-chat-messages');
  if (!container) return;
  container.querySelectorAll('.game-chat-msg').forEach(msgEl=>{
    const pid=msgEl.dataset.playerId;
    const nameEl=msgEl.querySelector('.game-chat-msg-name');
    const matchById=pid&&pid===playerId;
    const matchByName=!pid&&nameEl&&nameEl.textContent===name;
    if (!matchById&&!matchByName) return;
    msgEl.dataset.colorHex=newHex;
    msgEl.style.cssText=`border-left:2.5px solid ${newHex};padding-left:8px;margin-left:2px`;
    const avatarEl=msgEl.querySelector('.game-chat-msg-avatar');
    if (avatarEl) avatarEl.style.backgroundColor=newHex;
    if (nameEl) nameEl.style.color=chatNameColor(newHex);
  });
}

// ── Cursor tracking ──
function startCursorTracking() {
  if (!state.activeLobbyCode||!state.myPlayerId) return;
  const grid=document.getElementById('game-grid');
  if (!grid) return;
  cursorMoveHandler=(e)=>{
    if (cursorThrottleTimer) return;
    cursorThrottleTimer=setTimeout(()=>{ cursorThrottleTimer=null; },50);
    const g=document.getElementById('game-grid');
    if (!g) return;
    const rect=g.getBoundingClientRect();
    if (!rect.width||!rect.height) return;
    const x=(e.clientX-rect.left)/rect.width, y=(e.clientY-rect.top)/rect.height;
    if (x<0||x>1||y<0||y>1) return;
    pushCursorToFB(state.activeLobbyCode,state.myPlayerId,x,y,state.playerName,state.playerColor.hex);
  };
  cursorLeaveHandler=()=>{ removeCursorFromFB(state.activeLobbyCode,state.myPlayerId); };
  const gridContainer=document.querySelector('.game-grid-container')||grid;
  gridContainer.addEventListener('mousemove',cursorMoveHandler);
  gridContainer.addEventListener('mouseleave',cursorLeaveHandler);
  _cursorContainer=gridContainer;
  if (_stopCursor) { _stopCursor(); _stopCursor=null; }
  _stopCursor=startCursorListener(state.activeLobbyCode,snap=>{
    const data=snap.val()||{};
    const g=document.getElementById('game-grid');
    if (!g) return;
    Object.keys(remoteCursorEls).forEach(id=>{ if (!data[id]) { remoteCursorEls[id].remove(); delete remoteCursorEls[id]; } });
    Object.entries(data).forEach(([id,cur])=>{
      if (id===state.myPlayerId) return;
      const px=cur.x*g.offsetWidth, py=cur.y*g.offsetHeight;
      const color=cur.colorHex||'#ffffff', name=cur.name||'Player';
      let el=remoteCursorEls[id];
      if (!el) {
        el=document.createElement('div');
        el.className='remote-cursor';
        el.innerHTML=`<svg width="16" height="20" viewBox="0 0 12 20" fill="none"><path d="M1.5 1.5 L1.5 15.5 L4.5 12 L7.2 18.2 L9.2 17.2 L6.5 11 L11 11 Z" fill="white" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg><span class="remote-cursor-label" style="color:${color}">${name}</span>`;
        g.appendChild(el); remoteCursorEls[id]=el;
      } else {
        const path=el.querySelector('path'); if (path) path.setAttribute('stroke',color);
        const lbl=el.querySelector('.remote-cursor-label'); if (lbl) { lbl.textContent=name; lbl.style.color=color; }
      }
      el.style.left=px+'px'; el.style.top=py+'px';
    });
  });
  setupCursorDisconnect(state.activeLobbyCode,state.myPlayerId);
}

function stopCursorTracking() {
  if (_stopCursor) { _stopCursor(); _stopCursor=null; }
  if (_cursorContainer) {
    if (cursorMoveHandler)  _cursorContainer.removeEventListener('mousemove',cursorMoveHandler);
    if (cursorLeaveHandler) _cursorContainer.removeEventListener('mouseleave',cursorLeaveHandler);
  }
  _cursorContainer=null; cursorMoveHandler=null; cursorLeaveHandler=null;
  Object.values(remoteCursorEls).forEach(el=>el.remove());
  Object.keys(remoteCursorEls).forEach(k=>delete remoteCursorEls[k]);
  if (state.activeLobbyCode&&state.myPlayerId) removeCursorFromFB(state.activeLobbyCode,state.myPlayerId);
}

// ── Versus grid preview ──
function pushVersusGridState() {
  if (!state.activeLobbyCode||!state.myPlayerId||window._gameMode!=='versus'||!gameGrid||!currentMap) return;
  if (_versusGridPushTimer) clearTimeout(_versusGridPushTimer);
  _versusGridPushTimer=setTimeout(()=>{
    if (!gameGrid||!currentMap) return;
    const size=currentMap.size;
    const cells=[];
    for (let r=0;r<size;r++) for (let c=0;c<size;c++) {
      const cell=gameGrid[r]&&gameGrid[r][c];
      if (!cell) { cells.push(0); continue; }
      if (cell.isBlack) { cells.push(0); continue; }
      const el=getCellEl(r,c);
      if (el?.classList.contains('correct')) cells.push(3);
      else if (cell.letter) cells.push(2);
      else cells.push(1);
    }
    pushVersusGridToFB(state.activeLobbyCode,state.myPlayerId,{cells,size,name:state.playerName,colorHex:state.playerColor.hex,ts:Date.now()});
  },300);
}

function startVersusGridPreview() {
  const wrap=document.getElementById('versus-previews-wrap');
  if (wrap) { wrap.style.display=''; wrap.innerHTML='<div style="font-size:11px;color:var(--text3);letter-spacing:.04em;padding:4px 0;">Waiting for opponents…</div>'; }
  if (_stopVersusGrid) { _stopVersusGrid(); _stopVersusGrid=null; }
  if (!state.activeLobbyCode) return;
  _stopVersusGrid=startVersusGridListener(state.activeLobbyCode,snap=>{
    const data=snap.val()||{};
    const wrap=document.getElementById('versus-previews-wrap');
    if (!wrap) return;
    wrap.innerHTML='';
    let anyOther=false;
    Object.entries(data).forEach(([id,grid])=>{
      if (id===state.myPlayerId||!grid?.cells||!grid.size) return;
      anyOther=true;
      const name=grid.name||state.lastKnownPlayers[id]?.name||'Player';
      const colorHex=grid.colorHex||state.lastKnownPlayers[id]?.colorHex||'#888';
      const size=grid.size;
      const maxWidth=130, cellPx=Math.max(2,Math.floor(maxWidth/size)), totalPx=cellPx*size;
      const playerDiv=document.createElement('div');
      playerDiv.className='versus-preview-player';
      playerDiv.style.cssText=`background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:8px;display:flex;flex-direction:column;align-items:center;gap:8px;box-sizing:border-box;overflow:hidden;`;
      const miniGrid=document.createElement('div');
      miniGrid.className='versus-mini-grid';
      miniGrid.style.cssText=`display:grid;grid-template-columns:repeat(${size},${cellPx}px);grid-template-rows:repeat(${size},${cellPx}px);width:${totalPx}px;height:${totalPx}px;flex-shrink:0;border:1px solid #333;border-radius:3px;overflow:hidden;`;
      grid.cells.forEach(v=>{
        const cell=document.createElement('div');
        cell.style.width=cellPx+'px';
        cell.style.height=cellPx+'px';
        cell.style.boxSizing='border-box';
        if (v===0) {
          cell.style.background='#1a1a1a';
          cell.style.border='none';
        } else if (v===3) {
          cell.style.background=autocheckEnabled?'#27ae60':'#666666';
          cell.style.border='0.5px solid #555';
        } else if (v===2) {
          cell.style.background='#666666';
          cell.style.border='0.5px solid #555';
        } else {
          cell.style.background='#ffffff';
          cell.style.border='0.5px solid #c0c0c0';
        }
        miniGrid.appendChild(cell);
      });
      const avatar=document.createElement('div');
      const avatarData=state.lastKnownPlayers[id]?.avatar||null;
      avatar.style.cssText=`width:28px;height:28px;border-radius:50%;flex-shrink:0;background-color:${colorHex};background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;border:2px solid ${colorHex};`;
      if(avatarData){avatar.style.backgroundImage=`url(${avatarData})`;} else {avatar.textContent=(name||'?').charAt(0).toUpperCase();}
      const nameDiv=document.createElement('div');
      nameDiv.style.cssText=`color:${colorHex};font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;text-align:center;max-width:${totalPx+20}px;`;
      nameDiv.textContent=name;
      playerDiv.appendChild(avatar); playerDiv.appendChild(miniGrid); playerDiv.appendChild(nameDiv);
      wrap.appendChild(playerDiv);
    });
    if (!anyOther) {
      const w=document.createElement('div');
      w.style.cssText='font-size:11px;color:var(--text3);letter-spacing:.04em;padding:4px 0;';
      w.textContent='Waiting for opponents…';
      wrap.appendChild(w);
    }
    wrap.style.display='';
  });
  setTimeout(() => pushVersusGridState(), 500);
  setInterval(() => { if (window._gameMode === 'versus') pushVersusGridState(); }, 500);
}

function stopVersusGridPreview() {
  if (_stopVersusGrid) { _stopVersusGrid(); _stopVersusGrid=null; }
  if (state.activeLobbyCode&&state.myPlayerId) removeVersusGridFromFB(state.activeLobbyCode,state.myPlayerId);
  const wrap=document.getElementById('versus-previews-wrap');
  if (wrap) { wrap.innerHTML=''; wrap.style.display='none'; }
}

// ── Game over ──
function showGameOver() {
  if ((autocheckEnabled||chatGuessMode)&&state.isHost) recomputeScores();
  const meId=state.myPlayerId;
  const knownIds=new Set(Object.keys(state.lastKnownPlayers));
  if (meId) knownIds.add(meId);
  const sorted=[...knownIds].map(id=>[id,gameScores[id]||0])
    .filter(([id,score])=>{ if (id===meId) return true; const p=state.lastKnownPlayers[id]; if (!p) return false; return !(p._disconnected||p._kicked)||score>=1; })
    .sort((a,b)=>b[1]-a[1]);
  const podium=document.getElementById('game-over-podium');
  podium.innerHTML='';
  const topScore=sorted.length?sorted[0][1]:0;
  const isTogetherMode=window._gameMode!=='versus';
  const winnerAvatarEl=document.getElementById('game-over-winner-avatar');
  if (winnerAvatarEl) {
    if (isTogetherMode) { winnerAvatarEl.style.display='none'; }
    else {
      winnerAvatarEl.style.display='';
      if (sorted.length) {
        const [winnerId]=sorted[0];
        const wp=state.lastKnownPlayers[winnerId]||(winnerId===meId?{name:state.playerName,colorHex:state.playerColor.hex,avatar:state.pixelAvatarData||null}:{name:'Player',colorHex:'#888',avatar:null});
        if (wp.avatar) { winnerAvatarEl.style.backgroundImage=`url(${wp.avatar})`; winnerAvatarEl.style.backgroundColor=wp.colorHex; winnerAvatarEl.textContent=''; }
        else { winnerAvatarEl.style.backgroundImage=''; winnerAvatarEl.style.backgroundColor=wp.colorHex; winnerAvatarEl.textContent=(wp.name||'?').charAt(0).toUpperCase(); }
      }
    }
  }
  sorted.forEach(([id,score],i)=>{
    const p=state.lastKnownPlayers[id]||(id===meId?{name:state.playerName,colorHex:state.playerColor.hex,avatar:state.pixelAvatarData||null}:{name:'Player',colorHex:'#888'});
    const isWinner=i===0&&score===topScore;
    const row=document.createElement('div');
    row.className='game-over-row'+(!isTogetherMode&&isWinner?' winner':'');
    const initial=(p.name||'?').charAt(0).toUpperCase();
    const avatarStyle=p.avatar?`background-image:url(${p.avatar});background-color:${p.colorHex}`:`background-color:${p.colorHex}`;
    row.innerHTML=`
      <div class="game-over-rank">${i+1}</div>
      <div class="game-over-avatar" style="${avatarStyle}">${p.avatar?'':initial}</div>
      <div class="game-over-name-wrap">
        <span class="game-over-name">${p.name||'Player'}</span>
        ${!isTogetherMode&&isWinner?'<span class="game-over-winner-tag">Winner</span>':''}
      </div>
      <div class="game-over-score">${score} pt${score!==1?'s':''}</div>
    `;
    podium.appendChild(row);
  });
  const m=Math.floor(gameTimerSec/60), s=gameTimerSec%60;
  const timeStr=`${m}:${s<10?'0':''}${s}`;
  const titleEl=document.getElementById('game-over-title');
  const subtitleEl=document.getElementById('game-over-subtitle');
  if (isTogetherMode) {
    if (titleEl) titleEl.textContent=`Puzzle completed in ${timeStr}`;
    if (subtitleEl) {
      if (sorted.length&&sorted[0][1]>0) {
        const [topId]=sorted[0];
        const topP=state.lastKnownPlayers[topId]||(topId===meId?{name:state.playerName}:{name:'Player'});
        subtitleEl.textContent=`${topP.name} scored the most points`;
      } else { subtitleEl.textContent=''; }
    }
  } else {
    if (titleEl) titleEl.textContent='Game Ended';
    if (subtitleEl) subtitleEl.textContent=`Completed in ${timeStr}`;
  }
  openOverlay('game-over-overlay');
}

// ── Leave / Navigation ──
function stopAllListeners() {
  clearInterval(gameTimerInterval);
  stopCursorTracking();
  if (_stopGameChat)     { _stopGameChat();     _stopGameChat     = null; }
  if (_stopCellSync)     { _stopCellSync();     _stopCellSync     = null; }
  if (_stopGameSettings) { _stopGameSettings(); _stopGameSettings = null; }
  if (_stopScoreSync)    { _stopScoreSync();    _stopScoreSync    = null; }
  if (_stopPlayerInfo)   { _stopPlayerInfo();   _stopPlayerInfo   = null; }
  stopVersusGridPreview();
  autocheckEnabled=false; chatGuessMode=false; chatGuessHard=false;
  window._gridReady=false;
  applyChatGuessModeUI(false,false);
}

function leaveGame() {
  const gameOverVisible=!document.getElementById('game-over-overlay')?.classList.contains('hidden');
  if (!gameOverVisible) { openOverlay('leave-confirm-overlay'); return; }
  doLeaveGame();
}

function doLeaveGame() {
  closeOverlay('leave-confirm-overlay');
  stopAllListeners();
  if (state.activeLobbyCode&&state.myPlayerId&&window._fb) {
    const {remove,ref,db}=window._fb;
    remove(ref(db,`lobbies/${state.activeLobbyCode}/players/${state.myPlayerId}`)).catch(()=>{});
  }
  closeOverlay('game-over-overlay');
  state.activeLobbyCode=null; state.myPlayerId=null; state.isHost=false;
  window.location.href='index.html';
}

async function playAgain() {
  stopAllListeners();
  window._joiningGame=false; window._gameMode='together';
  closeOverlay('game-over-overlay');
  if (state.activeLobbyCode&&state.myPlayerId&&window._fb) {
    const {update,ref,db}=window._fb;
    try { await update(ref(db,`lobbies/${state.activeLobbyCode}/players/${state.myPlayerId}`),{inGame:false}); } catch {}
    if (state.isHost) { try { await update(ref(db,`lobbies/${state.activeLobbyCode}`),{status:'waiting'}); } catch {} }
  }
  if (typeof window.removeVote==='function') window.removeVote();
  window.location.href='lobby.html';
}

function goBackToLobby() {
  const gameOverVisible=!document.getElementById('game-over-overlay')?.classList.contains('hidden');
  if (!gameOverVisible) { openOverlay('back-to-lobby-confirm-overlay'); return; }
  doGoBackToLobby();
}

async function doGoBackToLobby() {
  closeOverlay('back-to-lobby-confirm-overlay');
  stopAllListeners();
  window._joiningGame=false; window._gameMode='together';
  closeOverlay('game-over-overlay');
  if (state.activeLobbyCode&&state.myPlayerId&&window._fb) {
    const {update,ref,db}=window._fb;
    try { await update(ref(db,`lobbies/${state.activeLobbyCode}/players/${state.myPlayerId}`),{inGame:false}); } catch {}
  }
  sessionStorage.setItem('returningFromGame', '1');
  window.location.href='lobby.html';
}

// ── In-game rename ──
let _renameColorHex=null;

function openRenameOverlay() {
  const overlay=document.getElementById('game-rename-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  const inp=document.getElementById('game-rename-input');
  if (inp) { inp.value=state.playerName||''; inp.style.borderColor=''; setTimeout(()=>{ inp.focus(); inp.select(); },80); }
  _renameColorHex=state.playerColor.hex||'#888';
  const takenHexes=new Set(Object.entries(state.lastKnownPlayers).filter(([id])=>id!==state.myPlayerId).map(([,p])=>p.colorHex).filter(Boolean));
  buildColorSwatches('game-rename-swatches',_renameColorHex,takenHexes,(color)=>{ _renameColorHex=color.hex; });
}

function closeRenamePopover() { closeOverlay('game-rename-overlay'); }

function saveRename() {
  const inp=document.getElementById('game-rename-input');
  const newName=inp?inp.value.trim():'';
  if (!newName) { if (inp) inp.style.borderColor='#e05151'; return; }
  const newColor=_renameColorHex||state.playerColor.hex||'#888';
  state.playerName=newName;
  const found=COLORS.find(c=>c.hex===newColor);
  if (found) state.playerColor=found;
  if (state.lastKnownPlayers[state.myPlayerId]) {
    state.lastKnownPlayers[state.myPlayerId].name=newName;
    state.lastKnownPlayers[state.myPlayerId].colorHex=newColor;
  }
  if (state.activeLobbyCode&&state.myPlayerId&&window._fb) {
    updatePlayer(state.activeLobbyCode,state.myPlayerId,{name:newName,colorHex:newColor,avatar:state.pixelAvatarData||null}).catch(()=>{});
  }
  renderGameScores();
  if (typeof updateChip==='function') updateChip();
  repaintGameChatColor(state.myPlayerId,newName,newColor);
  if (gameGrid&&gameWords) {
    const processed=new Set();
    gameWords.forEach(w=>w.cells.forEach(c=>{
      const key=c.row+'_'+c.col;
      if (processed.has(key)) return;
      processed.add(key);
      const cell=gameGrid[c.row]?.[c.col];
      if (!cell||!cell.letter||cell.filledBy!==state.myPlayerId||cell.revealed) return;
      cell.filledColor=newColor;
      const letterEl=document.getElementById(`cell-letter-${c.row}-${c.col}`);
      if (letterEl) letterEl.style.color=newColor;
      if (state.activeLobbyCode) pushCellToFB(state.activeLobbyCode,c.row,c.col,cell.letter,state.myPlayerId,newColor);
    }));
  }
  closeRenamePopover();
}

// ── In-game player context menu ──
let _gameCtxTargetId=null;

function showGamePlayerCtxMenu(x,y,targetId) {
  _gameCtxTargetId=targetId;
  const menu=document.getElementById('game-player-ctx-menu');
  if (!menu) return;
  menu.style.display='block';
  menu.style.left=Math.min(x,window.innerWidth-160-8)+'px';
  menu.style.top=Math.min(y,window.innerHeight-80-8)+'px';
  setTimeout(()=>document.addEventListener('click',()=>{ if(menu) menu.style.display='none'; },{once:true}),10);
}

async function gameCtxAction(action) {
  const menu=document.getElementById('game-player-ctx-menu');
  if (menu) menu.style.display='none';
  if (!_gameCtxTargetId||!state.activeLobbyCode) return;
  if (action==='kick') {
    removePlayer(state.activeLobbyCode,_gameCtxTargetId).catch(()=>{});
    if (state.lastKnownPlayers[_gameCtxTargetId]) { state.lastKnownPlayers[_gameCtxTargetId]._kicked=true; state.lastKnownPlayers[_gameCtxTargetId]._disconnected=false; }
    renderGameScores(); showToast('Player kicked.');
  } else if (action==='giveHost') {
    transferHost(state.activeLobbyCode,_gameCtxTargetId,state.myPlayerId).then(()=>{
      state.isHost=false;
      const toolbar=document.getElementById('game-host-toolbar');
      if (toolbar) toolbar.style.display='none';
      const nhIndicator=document.getElementById('nonhost-mode-indicator');
      if (nhIndicator) nhIndicator.style.display='';
      showToast('Host transferred.');
    }).catch(()=>{});
  }
  _gameCtxTargetId=null;
}

// ── Confirm action overlay ──
function showActionConfirm(title,body,btnLabel,btnColor,action) {
  document.getElementById('action-confirm-title').textContent=title;
  document.getElementById('action-confirm-body').textContent=body;
  const btn=document.getElementById('action-confirm-btn');
  btn.textContent=btnLabel;
  btn.style.background=btnColor||'';
  btn.style.color=btnColor?'#000':'';
  window._pendingConfirmAction=action;
  openOverlay('action-confirm-overlay');
}

function doActionConfirm() {
  const action=window._pendingConfirmAction;
  window._pendingConfirmAction=null;
  closeOverlay('action-confirm-overlay');
  if (typeof action==='function') { try { action(); } catch(e) { console.error(e); } }
}

// ── Host toolbar ──
function toggleHostToolbar() {
  const body=document.getElementById('host-toolbar-body');
  const chevron=document.getElementById('host-toolbar-chevron');
  const header=document.getElementById('host-toolbar-header');
  if (!body) return;
  const isOpen=body.style.display!=='none';
  body.style.display=isOpen?'none':'block';
  if (chevron) chevron.style.transform=isOpen?'rotate(0deg)':'rotate(180deg)';
  if (header) { header.style.borderBottom=isOpen?'none':'0.5px solid var(--border)'; header.style.borderRadius=isOpen?'10px':'10px 10px 0 0'; }
}

function toggleGameCode() {
  const codeEl=document.getElementById('game-lobby-code');
  const eyeOn=document.getElementById('game-eye-icon');
  const eyeOff=document.getElementById('game-eye-off-icon');
  if (!codeEl) return;
  const isBlurred=codeEl.style.filter?.includes('blur');
  if (isBlurred) { codeEl.style.filter='none'; codeEl.style.userSelect=''; if (eyeOn) eyeOn.style.display=''; if (eyeOff) eyeOff.style.display='none'; }
  else { codeEl.style.filter='blur(8px)'; codeEl.style.userSelect='none'; if (eyeOn) eyeOn.style.display='none'; if (eyeOff) eyeOff.style.display=''; }
}

function copyGameLobbyCode() {
  if (!state.activeLobbyCode) return;
  const code=document.getElementById('game-lobby-code')?.textContent;
  if (!code||code==='—') return;
  const url=window.location.origin+window.location.pathname+'?code='+code;
  navigator.clipboard.writeText(url).then(()=>{
    const lbl=document.getElementById('game-code-copy-label');
    if (lbl) { lbl.textContent='Copied!'; setTimeout(()=>{ lbl.textContent='Copy link'; },1800); }
  }).catch(()=>{});
}

function showForfeitConfirm() { openOverlay('forfeit-confirm-overlay'); }

function doForfeit() {
  closeOverlay('forfeit-confirm-overlay');
  if (state.activeLobbyCode&&window._fb) {
    const {update,ref,db}=window._fb;
    update(ref(db,`lobbies/${state.activeLobbyCode}/gameSettings`),{gameEnded:true}).catch(()=>{});
  }
  clearInterval(gameTimerInterval);
  showGameOver();
}

// ── Init ──
function init() {
  // Load puzzle from sessionStorage (set by lobby or home controller)
console.log('[GAME INIT] dateKey from sessionStorage:', sessionStorage.getItem('puzzleDateKey'), 'isHost:', state.isHost);
const gameMode   = sessionStorage.getItem('gameMode') || 'together';
const puzzleJson = gameMode === 'versus' ? null : sessionStorage.getItem('soloPuzzle');

if (!puzzleJson) {
    // Multiplayer: fetch puzzle from Firebase startedAt key
    const dateKey = sessionStorage.getItem('puzzleDateKey');
    if (!dateKey || !state.activeLobbyCode) {
      window.location.href = state.activeLobbyCode ? 'lobby.html' : 'index.html';
      return;
    }
    // Non-hosts: always verify the dateKey against Firebase to avoid stale sessionStorage
    const verifyDateKey = async () => {
      if (state.activeLobbyCode && window._fb) {
        try {
          const { get, ref, db } = window._fb;
          const snap = await get(ref(db, `lobbies/${state.activeLobbyCode}`));
          if (snap.exists()) {
            const d = snap.val();
            const fbKey = d.puzzleDateKey || dateKey;
            console.log('[VERIFY] puzzleDateKey from FB:', fbKey, '| sessionStorage had:', dateKey);
            return fbKey;
          }
        } catch {}
      }
      return dateKey;
    };
    verifyDateKey().then(resolvedDateKey => {
      if (resolvedDateKey !== dateKey) sessionStorage.setItem('puzzleDateKey', resolvedDateKey);
      return fetchNytPuzzle(resolvedDateKey);
    }).then(rawData => {
      const dateKeyFinal = sessionStorage.getItem('puzzleDateKey') || dateKey;
      const puzzle = parseNytPuzzle(rawData, dateKeyFinal);
      enterGame(puzzle, gameMode);
      setupKeyboard();
    }).catch(e => {
      showToast('Failed to load puzzle: ' + e.message.slice(0, 60));
      setTimeout(() => { window.location.href = 'lobby.html'; }, 1500);
    });
  } else {
    const puzzle = JSON.parse(puzzleJson);
    enterGame(puzzle, gameMode);
    setupKeyboard();
  }

  // Wire buttons
  document.getElementById('btn-go-lobby')?.addEventListener('click', goBackToLobby);
  document.getElementById('btn-leave-game')?.addEventListener('click', leaveGame);
  document.getElementById('btn-play-again')?.addEventListener('click', playAgain);
  document.getElementById('btn-leave-main-menu')?.addEventListener('click', doLeaveGame);
  document.getElementById('game-code-eye-btn')?.addEventListener('click', toggleGameCode);
  document.getElementById('game-code-copy-btn')?.addEventListener('click', copyGameLobbyCode);
  document.getElementById('host-toolbar-header')?.addEventListener('click', toggleHostToolbar);
  document.getElementById('autocheck-pill')?.addEventListener('click', toggleAutocheckWithConfirm);
  document.getElementById('confirm-autocheck-btn')?.addEventListener('click', ()=>{ closeOverlay('autocheck-confirm-overlay'); toggleAutocheck(true); });
  document.getElementById('cancel-autocheck-btn')?.addEventListener('click', ()=>closeOverlay('autocheck-confirm-overlay'));
  document.getElementById('host-check-letter')?.addEventListener('click', checkLetter);
  document.getElementById('host-check-word')?.addEventListener('click', checkWord);
  document.getElementById('host-check-grid')?.addEventListener('click', checkGrid);
  document.getElementById('host-reveal-letter')?.addEventListener('click', ()=>{ if (!selectedCell) { showToast('Select a cell first.'); return; } const snap={row:selectedCell.row,col:selectedCell.col}; showActionConfirm('Reveal letter?','This will reveal the correct letter in the selected cell for all players.','Reveal →','#d4a017',()=>{ revealCell(snap.row,snap.col); advanceInWordAlways(); updateGridHighlight(); }); });
  document.getElementById('host-reveal-word')?.addEventListener('click', ()=>{ if (!selectedWord) { showToast('Select a word first.'); return; } const wordSnap=selectedWord; showActionConfirm('Reveal word?','This will reveal all letters in the selected word for all players.','Reveal →','#d4a017',()=>{ wordSnap.cells.forEach(c=>revealCell(c.row,c.col)); checkPuzzleComplete(); }); });
  document.getElementById('host-reveal-grid')?.addEventListener('click', ()=>openOverlay('reveal-grid-overlay'));
  document.getElementById('do-reveal-grid')?.addEventListener('click', ()=>{
    closeOverlay('reveal-grid-overlay');
    gameWords.forEach(w=>w.cells.forEach((c,i)=>{
      const fl='revealed'; const fc=state.playerColor.hex||'#888';
      gameGrid[c.row][c.col].letter=w.answer[i]; gameGrid[c.row][c.col].filledBy=fl; gameGrid[c.row][c.col].revealed=true;
      const letterEl=document.getElementById(`cell-letter-${c.row}-${c.col}`); if (letterEl) { letterEl.textContent=w.answer[i]; letterEl.style.color=fc; }
      const cellEl=getCellEl(c.row,c.col); if (cellEl) { cellEl.classList.remove('wrong'); cellEl.classList.add('has-letter','correct'); }
      if (state.activeLobbyCode) pushCellToFB(state.activeLobbyCode,c.row,c.col,w.answer[i],fl,fc,true);
    }));
    checkPuzzleComplete();
  });
  document.getElementById('cancel-reveal-grid')?.addEventListener('click', ()=>closeOverlay('reveal-grid-overlay'));
  document.getElementById('action-confirm-btn')?.addEventListener('click', doActionConfirm);
  document.getElementById('action-cancel-btn')?.addEventListener('click', ()=>closeOverlay('action-confirm-overlay'));
  document.getElementById('forfeit-btn')?.addEventListener('click', showForfeitConfirm);
  document.getElementById('do-forfeit-btn')?.addEventListener('click', doForfeit);
  document.getElementById('cancel-forfeit-btn')?.addEventListener('click', ()=>closeOverlay('forfeit-confirm-overlay'));
  document.getElementById('chat-guess-btn')?.addEventListener('click', ()=>setChatGuessMode(true));
  document.getElementById('grid-type-btn')?.addEventListener('click', ()=>setChatGuessMode(false));
  document.getElementById('toggle-easy-btn')?.addEventListener('click', ()=>{ if (chatGuessHard) toggleChatGuessHard(); });
  document.getElementById('toggle-hard-btn')?.addEventListener('click', ()=>{ if (!chatGuessHard) toggleChatGuessHard(); });
  document.getElementById('game-chat-input')?.addEventListener('keydown', e=>{ if (e.key==='Enter'&&e.target.value.trim()) sendGameChat(); });
  document.getElementById('game-chat-input')?.addEventListener('input', e=>{ const btn=document.getElementById('game-chat-send'); if (btn) btn.disabled=!e.target.value.trim(); });
  document.getElementById('game-chat-send')?.addEventListener('click', sendGameChat);
  document.getElementById('game-rename-save')?.addEventListener('click', saveRename);
  document.getElementById('game-rename-cancel')?.addEventListener('click', closeRenamePopover);
  document.getElementById('game-rename-input')?.addEventListener('keydown', e=>{ if (e.key==='Enter') { e.preventDefault(); saveRename(); } });
  document.getElementById('game-ctx-give-host')?.addEventListener('click', ()=>gameCtxAction('giveHost'));
  document.getElementById('game-ctx-kick')?.addEventListener('click', ()=>gameCtxAction('kick'));
  document.getElementById('leave-confirm-stay')?.addEventListener('click', ()=>closeOverlay('leave-confirm-overlay'));
  document.getElementById('leave-confirm-go')?.addEventListener('click', doLeaveGame);
  document.getElementById('back-lobby-stay')?.addEventListener('click', ()=>closeOverlay('back-to-lobby-confirm-overlay'));
  document.getElementById('back-lobby-go')?.addEventListener('click', doGoBackToLobby);
  document.getElementById('avatar-lightbox')?.addEventListener('click', ()=>closeAvatarLightbox());
}

function waitAndInit() {
  if (window._fbReady) init();
  else document.addEventListener('fb-ready', init, { once: true });
}

// Expose globals needed by any lingering inline handlers
window.goBackToLobby   = goBackToLobby;
window.doGoBackToLobby = doGoBackToLobby;
window.leaveGame       = leaveGame;
window.doLeaveGame     = doLeaveGame;
window.playAgain       = playAgain;
window.closeOverlay    = closeOverlay;
window.showToast       = showToast;
window.renderGameChatMessages = renderGameChatMessages;
window.applyGameSettings = applyGameSettings;

waitAndInit();