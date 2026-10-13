'use strict';

const crypto = require('crypto');

/**
 * Nexus-Chat – In-Memory Store
 *
 * Hält User, Sessions, Räume und Nachrichten. Bewusst ohne Datenbank gehalten,
 * damit die App mit `npm start` sofort läuft. Der Zustand ist prozesslokal.
 */

const SESSION_TTL_MS = 10 * 60 * 1000; // inaktive Sessions werden freigegeben
const SWEEP_INTERVAL_MS = 60 * 1000;
const MESSAGE_HISTORY_LIMIT = 500; // Nachrichten pro Raum, die im RAM bleiben
const NAME_MIN = 2;
const NAME_MAX = 24;
const NAME_PATTERN = /^[\p{L}\p{N} ._-]+$/u;

const SEED_ROOMS = [
  { name: 'Allgemein', topic: 'Der Raum für alles, was keine eigene Kategorie braucht.' },
  { name: 'Projekte', topic: 'Roadmaps, Releases und alles rund ums Shippen.' },
  { name: 'Off-Topic', topic: 'Abschweifen ist ausdrücklich erlaubt.' },
];

function cleanName(name) {
  return String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
}

function normalizeName(name) {
  return cleanName(name).toLocaleLowerCase('de-DE');
}

function validateName(raw) {
  const name = cleanName(raw);
  if (name.length < NAME_MIN) {
    return { ok: false, error: `Der Name muss mindestens ${NAME_MIN} Zeichen lang sein.` };
  }
  if (name.length > NAME_MAX) {
    return { ok: false, error: `Der Name darf höchstens ${NAME_MAX} Zeichen lang sein.` };
  }
  if (!NAME_PATTERN.test(name)) {
    return { ok: false, error: 'Erlaubt sind Buchstaben, Zahlen, Leerzeichen, Punkt, Binde- und Unterstrich.' };
  }
  return { ok: true, name };
}

function validateRoomName(raw) {
  const name = cleanName(raw);
  if (name.length < 2 || name.length > 40) {
    return { ok: false, error: 'Der Raumname muss zwischen 2 und 40 Zeichen lang sein.' };
  }
  return { ok: true, name };
}

class Store {
  constructor({ adminKey } = {}) {
    this.adminKey = adminKey || '';
    this.users = new Map(); // userId -> user
    this.sessions = new Map(); // token -> session
    this.rooms = new Map(); // roomId -> room
    this.messages = new Map(); // roomId -> message[]
    this.reservedNames = new Map(); // normalisierter Name -> userId
    this.listeners = new Set();

    for (const seed of SEED_ROOMS) this.createRoom({ name: seed.name, topic: seed.topic, system: true });

    this.sweeper = setInterval(() => this.sweepSessions(), SWEEP_INTERVAL_MS);
    if (this.sweeper.unref) this.sweeper.unref();
  }

  /* ---------------------------------------------------------------- Events */

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event) {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        console.error('[store] listener failed:', err);
      }
    }
  }

  /* ----------------------------------------------------------------- Users */

  isAdminKey(key) {
    return Boolean(this.adminKey) && typeof key === 'string' && key === this.adminKey;
  }

  isNameTaken(name) {
    return this.reservedNames.has(normalizeName(name));
  }

  login({ name, adminKey } = {}) {
    const check = validateName(name);
    if (!check.ok) return { ok: false, error: check.error };
    if (this.isNameTaken(check.name)) {
      return { ok: false, error: `Der Name „${check.name}“ ist bereits vergeben.`, code: 'NAME_TAKEN' };
    }

    const user = {
      id: crypto.randomUUID(),
      name: check.name,
      isAdmin: this.isAdminKey(adminKey),
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    this.reservedNames.set(normalizeName(user.name), user.id);

    const token = this.createSession(user.id);
    return { ok: true, user, token };
  }

  createSession(userId) {
    const token = crypto.randomBytes(24).toString('hex');
    this.sessions.set(token, {
      token,
      userId,
      createdAt: new Date().toISOString(),
      lastSeen: Date.now(),
    });
    return token;
  }

  getSession(token) {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    session.lastSeen = Date.now();
    return session;
  }

  getUserByToken(token) {
    const session = this.getSession(token);
    if (!session) return null;
    const user = this.users.get(session.userId);
    if (!user) {
      this.sessions.delete(token);
      return null;
    }
    user.lastSeen = new Date().toISOString();
    return user;
  }

  logout(token) {
    const session = this.sessions.get(token);
    if (!session) return false;
    this.sessions.delete(token);
    this.releaseUserIfOffline(session.userId);
    return true;
  }

  releaseUserIfOffline(userId) {
    for (const session of this.sessions.values()) {
      if (session.userId === userId) return false; // noch eine Session aktiv
    }
    const user = this.users.get(userId);
    if (!user) return false;
    this.users.delete(userId);
    if (this.reservedNames.get(normalizeName(user.name)) === userId) {
      this.reservedNames.delete(normalizeName(user.name));
    }
    return true;
  }

  unlockAdmin(user, key) {
    if (!this.isAdminKey(key)) return { ok: false, error: 'Falscher Admin-Key.' };
    user.isAdmin = true;
    return { ok: true };
  }

  kickUser(userId) {
    const user = this.users.get(userId);
    if (!user) return { ok: false, error: 'Unbekannter User.' };
    for (const [token, session] of [...this.sessions]) {
      if (session.userId === userId) this.sessions.delete(token);
    }
    this.releaseUserIfOffline(userId);
    return { ok: true, user };
  }

  sweepSessions() {
    const now = Date.now();
    let changed = false;
    for (const [token, session] of [...this.sessions]) {
      if (now - session.lastSeen > SESSION_TTL_MS) {
        this.sessions.delete(token);
        changed = true;
        const released = this.releaseUserIfOffline(session.userId);
        if (released) {
          this.emit({ type: 'presence', reason: 'timeout', userId: session.userId });
        }
      }
    }
    if (changed) this.emit({ type: 'presence', reason: 'sweep' });
  }

  /* ----------------------------------------------------------------- Rooms */

  createRoom({ name, topic = '', system = false, createdBy = null } = {}) {
    const check = validateRoomName(name);
    if (!check.ok) return { ok: false, error: check.error };
    for (const room of this.rooms.values()) {
      if (normalizeName(room.name) === normalizeName(check.name)) {
        return { ok: false, error: `Den Raum „${check.name}“ gibt es schon.`, code: 'ROOM_EXISTS' };
      }
    }
    const room = {
      id: crypto.randomUUID(),
      name: check.name,
      topic: cleanName(topic),
      system,
      createdBy,
      createdAt: new Date().toISOString(),
    };
    this.rooms.set(room.id, room);
    this.messages.set(room.id, []);
    this.emit({ type: 'room_created', room });
    return { ok: true, room };
  }

  deleteRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'Unbekannter Raum.' };
    this.rooms.delete(roomId);
    this.messages.delete(roomId);
    this.emit({ type: 'room_deleted', roomId });
    return { ok: true, room };
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  listRooms() {
    return [...this.rooms.values()]
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map((room) => {
        const messages = this.messages.get(room.id) || [];
        const last = messages[messages.length - 1] || null;
        return {
          id: room.id,
          name: room.name,
          topic: room.topic,
          system: room.system,
          createdAt: room.createdAt,
          messageCount: messages.length,
          lastMessage: last
            ? { id: last.id, text: last.text, userName: last.userName, createdAt: last.createdAt }
            : null,
        };
      });
  }

  /* -------------------------------------------------------------- Messages */

  addMessage({ roomId, user, text }) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'Unbekannter Raum.' };
    const body = cleanName(String(text == null ? '' : text).replace(/\s+/g, ' '));
    if (!body) return { ok: false, error: 'Die Nachricht ist leer.' };
    if (body.length > 2000) return { ok: false, error: 'Die Nachricht ist zu lang (max. 2000 Zeichen).' };

    const message = {
      id: crypto.randomUUID(),
      roomId,
      userId: user.id,
      userName: user.name,
      userIsAdmin: Boolean(user.isAdmin),
      text: body,
      createdAt: new Date().toISOString(),
    };
    const list = this.messages.get(roomId);
    list.push(message);
    if (list.length > MESSAGE_HISTORY_LIMIT) list.splice(0, list.length - MESSAGE_HISTORY_LIMIT);

    this.emit({ type: 'message', roomId, message });
    return { ok: true, message };
  }

  listMessages(roomId, limit = 200) {
    if (!this.rooms.has(roomId)) return null;
    const list = this.messages.get(roomId) || [];
    return list.slice(-limit);
  }

  deleteMessage(messageId) {
    for (const [roomId, list] of this.messages) {
      const index = list.findIndex((m) => m.id === messageId);
      if (index !== -1) {
        const [removed] = list.splice(index, 1);
        this.emit({ type: 'message_deleted', roomId, messageId });
        return { ok: true, message: removed, roomId };
      }
    }
    return { ok: false, error: 'Unbekannte Nachricht.' };
  }

  /* ------------------------------------------------------------- Snapshots */

  listUsers() {
    return [...this.users.values()].map((user) => ({
      id: user.id,
      name: user.name,
      isAdmin: Boolean(user.isAdmin),
      createdAt: user.createdAt,
      lastSeen: user.lastSeen,
      sessions: [...this.sessions.values()].filter((s) => s.userId === user.id).length,
    }));
  }

  stats() {
    let messages = 0;
    for (const list of this.messages.values()) messages += list.length;
    return {
      users: this.users.size,
      rooms: this.rooms.size,
      messages,
      sessions: this.sessions.size,
    };
  }
}

module.exports = {
  Store,
  cleanName,
  normalizeName,
  validateName,
  validateRoomName,
  SESSION_TTL_MS,
};
