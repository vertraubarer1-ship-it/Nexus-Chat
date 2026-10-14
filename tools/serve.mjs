#!/usr/bin/env node
/* ==========================================================================
   Nexus – statischer Dev-Server
   --------------------------------------------------------------------------
   Bindet auf 0.0.0.0:8123 (oder PORT/HOST). HTML und sw.js gehen mit
   Cache-Control: no-store raus, damit eine neue Version nicht im Browser
   hängen bleibt. Alles andere darf eine Stunde gecacht werden.
   ========================================================================== */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (path.basename(file) === 'manifest.json') return 'application/manifest+json; charset=utf-8';
  return MIME[ext] || 'application/octet-stream';
}

export function isNoStore(file) {
  const base = path.basename(file);
  return base.endsWith('.html') || base === 'sw.js';
}

/**
 * @param {string} [root]
 * @returns {import('node:http').Server}
 */
export function createServer(root = ROOT) {
  const base = path.resolve(root);
  return http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = path.normalize(path.join(base, pathname));
      if (file !== base && !file.startsWith(base + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('Not found');
        return;
      }
      const headers = {
        'Content-Type': contentType(file),
        'Cache-Control': isNoStore(file) ? 'no-store' : 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
      };
      if (req.method === 'HEAD') {
        res.writeHead(200, headers);
        res.end();
        return;
      }
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end('Method not allowed');
        return;
      }
      res.writeHead(200, headers);
      const stream = fs.createReadStream(file);
      stream.on('error', () => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      stream.pipe(res);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error');
    }
  });
}

export function start({ port = Number(process.env.PORT || 8123), host = process.env.HOST || '0.0.0.0', root = ROOT } = {}) {
  const server = createServer(root);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({ server, port: address && address.port, host });
    });
  });
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const port = Number(process.env.PORT || 8123);
  const host = process.env.HOST || '0.0.0.0';
  start({ port, host }).then(({ port: actual }) => {
    console.log(`Nexus läuft auf http://${host}:${actual}`);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
