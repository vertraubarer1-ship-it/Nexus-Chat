'use strict';

const { WebSocketServer } = require('ws');
const { publicUser, tokenFrom } = require('./api');

/**
 * Echtzeit-Layer: ein WebSocket, der alle Store-Events an verbundene Clients
 * weiterreicht und Heartbeats nutzt, um tote Verbindungen (und damit die
 * Namensreservierung) aufzuräumen.
 */

const HEARTBEAT_MS = 25000;

function attachRealtime(server, store) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Map(); // ws -> { userId }

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const user = store.getUserByToken(token);

    if (!user) {
      ws.send(JSON.stringify({ type: 'error', error: 'Ungültiger oder abgelaufener Token.' }));
      ws.close(4001, 'unauthorized');
      return;
    }

    clients.set(ws, { userId: user.id, alive: true });

    ws.send(
      JSON.stringify({
        type: 'hello',
        you: publicUser(user),
        rooms: store.listRooms(),
        users: store.listUsers(),
      })
    );

    ws.on('pong', () => {
      const entry = clients.get(ws);
      if (entry) entry.alive = true;
    });

    ws.on('message', (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (payload && payload.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', at: new Date().toISOString() }));
      }
    });

    ws.on('close', () => {
      const entry = clients.get(ws);
      clients.delete(ws);
      if (entry) store.emit({ type: 'presence', reason: 'socket-closed', userId: entry.userId });
    });
  });

  store.subscribe((event) => {
    // Presence-Events tragen die aktuelle Userliste mit, damit der Client
    // sie nicht separat nachladen muss.
    const payload = event.type === 'presence' ? { ...event, users: store.listUsers() } : event;
    const message = JSON.stringify(payload);
    for (const ws of clients.keys()) {
      if (ws.readyState === ws.OPEN) ws.send(message);
    }
  });

  const heartbeat = setInterval(() => {
    for (const [ws, entry] of clients) {
      if (!entry.alive) {
        clients.delete(ws);
        ws.terminate();
        continue;
      }
      entry.alive = false;
      try {
        ws.ping();
      } catch {
        clients.delete(ws);
      }
    }
  }, HEARTBEAT_MS);
  if (heartbeat.unref) heartbeat.unref();

  return wss;
}

module.exports = { attachRealtime };
