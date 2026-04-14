/**
 * game.model.js — In-memory Game (active match) data model.
 *
 * Each active game is keyed by the lobby code.
 *
 * Shape of a game document:
 * {
 *   code:    string,
 *   mode:    'together'|'versus',
 *   puzzle:  { …puzzle object… },
 *   players: { [playerId]: { name, color, avatar, score } },
 *   cells: {
 *     [r,c]: {
 *       letter: string,    // '' = empty
 *       owner:  string,    // playerId of last editor
 *       revealed: boolean, // host-revealed cell
 *     }
 *   },
 *   scores:  { [playerId]: number },
 *   chat:    Array<{ playerId, name, color, text, ts }>,
 *   startedAt: number,
 *   endedAt:   number|null,
 * }
 */

const store = new Map();   // code → gameDoc

// ── Factory ────────────────────────────────────────

/**
 * Initialise a new game for the given lobby code.
 * @param {string}   code
 * @param {object}   puzzle  — full puzzle object from puzzle model
 * @param {object}   players — { [playerId]: playerObj } from lobby
 * @param {string}   mode    — 'together' | 'versus'
 */
export function createGame(code, puzzle, players, mode = 'together') {
  if (store.has(code)) store.delete(code);

  // Build empty cell map (skip black squares)
  const cells = {};
  const size  = puzzle.size;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (puzzle.grid[r][c] !== '.') {
        cells[`${r},${c}`] = { letter: '', owner: null, revealed: false };
      }
    }
  }

  // Initialise scores
  const scores = {};
  Object.keys(players).forEach((id) => { scores[id] = 0; });

  const game = {
    code,
    mode,
    puzzle,
    players: JSON.parse(JSON.stringify(players)),
    cells,
    scores,
    chat:      [],
    startedAt: Date.now(),
    endedAt:   null,
  };

  store.set(code, game);
  return sanitize(game);
}

/**
 * Return the full game state.
 */
export function getGame(code) {
  const game = store.get(code);
  return game ? sanitize(game) : null;
}

/**
 * Set a cell letter.  Returns { cell, pointsDelta }.
 *
 * Scoring rules (Together mode):
 *   +1  for filling an empty white cell
 *   +4  bonus for completing a word (all cells correct)
 *   -1  for overwriting another player's letter
 *
 * In Versus mode each player only sees their own cells,
 * but we still track server-side for fairness.
 */
export function setCell(code, row, col, letter, playerId) {
  const game = store.get(code);
  if (!game) throw Object.assign(new Error('Game not found'), { status: 404 });

  const k    = `${row},${col}`;
  const cell = game.cells[k];
  if (!cell) throw Object.assign(new Error('Invalid cell'), { status: 400 });

  const wasEmpty  = cell.letter === '';
  const oldOwner  = cell.owner;

  cell.letter = letter.toUpperCase();
  cell.owner  = playerId;

  // Scoring
  let delta = 0;
  if (letter && wasEmpty) {
    delta += 1;
  } else if (letter && oldOwner && oldOwner !== playerId) {
    delta -= 1;
  }

  if (delta !== 0) {
    game.scores[playerId] = (game.scores[playerId] || 0) + delta;
  }

  return { cell: { ...cell }, pointsDelta: delta };
}

/**
 * Check cells (letter, word, or full grid) against the
 * solution.  Marks cells as correct/incorrect in-memory.
 *
 * @param {string} scope   - 'letter' | 'word' | 'grid'
 * @param {object} anchor  - { row, col } — used for letter/word
 * @returns {object}       - { results: [{r,c,correct}] }
 */
export function checkCells(code, scope, anchor) {
  const game = store.get(code);
  if (!game) throw Object.assign(new Error('Game not found'), { status: 404 });

  const toCheck = getCellsInScope(game, scope, anchor);
  const results = toCheck.map(([r, c]) => {
    const k      = `${r},${c}`;
    const cell   = game.cells[k];
    const answer = game.puzzle.solution?.[r]?.[c];
    const correct = !!cell?.letter && cell.letter === answer;
    return { r, c, correct, letter: cell?.letter || '' };
  });
  return { results };
}

/**
 * Reveal cells (letter, word, or full grid).
 * Sets each target cell to its solution letter.
 *
 * @returns {object} - { revealed: [{r,c,letter}] }
 */
export function revealCells(code, scope, anchor) {
  const game = store.get(code);
  if (!game) throw Object.assign(new Error('Game not found'), { status: 404 });

  const toReveal = getCellsInScope(game, scope, anchor);
  const revealed = [];

  toReveal.forEach(([r, c]) => {
    const k      = `${r},${c}`;
    const answer = game.puzzle.solution?.[r]?.[c];
    if (answer && game.cells[k]) {
      game.cells[k].letter   = answer;
      game.cells[k].revealed = true;
      revealed.push({ r, c, letter: answer });
    }
  });

  // Check if entire grid is now complete
  const isComplete = checkGridComplete(game);
  if (isComplete) game.endedAt = Date.now();

  return { revealed, gameComplete: isComplete };
}

/**
 * Update a player's profile (name / color) mid-game.
 */
export function updatePlayer(code, playerId, { name, color }) {
  const game = store.get(code);
  if (!game) throw Object.assign(new Error('Game not found'), { status: 404 });
  const player = game.players[playerId];
  if (!player) throw Object.assign(new Error('Player not found'), { status: 404 });
  if (name)  player.name  = name;
  if (color) player.color = color;
  return sanitize(game);
}

/**
 * Append a chat message.
 */
export function addChatMessage(code, { playerId, name, color, text }) {
  const game = store.get(code);
  if (!game) throw Object.assign(new Error('Game not found'), { status: 404 });
  const msg = { playerId, name, color, text, ts: Date.now() };
  game.chat.push(msg);
  if (game.chat.length > 200) game.chat.shift();
  return msg;
}

/**
 * Mark the game as forcibly ended (forfeit).
 */
export function forfeitGame(code) {
  const game = store.get(code);
  if (!game) throw Object.assign(new Error('Game not found'), { status: 404 });
  game.endedAt = Date.now();
  return sanitize(game);
}

// ── Internal helpers ───────────────────────────────

function getCellsInScope(game, scope, anchor) {
  const size = game.puzzle.size;
  if (scope === 'grid') {
    const all = [];
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        if (game.puzzle.grid[r][c] !== '.') all.push([r, c]);
    return all;
  }

  if (scope === 'letter') {
    return anchor ? [[anchor.row, anchor.col]] : [];
  }

  if (scope === 'word') {
    if (!anchor) return [];
    // Try to find the word in both directions; prefer across
    return getWordCells(game.puzzle, anchor.row, anchor.col, 'across')
        || getWordCells(game.puzzle, anchor.row, anchor.col, 'down')
        || [];
  }

  return [];
}

function getWordCells(puzzle, r, c, dir) {
  const size = puzzle.size;
  const cells = [];
  if (dir === 'across') {
    let sc = c;
    while (sc > 0 && puzzle.grid[r][sc - 1] !== '.') sc--;
    while (sc < size && puzzle.grid[r][sc] !== '.') cells.push([r, sc++]);
  } else {
    let sr = r;
    while (sr > 0 && puzzle.grid[sr - 1][c] !== '.') sr--;
    while (sr < size && puzzle.grid[sr][c] !== '.') cells.push([sr++, c]);
  }
  return cells.length > 1 ? cells : null;
}

function checkGridComplete(game) {
  for (const [k, cell] of Object.entries(game.cells)) {
    const [r, c] = k.split(',').map(Number);
    const answer = game.puzzle.solution?.[r]?.[c];
    if (!cell.letter || cell.letter !== answer) return false;
  }
  return true;
}

function sanitize(game) {
  return JSON.parse(JSON.stringify(game));
}
