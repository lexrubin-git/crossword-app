// ── puzzle.js — Puzzle catalogue, parsing helpers, and format utilities ──

export const PUZZLE_POOL = {
  standard: {
    easy: [
      '1997/01/06','1998/03/02','1999/05/03','2000/07/10','2001/02/05','2002/04/08',
      '2003/06/02','2004/08/02','2005/10/03','2006/12/04','2007/01/08','2008/03/03',
      '2009/05/04','2010/07/05','2011/09/05','2012/11/05','2013/01/07','2014/03/03',
      '2015/05/04','2016/07/04','2017/09/04',
    ],
    medium: [
      '1997/01/08','1998/03/04','1999/05/05','2000/07/12','2001/02/07','2002/04/10',
      '2003/06/04','2004/08/04','2005/10/05','2006/12/06','2007/01/10','2008/03/05',
      '2009/05/06','2010/07/07','2011/09/07','2012/11/07','2013/01/09','2014/03/05',
      '2015/05/06','2016/07/06','2017/09/06',
    ],
    hard: [
      '1997/01/10','1998/03/06','1999/05/07','2000/07/14','2001/02/09','2002/04/12',
      '2003/06/06','2004/08/06','2005/10/07','2006/12/08','2007/01/12','2008/03/07',
      '2009/05/08','2010/07/09','2011/09/09','2012/11/09','2013/01/11','2014/03/07',
      '2015/05/08','2016/07/08','2017/09/08',
      '1997/01/11','1998/03/07','1999/05/08','2000/07/15','2001/02/10','2002/04/13',
      '2003/06/07','2004/08/07','2005/10/08','2006/12/09','2007/01/13','2008/03/08',
      '2009/05/09','2010/07/10','2011/09/10','2012/11/10','2013/01/12','2014/03/08',
      '2015/05/09','2016/07/09','2017/09/09',
    ],
  },
  large: {
    medium: [
      '1997/01/19','1998/03/15','1999/05/16','2000/07/23','2001/02/18','2002/04/21',
      '2003/06/15','2004/08/15','2005/10/16','2006/12/17','2007/01/21','2008/03/16',
      '2009/05/17','2010/07/18','2011/09/18','2012/11/18','2013/01/20','2014/03/16',
      '2015/05/17','2016/07/17','2017/09/17',
      '1997/01/26','1998/03/22','1999/05/23','2000/07/30','2001/02/25','2002/04/28',
      '2003/06/22','2004/08/22','2005/10/23','2006/12/24','2007/01/28','2008/03/23',
      '2009/05/24','2010/07/25','2011/09/25','2012/11/25','2013/01/27','2014/03/23',
      '2015/05/24','2016/07/24','2017/09/24',
    ],
  },
};

export function pickRandomPuzzle(size, diff) {
  const pool = PUZZLE_POOL[size]?.[diff];
  if (!pool || !pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function formatNytDateLabel(dateKey) {
  if (!dateKey || dateKey.startsWith('combo:')) {
    if (dateKey && dateKey.startsWith('combo:')) {
      const parts = dateKey.split(':');
      const sizeL = parts[1] === 'large' ? '21×21' : '15×15';
      const diffL = { easy:'Easy', medium:'Medium', hard:'Hard' }[parts[2]] || (parts[2] || '');
      return `Random ${sizeL} ${diffL}`;
    }
    return 'Unknown Puzzle';
  }
  const parts = dateKey.split('/');
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  if (isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString('en-US', { weekday:'short', year:'numeric', month:'short', day:'numeric' });
}

export function puzzleLabel(size, diff) {
  const sizeLabel = size === 'large' ? 'Large (21×21)' : 'Standard (15×15)';
  const diffLabel = { easy:'Easy (Mon)', medium:'Medium (Wed/Sun)', hard:'Hard (Fri/Sat)' }[diff] || diff;
  return `${sizeLabel} · ${diffLabel}`;
}

export function parseNytPuzzle(data, dateKey) {
  const rows = data.size.rows;
  const cols = data.size.cols;
  const grid = data.grid;

  const blacks = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r * cols + c] === '.') blacks.push([r, c]);
    }
  }

  function parseClues(arr) {
    const map = {};
    (arr||[]).forEach(s => {
      const m = s.match(/^(\d+)\.\s*(.*)/);
      if (m) map[parseInt(m[1])] = m[2];
    });
    return map;
  }
  const acrossClues = parseClues(data.clues.across);
  const downClues   = parseClues(data.clues.down);

  const blackSet = new Set(blacks.map(([r,c])=>r+'_'+c));
  const isBlack = (r,c) => blackSet.has(r+'_'+c);

  const words = [];
  const cellNum = {};
  let num = 1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isBlack(r,c)) continue;
      const startAcross = (c===0||isBlack(r,c-1)) && c+1<cols && !isBlack(r,c+1);
      const startDown   = (r===0||isBlack(r-1,c)) && r+1<rows && !isBlack(r+1,c);
      if (startAcross || startDown) {
        cellNum[r+'_'+c] = num;
        if (startAcross) {
          const cells = [];
          for (let cc = c; cc < cols && !isBlack(r,cc); cc++) cells.push({row:r,col:cc});
          const answer = cells.map(cell => {
            const ch = grid[cell.row * cols + cell.col];
            return ch === '.' ? ' ' : ch.toUpperCase();
          }).join('');
          words.push({ num, dir:'across', row:r, col:c, length:cells.length, cells,
            answer, clue: acrossClues[num] || `${num} Across` });
        }
        if (startDown) {
          const cells = [];
          for (let rr = r; rr < rows && !isBlack(rr,c); rr++) cells.push({row:rr,col:c});
          const answer = cells.map(cell => {
            const ch = grid[cell.row * cols + cell.col];
            return ch === '.' ? ' ' : ch.toUpperCase();
          }).join('');
          words.push({ num, dir:'down', row:r, col:c, length:cells.length, cells,
            answer, clue: downClues[num] || `${num} Down` });
        }
        num++;
      }
    }
  }

  const label = formatNytDateLabel(dateKey);
  return {
    id: dateKey,
    name: label,
    size: rows,
    cols: cols !== rows ? cols : undefined,
    blacks,
    _nytWords: words,
    _nytCellNum: cellNum,
    _nytTitle: data.title || label,
  };
}
