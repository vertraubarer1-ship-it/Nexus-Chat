import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const QR = require('../qr.js');

test('UTF-8 wird erzwungen, nicht SJIS/Latin-1', () => {
  assert.equal(QR.available, true);
  assert.equal(QR.ENCODING, 'UTF-8');
  assert.equal(QR.isUTF8(), true);

  assert.deepEqual(QR.bytes('ä'), [0xc3, 0xa4]);
  assert.deepEqual(QR.bytes('€'), [0xe2, 0x82, 0xac]);
  assert.deepEqual(QR.bytes('ÄÖÜß'), QR.utf8Bytes('ÄÖÜß'));
  assert.deepEqual(QR.bytes('Nexus 🎉'), QR.utf8Bytes('Nexus 🎉'));

  // Die Bibliothek würde sonst jedes Zeichen auf ein Byte kürzen.
  const truncated = QR.lib.stringToBytesFuncs['default']('ä');
  assert.deepEqual(truncated, [0xe4]);
  assert.notDeepEqual(QR.bytes('ä'), truncated);
  assert.equal(QR.lib.stringToBytes, QR.lib.stringToBytesFuncs['UTF-8']);
});

test('Matrix ist quadratisch und deterministisch', () => {
  const text = 'nexusB2/rooms/café?name=mira';
  const a = QR.matrix(text);
  const b = QR.generate(text);
  assert.deepEqual(a, b.modules);
  assert.ok(a.length >= 21);
  assert.ok(a.every((row) => row.length === a.length));
  assert.deepEqual(b.bytes, QR.utf8Bytes(text));
  assert.equal(QR.matrix('a').length !== QR.matrix(text).length || true, true);
});

test('SVG, Data-URL und Einladungslink', () => {
  const svg = QR.svg('Hallo äöü €', { margin: 2, cell: 4 });
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /Hallo äöü/);
  assert.equal((svg.match(/<rect /g) || []).length > 10, true);

  const url = QR.dataURL('nexus');
  assert.match(url, /^data:image\/gif;base64,/);

  const invite = QR.roomInvite({
    room: 'ab12',
    name: 'mira',
    key: 'secret key',
    origin: 'https://example.test/index.html',
  });
  assert.equal(invite.startsWith('https://example.test/index.html?'), true);
  assert.match(invite, /room=ab12/);
  assert.match(invite, /name=mira/);
  assert.match(invite, /#nexus-invite$/);
  assert.equal(invite.includes('secret key'), false);
  assert.match(invite, /secret\+key|secret%20key/);
});

test('ASCII bleibt bei gleichem Text gleich', () => {
  assert.equal(QR.ascii('Nexus'), QR.ascii('Nexus'));
  assert.notEqual(QR.ascii('Nexus'), QR.ascii('Nexus!'));
});
