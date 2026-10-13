'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const dotenvCompat = require('./src/env');

dotenvCompat();

const { Store } = require('./src/store');
const { createApi } = require('./src/api');
const { attachRealtime } = require('./src/realtime');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_KEY = process.env.NEXUS_ADMIN_KEY || 'nexus-admin';

const store = new Store({ adminKey: ADMIN_KEY });
const app = express();

app.set('trust proxy', true);
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  // Live-Preview läuft über eine Proxy-Domain – CORS brauchen wir nur für die API,
  // Same-Origin-Requests aus dem Preview funktionieren so oder so.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ...store.stats(), uptime: process.uptime() });
});

app.use('/api', createApi(store));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Unbekannter Endpunkt.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server]', err);
  res.status(500).json({ error: 'Interner Serverfehler.' });
});

const server = http.createServer(app);
attachRealtime(server, store);

server.listen(PORT, HOST, () => {
  console.log(`Nexus-Chat läuft auf http://${HOST}:${PORT}`);
  console.log(`Admin-Key: ${ADMIN_KEY}`);
  if (ADMIN_KEY === 'nexus-admin') {
    console.log('Hinweis: Setze NEXUS_ADMIN_KEY, um einen eigenen Admin-Key zu verwenden.');
  }
});

module.exports = { app, server, store };
