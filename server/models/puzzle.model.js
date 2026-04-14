/**
 * puzzle.model.js — Puzzle catalogue model.
 *
 * In production this would query a database.  For
 * demonstration a static seed set is used.
 *
 * Puzzle shape:
 * {
 *   id:         string,
 *   title:      string,
 *   difficulty: 'easy'|'medium'|'hard',
 *   size:       number,        // grid is size × size
 *   grid:       string[][],    // '.' = black, letter = answer
 *   solution:   string[][],    // same as grid (answers)
 *   numbers:    number[][],    // clue numbers (0 = none)
 *   clues: {
 *     across: [{num, clue}],
 *     down:   [{num, clue}],
 *   },
 *   author?:    string,
 *   source?:    string,
 * }
 */

// ── Sample 5×5 mini puzzle ─────────────────────────
const MINI_PUZZLE = {
  id:         'mini_001',
  title:      'Mini Classic',
  difficulty: 'easy',
  size:       5,
  // '.' = black square, letter = correct answer
  grid: [
    ['C','R','O','S','S'],
    ['H','.','N','.','T'],
    ['E','A','S','T','A'],
    ['S','.','E','.','R'],
    ['S','T','R','E','S'],
  ],
  solution: [
    ['C','R','O','S','S'],
    ['H','.','N','.','T'],
    ['E','A','S','T','A'],
    ['S','.','E','.','R'],
    ['S','T','R','E','S'],
  ],
  numbers: [
    [1, 2, 3, 0, 4],
    [5, 0, 0, 0, 0],
    [0, 6, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [7, 0, 0, 0, 0],
  ],
  clues: {
    across: [
      { num: 1, clue: 'Angry' },
      { num: 4, clue: 'Rising agent for bread' },
      { num: 5, clue: 'Hunt for' },
      { num: 6, clue: 'Direction of sunrise' },
      { num: 7, clue: 'Pressure or tension' },
    ],
    down: [
      { num: 1, clue: 'Checkers piece (Brit.)' },
      { num: 2, clue: 'Flat-bottomed boat' },
      { num: 3, clue: 'Notes, as in music' },
      { num: 4, clue: 'Celestial body' },
    ],
  },
};

// ── Sample 7×7 puzzle ─────────────────────────────
const SMALL_PUZZLE = {
  id:         'small_001',
  title:      'Word Basics',
  difficulty: 'easy',
  size:       7,
  grid: [
    ['B','A','S','K','E','T','S'],
    ['R','.','A','.','A','.','T'],
    ['E','V','E','N','T','L','Y'],
    ['A','.','N','.','E','.','L'],
    ['D','A','I','L','Y','.','E'],
    ['.','.','N','.','.','.','S'],
    ['W','O','R','D','S','.','S'],
  ],
  solution: [
    ['B','A','S','K','E','T','S'],
    ['R','.','A','.','A','.','T'],
    ['E','V','E','N','T','L','Y'],
    ['A','.','N','.','E','.','L'],
    ['D','A','I','L','Y','.','E'],
    ['.','.','N','.','.','.','S'],
    ['W','O','R','D','S','.','S'],
  ],
  numbers: [
    [1, 0, 2, 0, 3, 0, 4],
    [5, 0, 0, 0, 0, 0, 0],
    [0, 6, 0, 0, 0, 0, 0],
    [7, 0, 0, 0, 0, 0, 0],
    [0, 8, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
    [9, 0, 0, 0, 0, 0, 0],
  ],
  clues: {
    across: [
      { num: 1, clue: 'Hoops container, plural' },
      { num: 5, clue: 'Dough in the oven' },
      { num: 6, clue: 'In a smooth, flowing manner' },
      { num: 7, clue: 'Loaf ingredient' },
      { num: 8, clue: 'Happening every day' },
      { num: 9, clue: 'Vocabulary items, plural' },
    ],
    down: [
      { num: 1, clue: 'Breakfast food' },
      { num: 2, clue: 'Object awareness' },
      { num: 3, clue: 'Consume food' },
      { num: 4, clue: 'Writing instruments, plural' },
      { num: 6, clue: 'Old Norse traveller' },
    ],
  },
};

// ── Catalogue ──────────────────────────────────────
const CATALOGUE = [MINI_PUZZLE, SMALL_PUZZLE];
const byId = new Map(CATALOGUE.map((p) => [p.id, p]));

// ── Public API ─────────────────────────────────────

/**
 * List puzzles, optionally filtered.
 * @param {{ difficulty?:string, size?:string }} filters
 */
export function listPuzzles(filters = {}) {
  let results = CATALOGUE;
  if (filters.difficulty) {
    results = results.filter((p) => p.difficulty === filters.difficulty);
  }
  if (filters.size === 'standard') {
    results = results.filter((p) => p.size <= 15);
  }
  if (filters.size === 'large') {
    results = results.filter((p) => p.size > 15);
  }
  // Return summary (no solution exposed to client)
  return results.map(summarise);
}

/**
 * Get full puzzle by ID (solution included — server use only).
 */
export function getPuzzle(id) {
  return byId.get(id) || null;
}

/**
 * Get puzzle summary safe to send to the client before
 * the game starts (no solution).
 */
export function getPuzzleSummary(id) {
  const p = byId.get(id);
  return p ? summarise(p) : null;
}

function summarise(p) {
  const { solution: _s, ...rest } = p;  // omit solution
  return rest;
}
