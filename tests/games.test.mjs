import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const GX = require('../games.js');

const IDS = ['tictactoe', 'connect4', 'rps', 'memory', 'battleship', 'tankwars', 'questions', 'spend'];

test('Version und acht Spiele', () => {
  assert.equal(GX.VERSION, '1.0.0');
  assert.deepEqual(GX.GAMES, IDS);
  const list = GX.list();
  assert.equal(list.length, 8);
  assert.deepEqual(list.map((g) => g.id), IDS);
  assert.equal(GX.meta('tictactoe').name, 'Tic Tac Toe');
  assert.equal(GX.meta('connect4').name, 'Vier Gewinnt');
  assert.equal(GX.meta('rps').name, 'Schere Stein Papier');
  assert.equal(GX.meta('memory').name, 'Memory');
  assert.equal(GX.meta('battleship').name, 'Schiffe versenken');
  assert.equal(GX.meta('tankwars').name, 'Tank Wars');
  assert.equal(GX.meta('questions').name, '20 Fragen');
  assert.equal(GX.meta('spend').name, 'Geld ausgeben');
});

test('gleicher Seed ergibt denselben Zustand', () => {
  for (const id of IDS) {
    const a = GX.create(id, { seed: `same-${id}`, players: ['ada', 'bea'] });
    const b = GX.create(id, { seed: `same-${id}`, players: ['ada', 'bea'] });
    assert.deepEqual(a, b, id);
    assert.equal(GX.fingerprint(a), GX.fingerprint(b), id);
  }
  const left = GX.create('memory', { seed: 'alpha', players: ['ada', 'bea'] });
  const right = GX.create('memory', { seed: 'beta', players: ['ada', 'bea'] });
  assert.notDeepEqual(left.data.cards.map((c) => c.symbol), right.data.cards.map((c) => c.symbol));
});

test('apply verändert den alten Zustand nicht', () => {
  const start = GX.create('tictactoe', { seed: 'imm', players: ['ada', 'bea'] });
  const snapshot = JSON.stringify(start);
  const next = GX.apply(start, { cell: 4 });
  assert.equal(JSON.stringify(start), snapshot);
  assert.equal(next.data.board[4], 'X');
  assert.equal(start.data.board[4], '');
  assert.notEqual(next, start);
});

test('unerlaubte Züge werfen, Replay entspricht der Zugliste', () => {
  let state = GX.create('tictactoe', { seed: 'rep', players: ['ada', 'bea'] });
  assert.throws(() => GX.apply(state, { cell: 9 }), /nicht erlaubt/);
  const moves = [{ cell: 0 }, { cell: 1 }, { cell: 4 }, { cell: 2 }, { cell: 8 }];
  for (const move of moves) state = GX.apply(state, move);
  assert.equal(state.over, true);
  assert.equal(state.winner, 'p0');
  const again = GX.replay('tictactoe', { seed: 'rep', players: ['ada', 'bea'] }, state.log);
  assert.equal(GX.fingerprint(state), GX.fingerprint(again));
  assert.deepEqual(again.data.board, state.data.board);
  assert.throws(() => GX.apply(state, { cell: 3 }), /vorbei/);
});

test('Vier Gewinnt erkennt vier in einer Reihe', () => {
  let state = GX.create('connect4', { seed: 'c4', players: ['ada', 'bea'] });
  const cols = [0, 1, 0, 1, 0, 1, 0];
  for (const col of cols) state = GX.apply(state, { col });
  assert.equal(state.over, true);
  assert.equal(state.winner, 'p0');
  assert.equal(GX.status(state).label.includes('Rot'), true);
});

test('Schere Stein Papier versteckt die Wahl der Gegenseite', () => {
  let state = GX.create('rps', { seed: 'rps', players: ['ada', 'bea'] });
  state = GX.apply(state, { shape: 'rock' });
  const hidden = GX.view(state, 1);
  assert.equal(hidden.data.pending[0], 'hidden');
  assert.equal(state.data.pending[0], 'rock');
  state = GX.apply(state, { shape: 'scissors' });
  assert.equal(state.data.scores[0], 1);
  assert.equal(state.turn, 0);
});

test('20 Fragen: falscher Tipp kostet eine Frage, Rater bleibt am Zug', () => {
  let state = GX.create('questions', { seed: 'q20', players: ['ada', 'bea'], opts: { max: 20 } });
  const secret = state.data.secret;
  assert.ok(secret >= 1 && secret <= 100);
  const wrong = secret === 1 ? 2 : 1;
  state = GX.apply(state, { guess: wrong });
  assert.equal(state.over, false);
  assert.equal(state.turn, 0, 'Rater bleibt am Zug');
  assert.equal(state.data.left, 19);
  assert.equal(state.data.asked[0].hint === 'correct', false);

  const guesser = GX.view(state, 0);
  const holder = GX.view(state, 1);
  assert.equal(guesser.data.secret, null);
  assert.equal(holder.data.secret, secret);

  state = GX.apply(state, { guess: secret });
  assert.equal(state.over, true);
  assert.equal(state.winner, 'p0');
});

test('20 Fragen: zwanzig Fehlversuche gewinnt die Gegenseite', () => {
  let state = GX.create('questions', { seed: 'q-lose', players: ['ada', 'bea'] });
  const secret = state.data.secret;
  let used = 0;
  for (let n = 1; n <= 100 && !state.over; n += 1) {
    if (n === secret) continue;
    state = GX.apply(state, { guess: n });
    used += 1;
    assert.equal(state.turn, 0);
  }
  assert.equal(used, 20);
  assert.equal(state.over, true);
  assert.equal(state.winner, 'p1');
  assert.equal(state.data.left, 0);
});

test('Schiffe versenken: gleiche Flotte, fremdes Feld bleibt verborgen', () => {
  const a = GX.create('battleship', { seed: 'fleet', players: ['ada', 'bea'] });
  const b = GX.create('battleship', { seed: 'fleet', players: ['ada', 'bea'] });
  assert.deepEqual(a.data.boards[0].grid, b.data.boards[0].grid);
  assert.deepEqual(a.data.boards[1].grid, b.data.boards[1].grid);
  const view = GX.view(a, 0);
  assert.ok(view.data.boards[1].grid.every((row) => row.every((cell) => cell === 0)));
  assert.ok(view.data.boards[0].grid.some((row) => row.some((cell) => cell > 0)));
  const shot = GX.apply(a, { x: 0, y: 0 });
  assert.ok(['hit', 'miss'].includes(shot.data.shots[1][0][0]));
});

test('Warteschlange: zweiter Spieler startet die Partie', () => {
  let queue = GX.queueCreate({ game: 'tictactoe', room: 'lobby', seed: 'queue-seed' });
  let step = GX.queueJoin(queue, 'ada');
  assert.equal(step.started, null);
  assert.deepEqual(step.queue.players, ['ada']);
  step = GX.queueJoin(step.queue, 'bea');
  assert.ok(step.started);
  assert.equal(step.started.id, 'tictactoe');
  assert.equal(step.started.seed, 'queue-seed');
  assert.deepEqual(step.started.players, ['ada', 'bea']);
  assert.equal(step.started.over, false);

  const solo = GX.queueJoin(GX.queueCreate({ game: 'memory', seed: 'solo' }), 'ada', { solo: true });
  assert.ok(solo.started);
  assert.equal(solo.started.players[0], 'ada');

  const left = GX.queueLeave(step.queue, 'ada');
  assert.deepEqual(left.players, ['bea']);
  assert.throws(() => GX.queueJoin(queue, '   '), /Spielername/);
});

test('KI-Züge sind legal und jede Partie endet', () => {
  for (const id of IDS) {
    let state = GX.create(id, { seed: `play-${id}`, players: ['ada', 'bea'] });
    const first = GX.aiMove(state, 0);
    assert.ok(GX.legalMoves(state, 0).some((move) => GX.sameMove(move, first)), `${id} KI-Zug`);
    let guard = 0;
    while (!state.over && guard < 2000) {
      state = GX.apply(state, GX.aiMove(state, state.turn));
      guard += 1;
    }
    assert.equal(state.over, true, `${id} endet nicht`);
    assert.ok(state.winner === 'p0' || state.winner === 'p1' || state.winner === 'draw', id);
    const rebuilt = GX.replay(id, { seed: `play-${id}`, players: ['ada', 'bea'] }, state.log);
    assert.equal(GX.fingerprint(rebuilt), GX.fingerprint(state), id);
  }
});

test('unbekanntes Spiel und leere Zugliste', () => {
  assert.throws(() => GX.create('chess', { seed: 'x' }), /Unbekanntes Spiel/);
  const fresh = GX.replay('spend', { seed: 'shop', players: ['ada', 'bea'] }, []);
  assert.equal(fresh.log.length, 0);
  assert.equal(fresh.data.budget[0], 100);
});
