#!/usr/bin/env node
/* ==========================================================================
   Nexus-Chat – Icons erzeugen
   --------------------------------------------------------------------------
   Schreibt alle PNG-Icons plus favicon.svg. Bewusst ohne Abhängigkeiten:
   ein eigener PNG-Encoder (RGBA, 8 Bit, Filter 0, zlib aus Node) reicht
   völlig und funktioniert in jeder Node-Installation.

   Aufruf:  node tools/make-icons.mjs
   ========================================================================== */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'icons');
mkdirSync(outDir, { recursive: true });

const SS = 4; // Supersampling-Faktor

/* ------------------------------------------------------------- PNG-Kram -- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // Filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // Bit-Tiefe
  ihdr[9] = 6;  // Farbtyp: RGBA
  ihdr[10] = 0; // Kompression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // kein Interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------- Zeichnen -- */

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function createCanvas(size) {
  return {
    size,
    // RGBA, vorgemischt über Alphakanal
    data: Buffer.alloc(size * size * 4),
    put(x, y, [r, g, b], a = 1) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      const i = (y * size + x) * 4;
      const src = a;
      const dst = this.data[i + 3] / 255;
      const out = src + dst * (1 - src);
      if (out <= 0) return;
      this.data[i] = (r * src + this.data[i] * dst * (1 - src)) / out;
      this.data[i + 1] = (g * src + this.data[i + 1] * dst * (1 - src)) / out;
      this.data[i + 2] = (b * src + this.data[i + 2] * dst * (1 - src)) / out;
      this.data[i + 3] = out * 255;
    },
  };
}

function circle(cv, cx, cy, radius, color, alpha = 1) {
  const s = cv.size;
  for (let y = Math.floor((cy - radius) * s); y <= Math.ceil((cy + radius) * s); y += 1) {
    for (let x = Math.floor((cx - radius) * s); x <= Math.ceil((cx + radius) * s); x += 1) {
      const dx = (x + 0.5) / s - cx;
      const dy = (y + 0.5) / s - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const cover = Math.min(1, Math.max(0, radius - dist + 0.5 / s));
      if (cover > 0) cv.put(x, y, color, cover * alpha);
    }
  }
}

function line(cv, x1, y1, x2, y2, thickness, color) {
  const steps = Math.ceil(Math.hypot((x2 - x1) * cv.size, (y2 - y1) * cv.size) * 2) + 1;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    circle(cv, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, thickness / 2, color, 1);
  }
}

function radialGradient(cv, inner, outer) {
  const s = cv.size;
  const a = hexToRgb(inner);
  const b = hexToRgb(outer);
  for (let y = 0; y < s; y += 1) {
    for (let x = 0; x < s; x += 1) {
      const dx = (x + 0.5) / s - 0.5;
      const dy = (y + 0.5) / s - 0.5;
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 0.72);
      cv.put(x, y, [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ], 1);
    }
  }
}

/* ---------------------------------------------------------- Icons -------- */

/** Komplettes Icon: Hintergrund + Ring + Knoten. */
function drawIcon(size, { maskable = false, monochrome = false } = {}) {
  const cv = createCanvas(size * SS);
  const color = monochrome ? '#ffffff' : '#8eb4ff';
  const accent = hexToRgb(color);
  const light = hexToRgb(monochrome ? '#ffffff' : '#f4f7ff');

  if (monochrome) {
    // Badge-/Notification-Icon: transparenter Hintergrund, weiße Glyphe
  } else if (maskable) {
    radialGradient(cv, '#2a3b6e', '#10182e');
  } else {
    radialGradient(cv, '#2a3b6e', '#10182e');
    roundedRectMask(cv, 0.22);
  }

  const scale = maskable ? 0.62 : monochrome ? 0.9 : 0.72;
  const cx = 0.5;
  const cy = 0.5;
  const r = 0.30 * scale;
  const thickness = 0.085 * scale;

  const spokes = [
    { a: -Math.PI / 2, dot: 0.085 * scale },
    { a: -Math.PI / 2 + (2 * Math.PI) / 3, dot: 0.072 * scale },
    { a: -Math.PI / 2 + (4 * Math.PI) / 3, dot: 0.072 * scale },
  ];

  spokes.forEach((spoke) => {
    const sx = cx + Math.cos(spoke.a) * r;
    const sy = cy + Math.sin(spoke.a) * r;
    line(cv, cx, cy, sx, sy, 0.045 * scale, accent);
  });

  // Ring als Kranz: erst dicker Kreis, dann Innenloch mit Hintergrundfarbe
  circle(cv, cx, cy, r + thickness / 2, accent, 1);
  if (monochrome) {
    punchHole(cv, cx, cy, r - thickness / 2);
  } else {
    circle(cv, cx, cy, r - thickness / 2, maskable ? '#131c34' : '#111a30', 1);
  }

  spokes.forEach((spoke) => {
    const sx = cx + Math.cos(spoke.a) * r;
    const sy = cy + Math.sin(spoke.a) * r;
    circle(cv, sx, sy, spoke.dot, light, 1);
  });
  circle(cv, cx, cy, 0.1 * scale, accent, 1);

  return downscale(cv, size);
}

/** Transparentes Loch stanzen (für monochrome Icons). */
function punchHole(cv, cx, cy, radius) {
  const s = cv.size;
  for (let y = Math.floor((cy - radius) * s); y <= Math.ceil((cy + radius) * s); y += 1) {
    for (let x = Math.floor((cx - radius) * s); x <= Math.ceil((cx + radius) * s); x += 1) {
      const dx = (x + 0.5) / s - cx;
      const dy = (y + 0.5) / s - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const cover = Math.min(1, Math.max(0, radius - dist + 0.5 / s));
      if (cover <= 0) continue;
      const i = (y * s + x) * 4;
      cv.data[i + 3] = cv.data[i + 3] * (1 - cover);
    }
  }
}

/** Ecken wieder freistellen (für normale, abgerundete Icons). */
function roundedRectMask(cv, radius) {
  const s = cv.size;
  const r = radius * s;
  const w = s;
  for (let y = 0; y < s; y += 1) {
    for (let x = 0; x < s; x += 1) {
      const rx = Math.max(r - x, x - (w - 1 - r), 0);
      const ry = Math.max(r - y, y - (w - 1 - r), 0);
      if (rx * rx + ry * ry <= r * r) continue;
      const i = (y * s + x) * 4;
      const dist = Math.sqrt(rx * rx + ry * ry) - r;
      const cover = Math.min(1, Math.max(0, dist / (1 / 1)));
      cv.data[i + 3] = cv.data[i + 3] * (1 - Math.min(1, cover));
    }
  }
}

function downscale(cv, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * cv.size + (x * SS + sx)) * 4;
          const alpha = cv.data[i + 3] / 255;
          r += cv.data[i] * alpha;
          g += cv.data[i + 1] * alpha;
          b += cv.data[i + 2] * alpha;
          a += alpha;
        }
      }
      const n = SS * SS;
      const oa = a / n;
      const o = (y * size + x) * 4;
      out[o] = oa > 0 ? r / a : 0;
      out[o + 1] = oa > 0 ? g / a : 0;
      out[o + 2] = oa > 0 ? b / a : 0;
      out[o + 3] = oa * 255;
    }
  }
  return { width: size, height: size, data: out };
}

function writePNG(name, image) {
  const file = join(outDir, name);
  writeFileSync(file, encodePNG(image.width, image.height, image.data));
  console.log(`  ${name}  ${image.width}×${image.height}`);
}

/* ------------------------------------------------------------- favicon --- */

function faviconSVG() {
  const spokes = [
    { a: -Math.PI / 2, dot: 6.6 },
    { a: -Math.PI / 2 + (2 * Math.PI) / 3, dot: 5.6 },
    { a: -Math.PI / 2 + (4 * Math.PI) / 3, dot: 5.6 },
  ];
  const r = 17;
  const lines = spokes.map((s) => {
    const x = (32 + Math.cos(s.a) * r).toFixed(2);
    const y = (32 + Math.sin(s.a) * r).toFixed(2);
    return `<line x1="32" y1="32" x2="${x}" y2="${y}" stroke="#8eb4ff" stroke-width="2.8" stroke-linecap="round"/>`;
  }).join('');
  const dots = spokes.map((s) => {
    const x = (32 + Math.cos(s.a) * r).toFixed(2);
    const y = (32 + Math.sin(s.a) * r).toFixed(2);
    return `<circle cx="${x}" cy="${y}" r="${s.dot}" fill="#e8ecf8"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="72%">
      <stop offset="0" stop-color="#2a3b6e"/>
      <stop offset="1" stop-color="#10182e"/>
    </radialGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="url(#bg)"/>
  <circle cx="32" cy="32" r="16" fill="none" stroke="#8eb4ff" stroke-width="4.6"/>
  ${lines}
  ${dots}
  <circle cx="32" cy="32" r="5.5" fill="#8eb4ff"/>
</svg>
`;
}

/* ---------------------------------------------------------------- Run ---- */

console.log('Icons werden erzeugt …');
writePNG('icon-192.png', drawIcon(192));
writePNG('icon-512.png', drawIcon(512));
writePNG('icon-maskable-512.png', drawIcon(512, { maskable: true }));
writePNG('apple-touch-icon.png', drawIcon(180, { maskable: true }));
writePNG('badge-72.png', drawIcon(72, { monochrome: true }));
writePNG('favicon-32.png', drawIcon(32));
writeFileSync(join(outDir, 'favicon.svg'), faviconSVG());
console.log('  favicon.svg');
console.log('Fertig.');
