/* ==========================================================================
   Nexus-Chat – QR-Modul
   --------------------------------------------------------------------------
   Dünn um die lokale Bibliothek vendor/qrcode.js gelegt.

   WICHTIG – UTF-8:
   qrcode-generator kodiert Strings standardmäßig über
   `stringToBytesFuncs['default']`, das jedes Zeichen auf ein Byte kürzt
   (`c & 0xff`). Aus „Nexus · Raum“ würde dann Schlangenöl, aus Umlauten
   Müll – und praktisch ist das die SJIS-/Latin-1-Falle der Bibliothek.
   Deshalb wird hier beim Laden **einmal** UTF-8 erzwungen.
   ========================================================================== */

(function (root, factory) {
  'use strict';

  let lib = null;
  if (typeof module === 'object' && module.exports) {
    try {
      // eslint-disable-next-line global-require, import/no-unresolved
      lib = require('./vendor/qrcode.js');
    } catch (err) {
      lib = null;
    }
  }
  if (!lib && root && root.qrcode) lib = root.qrcode;

  const api = factory(lib);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.QR = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (lib) {
  'use strict';

  const ENCODING = 'UTF-8';

  if (!lib) {
    return {
      ENCODING,
      available: false,
      reason: 'vendor/qrcode.js wurde nicht geladen.',
      bytes: () => { throw new Error('QR-Bibliothek fehlt.'); },
      matrix: () => { throw new Error('QR-Bibliothek fehlt.'); },
    };
  }

  /* ------------------------------------------------- UTF-8 erzwingen ----- */

  const utf8 = lib.stringToBytesFuncs && lib.stringToBytesFuncs['UTF-8'];
  if (typeof utf8 !== 'function') {
    throw new Error('vendor/qrcode.js kennt keine UTF-8-Kodierung.');
  }
  lib.stringToBytes = utf8;

  /** Eigenständige UTF-8-Kodierung – unabhängig von der Bibliothek. */
  function utf8Bytes(text) {
    const s = String(text);
    const out = [];
    for (let i = 0; i < s.length; i += 1) {
      let code = s.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
        const next = s.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          i += 1;
        }
      }
      if (code < 0x80) out.push(code);
      else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      else out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
    return out;
  }

  /**
   * Bytes, die tatsächlich in den QR-Code wandern.
   * Muss immer identisch zu `utf8Bytes()` sein – genau das prüft der Test.
   */
  function bytes(text) {
    return lib.stringToBytes(String(text));
  }

  /* -------------------------------------------------------- QR erzeugen -- */

  /**
   * @param {string} text
   * @param {{type?:number, level?:string, margin?:number}} [options]
   *        type: 0 = automatisch, 1..40 = feste Version
   *        level: 'L' | 'M' | 'Q' | 'H'
   */
  function generate(text, options) {
    const opts = options || {};
    const value = String(text === undefined || text === null ? '' : text);
    const type = Number.isInteger(opts.type) ? opts.type : 0;
    const level = ['L', 'M', 'Q', 'H'].includes(opts.level) ? opts.level : 'M';
    const qr = lib(type, level);
    qr.addData(value, 'Byte');
    qr.make();

    const size = qr.getModuleCount();
    const modules = [];
    for (let row = 0; row < size; row += 1) {
      const line = [];
      for (let col = 0; col < size; col += 1) line.push(!!qr.isDark(row, col));
      modules.push(line);
    }
    return { text: value, size, modules, level, bytes: bytes(value) };
  }

  function matrix(text, options) {
    return generate(text, options).modules;
  }

  /** Eigenes SVG – Farben und Rundung passen so zum Nexus-Theme. */
  function svg(text, options) {
    const opts = options || {};
    const data = generate(text, opts);
    const margin = Number.isInteger(opts.margin) ? opts.margin : 2;
    const cell = Number.isFinite(opts.cell) ? opts.cell : 8;
    const total = (data.size + margin * 2) * cell;
    const dark = opts.dark || '#0b1020';
    const light = opts.light || '#ffffff';
    const radius = opts.radius === undefined ? 0 : Number(opts.radius);

    const parts = [];
    for (let row = 0; row < data.size; row += 1) {
      for (let col = 0; col < data.size; col += 1) {
        if (!data.modules[row][col]) continue;
        const x = (col + margin) * cell;
        const y = (row + margin) * cell;
        parts.push(
          radius > 0
            ? `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="${radius}" />`
            : `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" />`
        );
      }
    }
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" ` +
      `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" ` +
      `aria-label="${escapeAttr(data.text)}">` +
      `<rect width="${total}" height="${total}" fill="${light}" />` +
      `<g fill="${dark}">${parts.join('')}</g></svg>`
    );
  }

  function escapeAttr(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** GIF-Data-URL direkt aus der Bibliothek (funktioniert ohne <canvas>). */
  function dataURL(text, options) {
    const opts = options || {};
    const qr = lib(Number.isInteger(opts.type) ? opts.type : 0, opts.level || 'M');
    qr.addData(String(text), 'Byte');
    qr.make();
    return qr.createDataURL(Number.isFinite(opts.cell) ? opts.cell : 6, Number.isInteger(opts.margin) ? opts.margin : 2);
  }

  function ascii(text, options) {
    const data = generate(text, options);
    return data.modules.map((row) => row.map((dark) => (dark ? '██' : '  ')).join('')).join('\n');
  }

  /**
   * Beitritts-Link für einen Raum – als QR und als kompakter String.
   * Der Raum-Schlüssel steckt im Fragment (#…), geht also nie an einen Server.
   */
  function roomInvite(info) {
    const opts = info || {};
    const params = new URLSearchParams();
    if (opts.room) params.set('room', String(opts.room));
    if (opts.name) params.set('name', String(opts.name));
    if (opts.key) params.set('key', String(opts.key));
    const base = opts.origin || (typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : '');
    const query = params.toString();
    return `${base}${query ? `?${query}` : ''}#nexus-invite`;
  }

  return {
    ENCODING,
    available: true,
    lib,
    utf8Bytes,
    bytes,
    generate,
    matrix,
    svg,
    dataURL,
    ascii,
    roomInvite,
    /** Prüft, ob die Bibliothek wirklich UTF-8 benutzt. */
    isUTF8() {
      const probe = 'ÄÖÜäöüß€🎉';
      const expected = utf8Bytes(probe);
      const actual = bytes(probe);
      if (actual.length !== expected.length) return false;
      return expected.every((byte, index) => byte === actual[index]);
    },
  };
});
