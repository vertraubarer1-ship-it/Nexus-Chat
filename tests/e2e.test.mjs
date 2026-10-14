import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { start } from '../tools/serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function waitFor(fn, ms = 8000) {
  const startAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let value;
      try { value = fn(); } catch (err) { value = null; }
      if (value) return resolve(value);
      if (Date.now() - startAt > ms) return reject(new Error('Zeitüberschreitung'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

test('App-Hülle: kein CDN, kein Blur-Schutz, kein prompt()', () => {
  const html = read('index.html');
  const code = stripComments(html);
  assert.match(html, /vendor\/mqtt\.min\.js/);
  assert.match(html, /vendor\/qrcode\.js/);
  assert.match(html, /wss:\/\/broker\.emqx\.io:8084\/mqtt/);
  assert.match(html, /nexusB2/);
  assert.match(html, /ADMIN_PUB/);
  const pub = JSON.parse(html.match(/const ADMIN_PUB = (\{.*?\});/)[1]);
  assert.equal(pub.kty, 'EC');
  assert.equal(pub.crv, 'P-256');
  assert.ok(pub.x && pub.y);
  assert.equal(pub.d, undefined);
  assert.doesNotMatch(html, /cdn\.|unpkg\.com|jsdelivr|cloudflare/i);
  assert.match(code, /visibilitychange/);
  assert.match(code, /function dismissCover/);
  assert.match(code, /function leaveChat/);
  assert.match(code, /typeof GX/);
  assert.doesNotMatch(code, /addEventListener\(\s*['"]blur['"]/);
  assert.doesNotMatch(code, /addEventListener\(\s*['"]focus['"]/);
  assert.doesNotMatch(code, /\bprompt\s*\(/);
  assert.match(html, /Konto erstellen/);
  assert.match(html, /id="auth-name"/);
  assert.doesNotMatch(html, /id="auth-name"[^>]*disabled/);
});

test('Service Worker, Manifest und Icons', () => {
  const sw = read('sw.js');
  assert.match(sw, /caches/);
  assert.match(sw, /showNotification/);
  assert.match(sw, /setAppBadge/);
  assert.match(sw, /notificationclick/);
  assert.match(sw, /open-room/);
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  assert.ok(manifest.shortcuts && manifest.shortcuts.length >= 1);
  for (const file of [
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon.png',
    'icons/badge-72.png',
    'icons/favicon-32.png',
    'icons/favicon.svg',
  ]) {
    const stat = fs.statSync(path.join(root, file));
    assert.ok(stat.size > 50, file);
  }
  assert.match(read('icons/favicon.svg'), /<svg/);
});

describe('Browser', { concurrency: 1, timeout: 60000 }, () => {
  let server;
  let base;
  let dom;
  const registry = new Map();

  before(async () => {
    const started = await start({ port: 0, host: '127.0.0.1', root });
    server = started.server;
    base = `http://127.0.0.1:${started.port}`;

    const htmlRes = await fetch(`${base}/index.html`);
    const swRes = await fetch(`${base}/sw.js`);
    const jsRes = await fetch(`${base}/games.js`);
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.headers.get('cache-control') || '', /no-store/);
    assert.match(swRes.headers.get('cache-control') || '', /no-store/);
    assert.doesNotMatch(jsRes.headers.get('cache-control') || '', /no-store/);
    assert.match(htmlRes.headers.get('content-type') || '', /text\/html/);

    const man = await fetch(`${base}/manifest.json`);
    assert.equal(man.status, 200);
    assert.match(man.headers.get('content-type') || '', /manifest/);
    const icon = await fetch(`${base}/icons/icon-192.png`);
    assert.equal(icon.status, 200);

    dom = await JSDOM.fromURL(`${base}/index.html`, {
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
      beforeParse(window) {
        Object.defineProperty(window, 'crypto', {
          configurable: true,
          writable: true,
          value: globalThis.crypto,
        });
        window.addEventListener('error', (event) => {
          console.error('page error:', event.message);
        });
      },
    });

    await waitFor(() => dom.window.NEXUS && dom.window.NEXUS.sha);
    // mqtt.min.js setzt beim Laden den echten Client. Für die Tests bleibt
    // der Stub – sonst versucht die Seite den öffentlichen Broker.
    dom.window.mqtt = {
      connect() {
        const client = {
          on() { return client; },
          subscribe() { return client; },
          unsubscribe() {},
          publish() { return client; },
          end() {},
          removeListener() {},
        };
        return client;
      },
    };
    dom.window.NEXUS_AUTH = {
      async get(name) {
        return registry.get(name) || null;
      },
      async put(name, record) {
        registry.set(name, record);
        return record;
      },
    };
  });

  after(async () => {
    if (dom) {
      try { dom.window.NEXUS.logout(); } catch (err) { /* egal */ }
      dom.window.close();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  function win() { return dom.window; }
  function doc() { return dom.window.document; }
  function q(id) { return doc().getElementById(id); }

  async function submitAuth() {
    q('auth-submit').click();
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  test('Start ist Anmelden, Name bleibt editierbar, Umschalten funktioniert', async () => {
    assert.equal(q('auth-title').textContent, 'Anmelden');
    assert.equal(q('auth-toggle').textContent, 'Konto erstellen');
    assert.equal(q('auth-name').disabled, false);
    assert.equal(q('auth-name').readOnly, false);
    assert.equal(q('app-view').hidden, true);

    q('auth-toggle').click();
    assert.equal(q('auth-title').textContent, 'Konto erstellen');
    assert.equal(q('auth-toggle').textContent, 'Stattdessen anmelden');
    assert.equal(q('auth-pass2-wrap').hidden, false);
    assert.equal(q('auth-name').disabled, false);

    q('auth-toggle').click();
    assert.equal(q('auth-title').textContent, 'Anmelden');
    assert.equal(q('auth-pass2-wrap').hidden, true);
  });

  test('Name und Passwort werden geprüft', async () => {
    win().NEXUS.setMode('register');
    q('auth-name').value = 'ab';
    q('auth-pass').value = 'secret';
    q('auth-pass2').value = 'secret';
    await submitAuth();
    await waitFor(() => q('auth-error').textContent.includes('3–16'));

    q('auth-name').value = 'mira';
    q('auth-pass').value = 'abc';
    q('auth-pass2').value = 'abc';
    await submitAuth();
    await waitFor(() => q('auth-error').textContent.includes('mindestens 4'));

    q('auth-pass').value = 'secret';
    q('auth-pass2').value = 'andere';
    await submitAuth();
    await waitFor(() => q('auth-error').textContent.includes('stimmen nicht'));
  });

  test('Registrierung, falsches Passwort, unbekannter Name, vergebener Name', async () => {
    const hash = await win().NEXUS.sha('mira::secret');
    assert.equal(hash.length, 24);
    assert.match(hash, /^[0-9a-f]{24}$/);

    win().NEXUS.setMode('register');
    q('auth-name').value = 'Mira';
    q('auth-pass').value = 'secret';
    q('auth-pass2').value = 'secret';
    await submitAuth();
    await waitFor(() => q('app-view').hidden === false);
    assert.equal(q('me-name').textContent, 'mira');
    assert.equal(registry.get('mira').h, hash);
    assert.deepEqual(Object.keys(registry.get('mira')).sort(), ['h', 't']);
    const stored = JSON.parse(win().localStorage.getItem('nx_acc'));
    assert.equal(stored.mira.h, hash);
    assert.ok(stored.mira.code && stored.mira.code.length >= 8);
    assert.equal(q('recovery-code').textContent, stored.mira.code);

    win().NEXUS.logout();
    await waitFor(() => q('auth-view').hidden === false);

    win().NEXUS.setMode('login');
    q('auth-name').value = 'mira';
    q('auth-pass').value = 'falsch';
    await submitAuth();
    await waitFor(() => q('auth-error').textContent.includes('Falsches Passwort'));
    assert.equal(q('app-view').hidden, true);

    q('auth-name').value = 'unbekannt';
    q('auth-pass').value = 'secret';
    await submitAuth();
    await waitFor(() => q('auth-error').textContent.includes('Unbekannter Name'));

    registry.set('otto', { h: '0123456789abcdef01234567', t: 1 });
    win().NEXUS.setMode('register');
    q('auth-name').value = 'otto';
    q('auth-pass').value = 'secret';
    q('auth-pass2').value = 'secret';
    await submitAuth();
    await waitFor(() => q('auth-error').textContent.includes('Dieser Name ist schon vergeben'));
    assert.equal(q('app-view').hidden, true);
  });

  test('Login über die Registry, wenn lokal nichts liegt', async () => {
    const hash = await win().NEXUS.sha('lene::passwort');
    registry.set('lene', { h: hash, t: 42 });
    const accounts = JSON.parse(win().localStorage.getItem('nx_acc') || '{}');
    delete accounts.lene;
    win().localStorage.setItem('nx_acc', JSON.stringify(accounts));

    win().NEXUS.setMode('login');
    q('auth-name').value = 'lene';
    q('auth-pass').value = 'passwort';
    await submitAuth();
    await waitFor(() => q('app-view').hidden === false);
    assert.equal(q('me-name').textContent, 'lene');
    const after = JSON.parse(win().localStorage.getItem('nx_acc'));
    assert.equal(after.lene.h, hash);
    assert.ok(after.lene.code);
    win().NEXUS.logout();
  });

  test('Raum öffnen, Passwort-Dialog, DM-Fehler, leaveChat ohne Absturz', async () => {
    win().NEXUS.setMode('login');
    q('auth-name').value = 'mira';
    q('auth-pass').value = 'secret';
    await submitAuth();
    await waitFor(() => q('app-view').hidden === false);

    const id = await win().NEXUS.createRoom('Lobby', '');
    const opened = await win().NEXUS.openRoom(id);
    assert.ok(opened);
    assert.equal(q('chat-title').textContent, '# Lobby');
    assert.equal(q('composer-input').disabled, false);

    const missing = await win().NEXUS.openRoom('gibt-es-nicht');
    assert.equal(missing, null);
    await waitFor(() => q('toasts').textContent.includes('nicht geöffnet'));

    win().NEXUS.state.rooms.set('geheim', { id: 'geheim', name: 'Geheim', pw: true, owner: 'mira', t: 1 });
    const pending = win().NEXUS.openRoom('geheim');
    await waitFor(() => doc().querySelector('.modal__title'));
    assert.equal(doc().querySelector('.modal__title').textContent, 'Raum-Passwort');
    assert.equal(typeof win().prompt, 'function');
    doc().querySelector('.modal__actions .btn').click();
    assert.equal(await pending, null);
    assert.equal(doc().querySelector('.modal'), null);

    const dm = await win().NEXUS.openDM('x');
    assert.equal(dm, null);
    await waitFor(() => q('toasts').textContent.includes('nicht geöffnet'));

    const dm2 = await win().NEXUS.openDM('nora');
    assert.equal(dm2, null);
    await waitFor(() => /noch nicht bekannt|nicht geöffnet/.test(q('toasts').textContent));

    assert.doesNotThrow(() => win().NEXUS.leaveChat());
    assert.equal(q('chat-title').textContent, 'Kein Chat geöffnet');
    assert.match(win().NEXUS.leaveChat.toString(), /typeof GX/);

    const savedGX = win().GX;
    try {
      win().GX = undefined;
      assert.doesNotThrow(() => win().NEXUS.leaveChat());
    } finally {
      win().GX = savedGX;
    }
  });

  test('Sichtschutz nur über das Cover, Tippen schließt es', async () => {
    if (q('app-view').hidden) {
      q('auth-name').value = 'mira';
      q('auth-pass').value = 'secret';
      await submitAuth();
      await waitFor(() => q('app-view').hidden === false);
    }
    const id = await win().NEXUS.createRoom('Wache', '');
    await win().NEXUS.openRoom(id);
    const before = q('chat-log').textContent;
    win().NEXUS.showCover();
    assert.equal(q('cover').hidden, false);
    assert.equal(q('chat-log').textContent, before);
    q('cover').click();
    assert.equal(q('cover').hidden, true);
    assert.match(q('chat-log').textContent, /Sichtschutz/);
    win().NEXUS.showCover();
    q('cover').click();
    const notes = q('chat-log').textContent.split('Sichtschutz').length - 1;
    assert.equal(notes, 1, 'Meldung wird nicht gespammt');
    win().NEXUS.logout();
  });

  test('QR im Fenster ist UTF-8, Broker und Namespace stimmen', () => {
    assert.equal(win().NEXUS.broker, 'wss://broker.emqx.io:8084/mqtt');
    assert.equal(win().NEXUS.ns, 'nexusB2');
    assert.equal(win().NEXUS.QR.ENCODING, 'UTF-8');
    assert.equal(win().NEXUS.QR.isUTF8(), true);
    assert.deepEqual(Array.from(win().NEXUS.QR.bytes('ä')), [195, 164]);
    assert.equal(win().NEXUS.GX.VERSION, '1.0.0');
    assert.equal(win().NEXUS.GX.GAMES.length, 8);
  });

  test('Solo-Partie und Warteschlange im Raum', async () => {
    q('auth-name').value = 'mira';
    q('auth-pass').value = 'secret';
    win().NEXUS.setMode('login');
    await submitAuth();
    await waitFor(() => q('app-view').hidden === false);

    const id = await win().NEXUS.createRoom('Spiele', '');
    await win().NEXUS.openRoom(id);
    win().NEXUS.joinQueue('questions', true);
    const match = win().NEXUS.state.match;
    assert.equal(match.id, 'questions');
    assert.equal(match.turn, 0);
    const secret = match.data.secret;
    const wrong = secret === 50 ? 49 : 50;
    win().NEXUS.doMove({ guess: wrong });
    assert.equal(win().NEXUS.state.match.turn, 0);
    assert.equal(win().NEXUS.state.match.data.left, 19);
    assert.equal(q('game-board').textContent.includes(String(secret)), false);

    win().NEXUS.state.match = null;
    win().NEXUS.state.solo = false;
    win().NEXUS.joinQueue('tictactoe', false);
    assert.equal(win().NEXUS.state.queue.get(id).players.includes('mira'), true);
    assert.equal(win().NEXUS.state.match, null);

    const queue = win().NEXUS.state.queue.get(id);
    const merged = win().NEXUS.GX.queueJoin(queue, 'bea');
    win().NEXUS.state.queue.set(id, merged.queue);
    const players = merged.queue.players.slice().sort();
    const started = win().NEXUS.GX.create('tictactoe', { seed: merged.queue.seed, players });
    assert.equal(started.players.includes('mira'), true);
    assert.equal(started.players.includes('bea'), true);
    win().NEXUS.logout();
  });
});
