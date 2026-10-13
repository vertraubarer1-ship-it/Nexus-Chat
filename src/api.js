'use strict';

const express = require('express');

/**
 * REST-API von Nexus-Chat.
 *
 * Auth: Jede Anfrage ab `/api` (außer login/config/health) braucht den Token,
 * den der Client beim Login bekommt – als `Authorization: Bearer <token>`
 * oder `x-nexus-token: <token>`.
 */

function tokenFrom(req) {
  const header = req.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return (req.get('x-nexus-token') || '').trim() || null;
}

function createApi(store) {
  const api = express.Router();

  api.use((req, _res, next) => {
    req.nexusUser = store.getUserByToken(tokenFrom(req));
    next();
  });

  function requireAuth(req, res, next) {
    if (!req.nexusUser) return res.status(401).json({ error: 'Nicht eingeloggt.' });
    next();
  }

  function requireAdmin(req, res, next) {
    if (!req.nexusUser) return res.status(401).json({ error: 'Nicht eingeloggt.' });
    if (!req.nexusUser.isAdmin) return res.status(403).json({ error: 'Admin-Key erforderlich.' });
    next();
  }

  /* ------------------------------------------------------------- Öffentlich */

  api.get('/config', (_req, res) => {
    res.json({
      app: 'Nexus-Chat',
      // Screenshot-Cover-Fix: das Cover wird scharf dargestellt, kein Weichzeichner mehr.
      cover: { src: '/assets/cover.jpg', blurPx: 0, filter: 'none' },
      adminKeyConfigured: Boolean(store.adminKey),
      nameRules: { min: 2, max: 24 },
      session: { ttlMs: 10 * 60 * 1000 },
    });
  });

  api.post('/login', (req, res) => {
    const { name, adminKey } = req.body || {};
    const result = store.login({ name, adminKey });
    if (!result.ok) {
      return res.status(result.code === 'NAME_TAKEN' ? 409 : 400).json({ error: result.error, code: result.code });
    }
    store.emit({ type: 'presence', reason: 'login', userId: result.user.id });
    res.status(201).json({ token: result.token, user: publicUser(result.user) });
  });

  api.post('/logout', requireAuth, (req, res) => {
    const user = req.nexusUser;
    store.logout(tokenFrom(req));
    store.emit({ type: 'presence', reason: 'logout', userId: user.id });
    res.json({ ok: true });
  });

  /* ------------------------------------------------------------------- Ich */

  api.get('/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.nexusUser) });
  });

  api.get('/users', requireAuth, (_req, res) => {
    res.json({ users: store.listUsers() });
  });

  api.post('/admin/unlock', requireAuth, (req, res) => {
    const result = store.unlockAdmin(req.nexusUser, (req.body || {}).adminKey);
    if (!result.ok) return res.status(403).json({ error: result.error });
    store.emit({ type: 'presence', reason: 'admin', userId: req.nexusUser.id });
    res.json({ ok: true, user: publicUser(req.nexusUser) });
  });

  /* ----------------------------------------------------------------- Räume */

  api.get('/rooms', requireAuth, (_req, res) => {
    res.json({ rooms: store.listRooms() });
  });

  api.post('/rooms', requireAuth, (req, res) => {
    const { name, topic } = req.body || {};
    const result = store.createRoom({ name, topic, createdBy: req.nexusUser.id });
    if (!result.ok) {
      return res.status(result.code === 'ROOM_EXISTS' ? 409 : 400).json({ error: result.error, code: result.code });
    }
    res.status(201).json({ room: result.room });
  });

  api.get('/rooms/:roomId/messages', requireAuth, (req, res) => {
    const messages = store.listMessages(req.params.roomId);
    if (!messages) return res.status(404).json({ error: 'Unbekannter Raum.' });
    res.json({ roomId: req.params.roomId, messages });
  });

  api.post('/rooms/:roomId/messages', requireAuth, (req, res) => {
    const result = store.addMessage({
      roomId: req.params.roomId,
      user: req.nexusUser,
      text: (req.body || {}).text,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json({ message: result.message });
  });

  api.delete('/rooms/:roomId', requireAdmin, (req, res) => {
    const result = store.deleteRoom(req.params.roomId);
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json({ ok: true });
  });

  api.delete('/messages/:messageId', requireAdmin, (req, res) => {
    const result = store.deleteMessage(req.params.messageId);
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json({ ok: true, roomId: result.roomId });
  });

  /* ----------------------------------------------------------------- Admin */

  api.get('/admin/state', requireAdmin, (_req, res) => {
    res.json({ users: store.listUsers(), rooms: store.listRooms(), stats: store.stats() });
  });

  api.post('/admin/kick', requireAdmin, (req, res) => {
    const result = store.kickUser((req.body || {}).userId);
    if (!result.ok) return res.status(404).json({ error: result.error });
    store.emit({ type: 'kicked', userId: result.user.id, name: result.user.name });
    res.json({ ok: true });
  });

  return api;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    isAdmin: Boolean(user.isAdmin),
    createdAt: user.createdAt,
  };
}

module.exports = { createApi, tokenFrom, publicUser };
