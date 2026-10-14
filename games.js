/* ==========================================================================
   Nexus-Chat – Spiele-Engine (GX)
   --------------------------------------------------------------------------
   Rein funktional, deterministisch, ohne DOM und ohne Netzwerk.

   Grundregel:  Gleicher Seed + gleiches Zug-Protokoll  →  exakt gleicher
   Zustand.  Über das Netzwerk gehen deshalb nur {seed, opts} und die Züge,
   nie der komplette Spielstand.

   Alle Funktionen sind seitenwirkungsfrei: `apply()` liefert einen neuen
   Zustand zurück und verändert den übergebenen nicht.
   ========================================================================== */

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.GX = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.0.0';

  /* ------------------------------------------------------------ Fehler --- */

  class GameError extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'GameError';
      this.code = code || 'GX_ERROR';
    }
  }

  /* ------------------------------------------------- Zufall (mulberry32) --- */

  /** FNV-1a: macht aus einem beliebigen String einen 32-Bit-Seed. */
  function hashSeed(input) {
    const s = String(input);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /** Deterministischer PRNG. Gleicher Seed → gleiche Zahlenfolge. */
  function rng(seed) {
    let a = hashSeed(seed) || 0x9e3779b9;
    return function next() {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randInt(rnd, n) {
    return Math.floor(rnd() * n) % n;
  }

  function shuffle(rnd, list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = randInt(rnd, i + 1);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  /* ------------------------------------------------------- Hilfskram ----- */

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function assert(cond, message, code) {
    if (!cond) throw new GameError(message, code);
  }

  function key(...parts) {
    return parts.join(':');
  }

  /* ======================================================================
     1) TIC TAC TOE
     ====================================================================== */

  const TTT_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  function tttWinner(board) {
    for (const line of TTT_LINES) {
      const [a, b, c] = line;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return { mark: board[a], line };
      }
    }
    return null;
  }

  const ticTacToe = {
    id: 'tictactoe',
    init(state) {
      state.data = { board: ['', '', '', '', '', '', '', '', ''] };
      state.turn = 0;
    },
    moves(state, player) {
      if (state.over || state.turn !== player) return [];
      const out = [];
      state.data.board.forEach((cell, i) => {
        if (!cell) out.push({ cell: i });
      });
      return out;
    },
    apply(state, move) {
      const i = Number(move && move.cell);
      assert(Number.isInteger(i) && i >= 0 && i < 9, 'Feld muss 0..8 sein.', 'BAD_MOVE');
      assert(!state.data.board[i], 'Feld ist schon belegt.', 'CELL_TAKEN');
      state.data.board[i] = state.turn === 0 ? 'X' : 'O';
      const win = tttWinner(state.data.board);
      if (win) {
        state.over = true;
        state.winner = win.mark === 'X' ? 'p0' : 'p1';
        state.data.line = win.line;
      } else if (state.data.board.every(Boolean)) {
        state.over = true;
        state.winner = 'draw';
      } else {
        state.turn = 1 - state.turn;
      }
    },
    view(state) {
      return clone(state);
    },
    label(state) {
      if (state.over) return state.winner === 'draw' ? 'Unentschieden' : `${state.winner === 'p0' ? 'X' : 'O'} gewinnt`;
      return `${state.turn === 0 ? 'X' : 'O'} ist am Zug`;
    },
    ai(state, player) {
      const board = state.data.board;
      const me = player === 0 ? 'X' : 'O';
      const other = me === 'X' ? 'O' : 'X';
      const findLine = (mark) => {
        for (const line of TTT_LINES) {
          const cells = line.map((i) => board[i]);
          if (cells.filter((c) => c === mark).length === 2 && cells.includes('')) {
            return line[cells.indexOf('')];
          }
        }
        return -1;
      };
      let cell = findLine(me);
      if (cell < 0) cell = findLine(other);
      if (cell < 0 && !board[4]) cell = 4;
      if (cell < 0) {
        const corners = [0, 2, 6, 8].filter((i) => !board[i]);
        if (corners.length) cell = corners[0];
      }
      if (cell < 0) cell = board.findIndex((c) => !c);
      return { cell };
    },
  };

  /* ======================================================================
     2) VIER GEWINNT
     ====================================================================== */

  const C4_COLS = 7;
  const C4_ROWS = 6;

  function c4Winner(grid) {
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (let x = 0; x < C4_COLS; x += 1) {
      for (let y = 0; y < C4_ROWS; y += 1) {
        const mark = grid[x][y];
        if (!mark) continue;
        for (const [dx, dy] of dirs) {
          let count = 1;
          for (let step = 1; step < 4; step += 1) {
            const nx = x + dx * step;
            const ny = y + dy * step;
            if (nx < 0 || nx >= C4_COLS || ny < 0 || ny >= C4_ROWS) break;
            if (grid[nx][ny] !== mark) break;
            count += 1;
          }
          if (count >= 4) return { mark, x, y, dx, dy };
        }
      }
    }
    return null;
  }

  const connect4 = {
    id: 'connect4',
    init(state) {
      state.data = {
        grid: Array.from({ length: C4_COLS }, () => Array(C4_ROWS).fill('')),
        last: null,
      };
      state.turn = 0;
    },
    moves(state, player) {
      if (state.over || state.turn !== player) return [];
      const out = [];
      state.data.grid.forEach((col, i) => {
        if (col.some((c) => !c)) out.push({ col: i });
      });
      return out;
    },
    apply(state, move) {
      const c = Number(move && move.col);
      assert(Number.isInteger(c) && c >= 0 && c < C4_COLS, 'Spalte muss 0..6 sein.', 'BAD_MOVE');
      const col = state.data.grid[c];
      const row = col.findIndex((cell) => !cell);
      assert(row >= 0, 'Spalte ist voll.', 'COL_FULL');
      const mark = state.turn === 0 ? 'R' : 'Y';
      col[row] = mark;
      state.data.last = { col: c, row, mark };
      const win = c4Winner(state.data.grid);
      if (win) {
        state.over = true;
        state.winner = win.mark === 'R' ? 'p0' : 'p1';
        state.data.win = win;
      } else if (state.data.grid.every((column) => column.every(Boolean))) {
        state.over = true;
        state.winner = 'draw';
      } else {
        state.turn = 1 - state.turn;
      }
    },
    view(state) {
      return clone(state);
    },
    label(state) {
      if (state.over) return state.winner === 'draw' ? 'Unentschieden' : `${state.winner === 'p0' ? 'Rot' : 'Gelb'} gewinnt`;
      return `${state.turn === 0 ? 'Rot' : 'Gelb'} ist am Zug`;
    },
    ai(state, player) {
      const playable = this.moves(state, player).map((m) => m.col);
      const me = player === 0 ? 'R' : 'Y';
      const other = me === 'R' ? 'Y' : 'R';
      const simulate = (col, mark) => {
        const grid = clone(state.data.grid);
        const row = grid[col].findIndex((cell) => !cell);
        if (row < 0) return false;
        grid[col][row] = mark;
        return c4Winner(grid);
      };
      for (const col of playable) if (simulate(col, me)) return { col };
      for (const col of playable) if (simulate(col, other)) return { col };
      if (playable.includes(3)) return { col: 3 };
      return { col: playable[0] };
    },
  };

  /* ======================================================================
     3) SCHERE STEIN PAPIER
     ====================================================================== */

  const SHAPES = ['rock', 'paper', 'scissors'];
  const SHAPE_DE = { rock: 'Stein', paper: 'Papier', scissors: 'Schere' };
  const RPS_ROUNDS = 5;
  const RPS_TARGET = 3;

  function rpsBeat(a, b) {
    if (a === b) return 'draw';
    if (
      (a === 'rock' && b === 'scissors') ||
      (a === 'paper' && b === 'rock') ||
      (a === 'scissors' && b === 'paper')
    ) return 'win';
    return 'lose';
  }

  const rockPaperScissors = {
    id: 'rps',
    init(state) {
      state.data = { pending: [null, null], scores: [0, 0], rounds: [], round: 1 };
      state.turn = 0;
    },
    moves(state, player) {
      if (state.over || state.turn !== player) return [];
      return SHAPES.map((shape) => ({ shape }));
    },
    apply(state, move) {
      const shape = move && move.shape;
      assert(SHAPES.includes(shape), 'Nur Stein, Papier oder Schere.', 'BAD_SHAPE');
      state.data.pending[state.turn] = shape;
      if (state.data.pending[0] && state.data.pending[1]) {
        const result = rpsBeat(state.data.pending[0], state.data.pending[1]);
        if (result === 'win') state.data.scores[0] += 1;
        else if (result === 'lose') state.data.scores[1] += 1;
        state.data.rounds.push({
          round: state.data.round,
          a: state.data.pending[0],
          b: state.data.pending[1],
          result,
        });
        state.data.pending = [null, null];
        state.data.round += 1;
        const [sa, sb] = state.data.scores;
        if (sa >= RPS_TARGET || sb >= RPS_TARGET || state.data.round > RPS_ROUNDS) {
          state.over = true;
          state.winner = sa > sb ? 'p0' : sb > sa ? 'p1' : 'draw';
        }
      }
      if (!state.over) state.turn = 1 - state.turn;
    },
    view(state, player) {
      const out = clone(state);
      const other = 1 - player;
      if (out.data.pending[other]) out.data.pending[other] = 'hidden';
      return out;
    },
    label(state) {
      if (state.over) {
        if (state.winner === 'draw') return 'Unentschieden';
        return `${state.winner === 'p0' ? state.players[0] : state.players[1]} gewinnt ${state.data.scores[0]}:${state.data.scores[1]}`;
      }
      return `Runde ${state.data.round} – ${state.players[state.turn]} wählt`;
    },
    ai(state, player) {
      const hist = state.data.rounds;
      if (hist.length >= 2) {
        const last = hist[hist.length - 1].a;
        const counter = { rock: 'paper', paper: 'scissors', scissors: 'rock' };
        return { shape: counter[last] || 'rock' };
      }
      const order = ['paper', 'rock', 'scissors'];
      return { shape: order[hist.length % order.length] };
    },
  };

  /* ======================================================================
     4) MEMORY
     ====================================================================== */

  const MEMORY_SYMBOLS = ['🍎', '🚀', '🎲', '🌙', '🐙', '🎧', '🍀', '⚡'];

  const memory = {
    id: 'memory',
    init(state, opts, rnd) {
      const pairs = MEMORY_SYMBOLS.slice(0, opts.pairs || 8);
      const deck = shuffle(rnd, pairs.concat(pairs)).map((symbol, index) => ({
        index,
        symbol,
        up: false,
        done: false,
      }));
      state.data = { cards: deck, open: [], pairs: [0, 0], flips: 0 };
      state.turn = 0;
    },
    moves(state, player) {
      if (state.over || state.turn !== player) return [];
      const free = state.data.cards.filter((c) => !c.done).map((c) => c.index);
      if (free.length < 2) return [];
      const out = [];
      for (let i = 0; i < free.length; i += 1) {
        for (let j = i + 1; j < free.length; j += 1) out.push({ a: free[i], b: free[j] });
      }
      return out;
    },
    apply(state, move) {
      const a = Number(move && move.a);
      const b = Number(move && move.b);
      const cards = state.data.cards;
      assert(Number.isInteger(a) && Number.isInteger(b), 'Zwei Karten angeben.', 'BAD_MOVE');
      assert(a !== b, 'Zwei verschiedene Karten wählen.', 'SAME_CARD');
      const ca = cards[a];
      const cb = cards[b];
      assert(ca && cb, 'Karte gibt es nicht.', 'NO_CARD');
      assert(!ca.done && !cb.done, 'Karte ist schon gefunden.', 'CARD_DONE');
      state.data.flips += 1;
      if (ca.symbol === cb.symbol) {
        ca.done = true;
        cb.done = true;
        state.data.pairs[state.turn] += 1;
      } else {
        state.turn = 1 - state.turn;
      }
      state.data.open = [a, b];
      if (state.data.cards.every((c) => c.done)) {
        state.over = true;
        const [pa, pb] = state.data.pairs;
        state.winner = pa > pb ? 'p0' : pb > pa ? 'p1' : 'draw';
      }
    },
    view(state, player) {
      const out = clone(state);
      out.data.cards = out.data.cards.map((card) => {
        if (card.done || out.data.open.includes(card.index)) return card;
        return { index: card.index, symbol: '?', up: false, done: false };
      });
      return out;
    },
    label(state) {
      if (state.over) {
        const [pa, pb] = state.data.pairs;
        return state.winner === 'draw' ? `Unentschieden ${pa}:${pb}` : `${state.players[state.winner === 'p0' ? 0 : 1]} gewinnt ${pa}:${pb}`;
      }
      return `${state.players[state.turn]} deckt auf (${state.data.pairs[0]}:${state.data.pairs[1]})`;
    },
    ai(state, player) {
      const legal = this.moves(state, player);
      const rnd = rng(`${state.seed}|ai|${state.log.length}`);
      return legal[randInt(rnd, legal.length)];
    },
  };

  /* ======================================================================
     5) SCHIFFE VERSENKEN
     ====================================================================== */

  const BS_SIZE = 10;
  const BS_FLEET = [4, 3, 3, 2];

  function bsPlaceFleet(rnd) {
    const grid = Array.from({ length: BS_SIZE }, () => Array(BS_SIZE).fill(0));
    const ships = [];
    BS_FLEET.forEach((size, index) => {
      for (let attempt = 0; attempt < 500; attempt += 1) {
        const horizontal = rnd() < 0.5;
        const x = randInt(rnd, horizontal ? BS_SIZE - size + 1 : BS_SIZE);
        const y = randInt(rnd, horizontal ? BS_SIZE : BS_SIZE - size + 1);
        const cells = [];
        let free = true;
        for (let step = 0; step < size; step += 1) {
          const cx = x + (horizontal ? step : 0);
          const cy = y + (horizontal ? 0 : step);
          if (grid[cy][cx]) { free = false; break; }
          cells.push({ x: cx, y: cy });
        }
        if (free) {
          cells.forEach((c) => { grid[c.y][c.x] = index + 1; });
          ships.push({ id: index + 1, size, cells, hits: 0 });
          return;
        }
      }
      throw new GameError('Flotte passt nicht aufs Feld.', 'NO_FLEET');
    });
    return { grid, ships };
  }

  const battleship = {
    id: 'battleship',
    init(state, opts) {
      const boards = state.players.map((_, index) => bsPlaceFleet(rng(`${state.seed}|fleet|${index}`)));
      state.data = {
        boards,
        shots: [
          Array.from({ length: BS_SIZE }, () => Array(BS_SIZE).fill('')),
          Array.from({ length: BS_SIZE }, () => Array(BS_SIZE).fill('')),
        ],
        sunk: [[], []],
      };
      state.turn = 0;
    },
    moves(state, player) {
      if (state.over || state.turn !== player) return [];
      const target = 1 - player;
      const out = [];
      state.data.shots[target].forEach((row, y) => {
        row.forEach((cell, x) => {
          if (!cell) out.push({ x, y });
        });
      });
      return out;
    },
    apply(state, move) {
      const x = Number(move && move.x);
      const y = Number(move && move.y);
      assert(Number.isInteger(x) && Number.isInteger(y), 'Koordinate x/y angeben.', 'BAD_MOVE');
      assert(x >= 0 && x < BS_SIZE && y >= 0 && y < BS_SIZE, 'Koordinate außerhalb des Felds.', 'OUT_OF_RANGE');
      const target = 1 - state.turn;
      assert(!state.data.shots[target][y][x], 'Feld wurde schon beschossen.', 'ALREADY_SHOT');
      const shipId = state.data.boards[target].grid[y][x];
      if (shipId) {
        state.data.shots[target][y][x] = 'hit';
        const ship = state.data.boards[target].ships.find((s) => s.id === shipId);
        ship.hits += 1;
        if (ship.hits >= ship.size) state.data.sunk[target].push(ship.id);
      } else {
        state.data.shots[target][y][x] = 'miss';
      }
      const allSunk = state.data.boards[target].ships.every((s) => s.hits >= s.size);
      if (allSunk) {
        state.over = true;
        state.winner = state.turn === 0 ? 'p0' : 'p1';
      } else if (!shipId) {
        state.turn = 1 - state.turn;
      }
    },
    view(state, player) {
      const out = clone(state);
      out.data.boards = out.data.boards.map((board, index) => {
        if (index === player) return board;
        return { grid: Array.from({ length: BS_SIZE }, () => Array(BS_SIZE).fill(0)), ships: board.ships.map((s) => ({ id: s.id, size: s.size })) };
      });
      return out;
    },
    label(state) {
      if (state.over) return `${state.players[state.winner === 'p0' ? 0 : 1]} hat die Flotte versenkt`;
      return `${state.players[state.turn]} schießt`;
    },
    ai(state, player) {
      const target = 1 - player;
      const shots = state.data.shots[target];
      for (let y = 0; y < BS_SIZE; y += 1) {
        for (let x = 0; x < BS_SIZE; x += 1) {
          if (shots[y][x] !== 'hit') continue;
          const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]];
          for (const [dx, dy] of neighbours) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= BS_SIZE || ny < 0 || ny >= BS_SIZE) continue;
            if (!shots[ny][nx]) return { x: nx, y: ny };
          }
        }
      }
      const legal = this.moves(state, player);
      const parity = legal.filter((m) => (m.x + m.y) % 2 === 0);
      const pool = parity.length ? parity : legal;
      return pool[0];
    },
  };

  /* ======================================================================
     6) TANK WARS
     ====================================================================== */

  const TW_SIZE = 12;
  const TW_HP = 3;
  const TW_MAX_TURNS = 80;
  const DIRS = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

  const tankWars = {
    id: 'tankwars',
    init(state, opts, rnd) {
      const walls = [];
      const seen = new Set();
      const blockedStart = new Set(['1:1', '2:1', '1:2', '10:10', '9:10', '10:9']);
      let guard = 0;
      while (walls.length < 20 && guard < 500) {
        guard += 1;
        const x = randInt(rnd, TW_SIZE);
        const y = randInt(rnd, TW_SIZE);
        const k = key(x, y);
        if (seen.has(k) || blockedStart.has(k)) continue;
        seen.add(k);
        walls.push({ x, y });
      }
      state.data = {
        walls,
        tanks: [
          { x: 1, y: 1, dir: 'E', hp: TW_HP },
          { x: 10, y: 10, dir: 'W', hp: TW_HP },
        ],
        turns: 0,
        lastShot: null,
      };
      state.turn = 0;
    },
    _isWall(state, x, y) {
      return state.data.walls.some((w) => w.x === x && w.y === y);
    },
    _tankAt(state, x, y) {
      return state.data.tanks.findIndex((t) => t.x === x && t.y === y && t.hp > 0);
    },
    moves(state, player) {
      if (state.over || state.turn !== player) return [];
      const tank = state.data.tanks[player];
      const out = [];
      Object.keys(DIRS).forEach((dir) => {
        if (dir !== tank.dir) out.push({ type: 'turn', dir });
      });
      const [dx, dy] = DIRS[tank.dir];
      const nx = tank.x + dx;
      const ny = tank.y + dy;
      if (nx >= 0 && nx < TW_SIZE && ny >= 0 && ny < TW_SIZE &&
          !this._isWall(state, nx, ny) && this._tankAt(state, nx, ny) < 0) {
        out.push({ type: 'move' });
      }
      out.push({ type: 'fire' });
      return out;
    },
    apply(state, move) {
      const type = move && move.type;
      assert(['turn', 'move', 'fire'].includes(type), 'Zug muss turn, move oder fire sein.', 'BAD_MOVE');
      const tank = state.data.tanks[state.turn];
      if (type === 'turn') {
        assert(DIRS[move.dir], 'Richtung muss N, S, E oder W sein.', 'BAD_DIR');
        tank.dir = move.dir;
      } else if (type === 'move') {
        const [dx, dy] = DIRS[tank.dir];
        const nx = tank.x + dx;
        const ny = tank.y + dy;
        assert(nx >= 0 && nx < TW_SIZE && ny >= 0 && ny < TW_SIZE, 'Da ist die Arena zu Ende.', 'BLOCKED');
        assert(!this._isWall(state, nx, ny), 'Da steht eine Mauer.', 'BLOCKED');
        assert(this._tankAt(state, nx, ny) < 0, 'Da steht ein Panzer.', 'BLOCKED');
        tank.x = nx;
        tank.y = ny;
      } else {
        const [dx, dy] = DIRS[tank.dir];
        let cx = tank.x + dx;
        let cy = tank.y + dy;
        let hitTank = -1;
        while (cx >= 0 && cx < TW_SIZE && cy >= 0 && cy < TW_SIZE) {
          if (this._isWall(state, cx, cy)) break;
          const t = this._tankAt(state, cx, cy);
          if (t >= 0) { hitTank = t; break; }
          cx += dx;
          cy += dy;
        }
        state.data.lastShot = { from: state.turn, x: cx, y: cy, hit: hitTank >= 0 ? hitTank : null };
        if (hitTank >= 0) {
          state.data.tanks[hitTank].hp -= 1;
          if (state.data.tanks[hitTank].hp <= 0) {
            state.over = true;
            state.winner = state.turn === 0 ? 'p0' : 'p1';
          }
        }
      }
      state.data.turns += 1;
      if (!state.over && state.data.turns >= TW_MAX_TURNS) {
        state.over = true;
        const [a, b] = state.data.tanks;
        state.winner = a.hp > b.hp ? 'p0' : b.hp > a.hp ? 'p1' : 'draw';
      }
      if (!state.over) state.turn = 1 - state.turn;
    },
    view(state) {
      return clone(state);
    },
    label(state) {
      if (state.over) {
        return state.winner === 'draw' ? 'Unentschieden – Zeit abgelaufen' : `${state.players[state.winner === 'p0' ? 0 : 1]} gewinnt`;
      }
      const tank = state.data.tanks[state.turn];
      return `${state.players[state.turn]} ist am Zug (HP ${tank.hp}/${TW_HP})`;
    },
    ai(state, player) {
      const legal = this.moves(state, player);
      const me = state.data.tanks[player];
      const foe = state.data.tanks[1 - player];
      const aligned = me.x === foe.x || me.y === foe.y;
      const facing = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[me.dir];
      const dirToFoe = foe.x === me.x ? (foe.y < me.y ? 'N' : 'S') : (foe.x < me.x ? 'W' : 'E');
      const clearShot = (dir) => {
        const [dx, dy] = DIRS[dir];
        let cx = me.x + dx;
        let cy = me.y + dy;
        while (cx >= 0 && cx < TW_SIZE && cy >= 0 && cy < TW_SIZE) {
          if (this._isWall(state, cx, cy)) return false;
          if (cx === foe.x && cy === foe.y) return true;
          cx += dx;
          cy += dy;
        }
        return false;
      };
      if (aligned && facing && clearShot(me.dir)) return { type: 'fire' };
      if (aligned && legal.some((m) => m.type === 'turn' && m.dir === dirToFoe)) {
        return { type: 'turn', dir: dirToFoe };
      }
      const move = legal.find((m) => m.type === 'move');
      if (move) return move;
      const turn = legal.find((m) => m.type === 'turn');
      if (turn) return turn;
      return { type: 'fire' };
    },
  };

  /* ======================================================================
     7) 20 FRAGEN
     ====================================================================== */

  const Q_MAX = 20;

  const twentyQuestions = {
    id: 'questions',
    init(state, opts, rnd) {
      state.data = {
        secret: 1 + randInt(rnd, 100),
        asked: [],
        left: opts.max || Q_MAX,
      };
      state.turn = 0; // Spieler 0 rät, Spieler 1 „antwortet“
    },
    moves(state, player) {
      if (state.over || state.turn !== player) return [];
      const used = new Set(state.data.asked.map((a) => a.guess));
      const out = [];
      for (let n = 1; n <= 100; n += 1) if (!used.has(n)) out.push({ guess: n });
      return out;
    },
    apply(state, move) {
      const guess = Number(move && move.guess);
      assert(Number.isInteger(guess) && guess >= 1 && guess <= 100, 'Tipp muss eine Zahl von 1 bis 100 sein.', 'BAD_GUESS');
      assert(!state.data.asked.some((a) => a.guess === guess), 'Diese Zahl war schon dran.', 'DUPLICATE');
      let hint;
      if (guess === state.data.secret) {
        hint = 'correct';
      } else {
        hint = guess < state.data.secret ? 'higher' : 'lower';
      }
      state.data.asked.push({ guess, hint });
      if (hint === 'correct') {
        state.over = true;
        state.winner = 'p0';
        return;
      }
      // Falscher Tipp kostet genau eine Frage – der Rater bleibt am Zug.
      state.data.left -= 1;
      if (state.data.left <= 0) {
        state.over = true;
        state.winner = 'p1';
        return;
      }
      state.turn = 0;
    },
    view(state, player) {
      const out = clone(state);
      if (player === 0) out.data.secret = null;
      return out;
    },
    label(state) {
      if (state.over) {
        return state.winner === 'p0'
          ? `${state.players[0]} hat die Zahl erraten`
          : `${state.players[1]} gewinnt – Fragen aufgebraucht`;
      }
      return `${state.players[0]} rät (${state.data.left} Fragen übrig)`;
    },
    ai(state) {
      let lo = 1;
      let hi = 100;
      state.data.asked.forEach((entry) => {
        if (entry.hint === 'higher') lo = Math.max(lo, entry.guess + 1);
        if (entry.hint === 'lower') hi = Math.min(hi, entry.guess - 1);
      });
      const used = new Set(state.data.asked.map((a) => a.guess));
      let guess = Math.floor((lo + hi) / 2);
      while (used.has(guess) && guess <= hi) guess += 1;
      if (guess > hi) guess = lo;
      return { guess };
    },
  };

  /* ======================================================================
     8) GELD AUSGEBEN
     ====================================================================== */

  const SPEND_POOL = [
    { id: 'kaffee', name: 'Kaffee-Flatrate', price: 12, value: 15 },
    { id: 'rad', name: 'Gebrauchtes Rad', price: 30, value: 44 },
    { id: 'konzert', name: 'Konzertkarte', price: 45, value: 60 },
    { id: 'buch', name: 'Buchpaket', price: 18, value: 20 },
    { id: 'pflanzen', name: 'Pflanzen-Abo', price: 22, value: 26 },
    { id: 'kopfh', name: 'Kopfhörer', price: 40, value: 42 },
    { id: 'essen', name: 'Essen gehen', price: 25, value: 33 },
    { id: 'kurs', name: 'Online-Kurs', price: 35, value: 52 },
    { id: 'spiel', name: 'Brettspiel', price: 28, value: 30 },
    { id: 'reise', name: 'Wochenendtrip', price: 90, value: 120 },
    { id: 'kamera', name: 'Kamera', price: 70, value: 74 },
    { id: 'spende', name: 'Spende', price: 20, value: 40 },
    { id: 'garten', name: 'Gartengerät', price: 33, value: 29 },
    { id: 'ticket', name: 'Jahresticket', price: 60, value: 88 },
    { id: 'kuchen', name: 'Kuchen', price: 8, value: 9 },
    { id: 'laptop', name: 'Laptop-Ständer', price: 26, value: 24 },
  ];

  const spendMoney = {
    id: 'spend',
    init(state, opts, rnd) {
      const budget = opts.budget || 100;
      const shop = shuffle(rnd, SPEND_POOL).slice(0, opts.shopSize || 10);
      state.data = {
        shop,
        budget: [budget, budget],
        basket: [[], []],
        passes: 0,
      };
      state.turn = 0;
    },
    moves(state, player) {
      if (state.over || state.turn !== player) return [];
      const out = [{ pass: true }];
      state.data.shop.forEach((item) => {
        if (!state.data.basket[0].some((b) => b.id === item.id) &&
            !state.data.basket[1].some((b) => b.id === item.id) &&
            item.price <= state.data.budget[player]) {
          out.push({ buy: item.id });
        }
      });
      return out;
    },
    apply(state, move) {
      const me = state.turn;
      if (move && move.pass) {
        state.data.passes += 1;
        if (state.data.passes >= 2) {
          state.over = true;
          const value = (index) => state.data.basket[index].reduce((sum, item) => sum + item.value, 0);
          const va = value(0);
          const vb = value(1);
          if (va !== vb) state.winner = va > vb ? 'p0' : 'p1';
          else if (state.data.budget[0] !== state.data.budget[1]) {
            state.winner = state.data.budget[0] > state.data.budget[1] ? 'p0' : 'p1';
          } else state.winner = 'draw';
        } else {
          state.turn = 1 - me;
        }
        return;
      }
      const id = move && move.buy;
      const item = state.data.shop.find((entry) => entry.id === id);
      assert(item, 'Artikel gibt es nicht.', 'NO_ITEM');
      const taken = state.data.basket[0].some((b) => b.id === id) || state.data.basket[1].some((b) => b.id === id);
      assert(!taken, 'Artikel ist schon weg.', 'ITEM_GONE');
      assert(item.price <= state.data.budget[me], 'Dafür reicht das Geld nicht.', 'NO_MONEY');
      state.data.basket[me].push(clone(item));
      state.data.budget[me] -= item.price;
      state.data.passes = 0;
      const soldOut = state.data.shop.every((entry) =>
        state.data.basket[0].some((b) => b.id === entry.id) || state.data.basket[1].some((b) => b.id === entry.id));
      if (soldOut) {
        state.over = true;
        const value = (index) => state.data.basket[index].reduce((sum, item2) => sum + item2.value, 0);
        const va = value(0);
        const vb = value(1);
        state.winner = va > vb ? 'p0' : vb > va ? 'p1' : 'draw';
      } else {
        state.turn = 1 - me;
      }
    },
    view(state) {
      return clone(state);
    },
    label(state) {
      if (state.over) {
        return state.winner === 'draw' ? 'Unentschieden' : `${state.players[state.winner === 'p0' ? 0 : 1]} hat am besten eingekauft`;
      }
      return `${state.players[state.turn]} gibt aus (${state.data.budget[state.turn]} € übrig)`;
    },
    ai(state, player) {
      const legal = this.moves(state, player).filter((m) => m.buy);
      if (!legal.length) return { pass: true };
      const byRatio = legal
        .map((m) => state.data.shop.find((i) => i.id === m.buy))
        .sort((a, b) => (b.value - b.price) - (a.value - a.price));
      const best = byRatio[0];
      if (best.value - best.price <= 0 && state.data.budget[player] < 40) return { pass: true };
      return { buy: best.id };
    },
  };

  /* ======================================================================
     Engine
     ====================================================================== */

  const GAMES = {
    tictactoe: ticTacToe,
    connect4,
    rps: rockPaperScissors,
    memory,
    battleship,
    tankwars: tankWars,
    questions: twentyQuestions,
    spend: spendMoney,
  };

  const META = {
    tictactoe: { id: 'tictactoe', name: 'Tic Tac Toe', icon: '⭕', players: 2, solo: true, desc: 'Drei in einer Reihe.' },
    connect4: { id: 'connect4', name: 'Vier Gewinnt', icon: '🔴', players: 2, solo: true, desc: 'Vier Steine in einer Linie.' },
    rps: { id: 'rps', name: 'Schere Stein Papier', icon: '✊', players: 2, solo: true, desc: 'Best of 5, gleichzeitig.' },
    memory: { id: 'memory', name: 'Memory', icon: '🃏', players: 2, solo: true, desc: 'Paare finden.' },
    battleship: { id: 'battleship', name: 'Schiffe versenken', icon: '🚢', players: 2, solo: true, desc: '10×10, Flotte [4,3,3,2].' },
    tankwars: { id: 'tankwars', name: 'Tank Wars', icon: '🛡️', players: 2, solo: true, desc: 'Rundenbasierte Panzer-Duelle.' },
    questions: { id: 'questions', name: '20 Fragen', icon: '❓', players: 2, solo: true, desc: 'Zahl erraten, 20 Versuche.' },
    spend: { id: 'spend', name: 'Geld ausgeben', icon: '💶', players: 2, solo: true, desc: 'Budget clever anlegen.' },
  };

  function engine(id) {
    const game = GAMES[id];
    assert(game, `Unbekanntes Spiel: ${id}`, 'UNKNOWN_GAME');
    return game;
  }

  function normalizeSeed(seed) {
    if (seed === undefined || seed === null || seed === '') return 'nexus';
    return String(seed);
  }

  /** Neues Spiel. Gleicher Seed + gleiche Spieler → identischer Zustand. */
  function create(id, options) {
    const opts = options || {};
    const game = engine(id);
    const players = (opts.players && opts.players.length ? opts.players : ['Spieler 1', 'Spieler 2']).slice(0, 2);
    while (players.length < 2) players.push(`Gast ${players.length + 1}`);
    const seed = normalizeSeed(opts.seed);
    const state = {
      id,
      seed,
      players,
      opts: opts.opts || {},
      log: [],
      turn: 0,
      over: false,
      winner: null,
      data: {},
      created: opts.created || 0,
    };
    game.init(state, state.opts, rng(`${seed}|init|${id}`));
    return state;
  }

  /** Einen Zug anwenden – liefert einen neuen Zustand. */
  function apply(state, move) {
    const game = engine(state.id);
    assert(!state.over, 'Die Partie ist vorbei.', 'GAME_OVER');
    const player = state.turn;
    const legal = game.moves(state, player);
    const ok = legal.some((entry) => sameMove(entry, move));
    assert(ok, 'Zug ist nicht erlaubt.', 'ILLEGAL_MOVE');
    const next = clone(state);
    game.apply(next, move);
    next.log.push({ p: player, m: move });
    return next;
  }

  function sameMove(a, b) {
    if (!a || !b) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
    }
    return true;
  }

  /** Zustand aus Seed + Zugliste neu aufbauen (das macht der Empfänger). */
  function replay(id, options, log) {
    let state = create(id, options);
    (log || []).forEach((entry) => {
      state = apply(state, entry.m === undefined ? entry : entry.m);
    });
    return state;
  }

  function legalMoves(state, player) {
    const game = engine(state.id);
    const who = player === undefined ? state.turn : player;
    return game.moves(state, who);
  }

  /** Deterministischer KI-Zug für Solo-Partien. */
  function aiMove(state, player) {
    const game = engine(state.id);
    const who = player === undefined ? state.turn : player;
    const move = game.ai(state, who, rng(`${state.seed}|ai|${state.log.length}`));
    assert(move, 'KI findet keinen Zug.', 'NO_AI_MOVE');
    const legal = game.moves(state, who);
    assert(legal.some((entry) => sameMove(entry, move)), 'KI-Zug ist ungültig.', 'BAD_AI_MOVE');
    return move;
  }

  /** Spielstand aus Sicht eines Spielers (versteckt fremde Informationen). */
  function view(state, player) {
    const game = engine(state.id);
    const who = player === undefined ? state.turn : player;
    return game.view(state, who);
  }

  function status(state) {
    const game = engine(state.id);
    return {
      over: !!state.over,
      winner: state.winner || null,
      winnerName: state.winner && state.winner !== 'draw' ? state.players[state.winner === 'p0' ? 0 : 1] : null,
      draw: state.winner === 'draw',
      turn: state.turn,
      label: game.label(state),
    };
  }

  /** Stabiler Fingerabdruck – damit beide Clients denselben Stand prüfen können. */
  function fingerprint(state) {
    const parts = [state.id, state.seed, state.turn, state.over ? 1 : 0, state.winner || '-'];
    parts.push(state.log.map((entry) => `${entry.p}${JSON.stringify(entry.m)}`).join('|'));
    let h = 2166136261 >>> 0;
    const text = parts.join('#');
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  /* ------------------------------------------------------- Warteschlange --- */

  /**
   * Raum-Warteschlange: Der erste Spieler legt die Partie fest, der zweite
   * Einstieg startet die Partie automatisch.
   */
  function queueCreate(options) {
    const opts = options || {};
    return {
      game: opts.game || 'tictactoe',
      room: opts.room || 'lobby',
      seed: normalizeSeed(opts.seed),
      players: [],
      solo: !!opts.solo,
      created: opts.created || 0,
    };
  }

  function queueJoin(queue, player, options) {
    const opts = options || {};
    assert(queue && queue.game, 'Warteschlange fehlt.', 'NO_QUEUE');
    const name = String(player || '').trim();
    assert(name, 'Spielername fehlt.', 'NO_PLAYER');
    const next = clone(queue);
    if (opts.solo) next.solo = true;
    if (!next.players.includes(name)) next.players.push(name);
    engine(next.game); // validiert das Spiel
    const needed = next.solo ? 1 : META[next.game].players;
    if (next.players.length >= needed) {
      const match = create(next.game, {
        seed: next.seed,
        players: next.players.slice(0, 2),
        opts: next.opts,
        created: next.created,
      });
      return { queue: next, started: match };
    }
    return { queue: next, started: null };
  }

  function queueLeave(queue, player) {
    const next = clone(queue);
    next.players = next.players.filter((p) => p !== player);
    return next;
  }

  /* ------------------------------------------------------------- Export --- */

  return {
    VERSION,
    GAMES: Object.keys(GAMES),
    META,
    Error: GameError,
    rng,
    hashSeed,
    list: () => Object.keys(GAMES).map((id) => clone(META[id])),
    meta: (id) => clone(META[id]),
    create,
    apply,
    replay,
    legalMoves,
    aiMove,
    view,
    status,
    fingerprint,
    sameMove,
    queueCreate,
    queueJoin,
    queueLeave,
    clone,
    SHAPES,
    SHAPE_DE,
    BS_SIZE,
    BS_FLEET,
    C4_COLS,
    C4_ROWS,
    TW_SIZE,
    TW_HP,
    Q_MAX,
    SPEND_POOL,
    MEMORY_SYMBOLS,
  };
});
