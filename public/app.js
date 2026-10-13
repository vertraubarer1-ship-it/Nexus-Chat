/* ==========================================================================
   Nexus-Chat – Client
   --------------------------------------------------------------------------
   Login mit einmaligen Namen, Räume öffnen, Echtzeit-Nachrichten via
   WebSocket und ein Admin-Bereich, der per Admin-Key freigeschaltet wird.
   ========================================================================== */

'use strict';

const TOKEN_KEY = 'nexus.token';
const USER_KEY = 'nexus.user';
const ROOM_KEY = 'nexus.room';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  user: safeParse(localStorage.getItem(USER_KEY)),
  rooms: [],
  users: [],
  activeRoomId: localStorage.getItem(ROOM_KEY) || '',
  socket: null,
  reconnectDelay: 750,
  adminUnlocked: false,
};

const el = {
  loginView: document.getElementById('login-view'),
  loginForm: document.getElementById('login-form'),
  loginName: document.getElementById('login-name'),
  loginAdminKey: document.getElementById('login-admin-key'),
  loginError: document.getElementById('login-error'),
  loginSubmit: document.getElementById('login-submit'),
  loginStatus: document.getElementById('login-status'),

  chatView: document.getElementById('chat-view'),
  meName: document.getElementById('me-name'),
  meBadge: document.getElementById('me-badge'),
  roomList: document.getElementById('room-list'),
  roomForm: document.getElementById('room-form'),
  roomName: document.getElementById('room-name'),
  userList: document.getElementById('user-list'),
  userCount: document.getElementById('user-count'),
  roomTitle: document.getElementById('room-title'),
  roomTopic: document.getElementById('room-topic'),
  roomMeta: document.getElementById('room-meta'),
  messages: document.getElementById('message-list'),
  composer: document.getElementById('composer'),
  composerInput: document.getElementById('composer-input'),
  composerSend: document.getElementById('composer-send'),
  logoutBtn: document.getElementById('logout-btn'),
  connState: document.getElementById('conn-state'),

  adminPanel: document.getElementById('admin-panel'),
  adminForm: document.getElementById('admin-form'),
  adminKey: document.getElementById('admin-key'),
  adminState: document.getElementById('admin-state'),
  adminActions: document.getElementById('admin-actions'),
  adminCloseRoom: document.getElementById('admin-close-room'),

  toast: document.getElementById('toast'),
};

/* ------------------------------------------------------------- Hilfsfunktionen */

function safeParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error((data && data.error) || `Fehler ${response.status}`);
    error.status = response.status;
    error.code = data && data.code;
    throw error;
  }
  return data;
}

function showError(message) {
  el.loginError.textContent = message;
  el.loginError.hidden = !message;
}

let toastTimer = null;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 3200);
}

function initials(name) {
  const parts = String(name || '?').trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function timeLabel(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

/* -------------------------------------------------------------------- Login */

el.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  el.loginSubmit.disabled = true;

  const name = el.loginName.value.trim();
  const adminKey = el.loginAdminKey.value;

  try {
    const result = await api('/api/login', { method: 'POST', body: { name, adminKey } });
    persistSession(result.token, result.user);
    el.loginForm.reset();
    await enterChat();
  } catch (error) {
    showError(error.message);
  } finally {
    el.loginSubmit.disabled = false;
  }
});

function persistSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  state.token = '';
  state.user = null;
  state.activeRoomId = '';
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ROOM_KEY);
}

/* --------------------------------------------------------------------- Chat */

async function enterChat() {
  el.loginView.hidden = true;
  el.chatView.hidden = false;
  el.meName.textContent = state.user.name;
  el.meBadge.hidden = !state.user.isAdmin;
  el.adminKey.disabled = false;
  applyAdminUi();

  await refreshRooms();
  await refreshUsers();
  connect();

  if (!state.activeRoomId || !state.rooms.some((room) => room.id === state.activeRoomId)) {
    state.activeRoomId = state.rooms[0] ? state.rooms[0].id : '';
    localStorage.setItem(ROOM_KEY, state.activeRoomId);
  }
  selectRoom(state.activeRoomId);
}

el.logoutBtn.addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    /* Token ohnehin ungültig – trotzdem lokal aufräumen. */
  }
  if (state.socket) state.socket.close();
  clearSession();
  el.chatView.hidden = true;
  el.loginView.hidden = false;
  el.messages.innerHTML = '';
  showError('');
});

/* -------------------------------------------------------------- Räume laden */

async function refreshRooms() {
  const data = await api('/api/rooms');
  state.rooms = data.rooms;
  renderRooms();
}

function renderRooms() {
  el.roomList.innerHTML = '';
  for (const room of state.rooms) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'room' + (room.id === state.activeRoomId ? ' room--active' : '');
    button.dataset.roomId = room.id;

    const nameRow = document.createElement('div');
    nameRow.className = 'room__name';
    const name = document.createElement('span');
    name.textContent = room.name;
    const count = document.createElement('span');
    count.className = 'room__count';
    count.textContent = room.messageCount ? String(room.messageCount) : '';
    nameRow.append(name, count);

    const preview = document.createElement('div');
    preview.className = 'room__preview';
    preview.textContent = room.lastMessage
      ? `${room.lastMessage.userName}: ${room.lastMessage.text}`
      : room.topic || 'Noch keine Nachrichten';

    button.append(nameRow, preview);
    button.addEventListener('click', () => selectRoom(room.id));
    item.append(button);
    el.roomList.append(item);
  }
}

el.roomList.addEventListener('click', (event) => {
  const button = event.target.closest('.room');
  if (button) selectRoom(button.dataset.roomId);
});

async function selectRoom(roomId) {
  if (!roomId) {
    el.messages.innerHTML = '<li class="messages__empty">Kein Raum ausgewählt.</li>';
    setComposerEnabled(false);
    return;
  }
  state.activeRoomId = roomId;
  localStorage.setItem(ROOM_KEY, roomId);
  renderRooms();

  const room = state.rooms.find((item) => item.id === roomId);
  el.roomTitle.textContent = room ? room.name : 'Raum';
  el.roomTopic.textContent = room ? room.topic || 'Kein Thema hinterlegt.' : '';
  el.roomMeta.textContent = room ? `${room.messageCount} Nachrichten` : '';
  setComposerEnabled(Boolean(room));

  try {
    const data = await api(`/api/rooms/${roomId}/messages`);
    renderMessages(data.messages);
  } catch (error) {
    renderMessages([]);
    toast(error.message);
  }
}

function setComposerEnabled(enabled) {
  el.composerInput.disabled = !enabled;
  el.composerSend.disabled = !enabled;
  if (enabled) el.composerInput.focus();
}

el.roomForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = el.roomName.value.trim();
  if (!name) return;
  try {
    const result = await api('/api/rooms', { method: 'POST', body: { name } });
    el.roomForm.reset();
    state.rooms.push({
      id: result.room.id,
      name: result.room.name,
      topic: result.room.topic,
      system: false,
      messageCount: 0,
      lastMessage: null,
    });
    renderRooms();
    selectRoom(result.room.id);
    toast(`Raum „${result.room.name}“ erstellt.`);
  } catch (error) {
    toast(error.message);
  }
});

/* ----------------------------------------------------------------- Messages */

function renderMessages(messages) {
  if (!messages.length) {
    el.messages.innerHTML = '<li class="messages__empty">Noch keine Nachrichten. Schreib die erste!</li>';
    return;
  }
  el.messages.innerHTML = '';
  for (const message of messages) appendMessage(message);
  el.messages.scrollTop = el.messages.scrollHeight;
}

function appendMessage(message) {
  const empty = el.messages.querySelector('.messages__empty');
  if (empty) empty.remove();

  const item = document.createElement('li');
  item.className = 'message' + (state.user && message.userId === state.user.id ? ' message--own' : '');
  item.dataset.messageId = message.id;

  const avatar = document.createElement('div');
  avatar.className = 'message__avatar';
  avatar.textContent = initials(message.userName);

  const body = document.createElement('div');
  const head = document.createElement('div');
  head.className = 'message__head';

  const author = document.createElement('span');
  author.className = 'message__author';
  author.textContent = message.userName;

  const time = document.createElement('span');
  time.className = 'message__time';
  time.textContent = timeLabel(message.createdAt);

  head.append(author, time);

  if (message.userIsAdmin) {
    const badge = document.createElement('span');
    badge.className = 'badge badge--admin';
    badge.textContent = 'Admin';
    head.append(badge);
  }

  if (state.user && state.user.isAdmin) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'message__delete';
    del.textContent = 'Löschen';
    del.addEventListener('click', () => deleteMessage(message.id));
    head.append(del);
  }

  const text = document.createElement('p');
  text.className = 'message__text';
  text.textContent = message.text;

  body.append(head, text);
  item.append(avatar, body);
  el.messages.append(item);
  el.messages.scrollTop = el.messages.scrollHeight;
}

el.composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = el.composerInput.value.trim();
  if (!text || !state.activeRoomId) return;
  el.composerInput.value = '';
  try {
    await api(`/api/rooms/${state.activeRoomId}/messages`, { method: 'POST', body: { text } });
  } catch (error) {
    toast(error.message);
  }
});

async function deleteMessage(messageId) {
  try {
    await api(`/api/messages/${messageId}`, { method: 'DELETE' });
  } catch (error) {
    toast(error.message);
  }
}

/* ------------------------------------------------------------------- Users */

async function refreshUsers() {
  try {
    const data = await api('/api/users');
    state.users = data.users;
  } catch (error) {
    if (error.status === 401) {
      handleUnauthorized();
      return;
    }
    return;
  }
  renderUsers();
}

function renderUsers() {
  el.userList.innerHTML = '';
  el.userCount.textContent = String(state.users.length);

  for (const user of state.users) {
    const item = document.createElement('li');
    item.className = 'user';

    const avatar = document.createElement('span');
    avatar.className = 'user__avatar';
    avatar.textContent = initials(user.name);

    const name = document.createElement('span');
    name.className = 'user__name';
    name.textContent = user.name + (user.id === (state.user && state.user.id) ? ' (du)' : '');

    item.append(avatar, name);

    if (user.isAdmin) {
      const badge = document.createElement('span');
      badge.className = 'badge badge--admin';
      badge.textContent = 'Admin';
      item.append(badge);
    }

    if (state.user && state.user.isAdmin && user.id !== state.user.id) {
      const kick = document.createElement('button');
      kick.type = 'button';
      kick.className = 'user__kick';
      kick.textContent = 'Kick';
      kick.addEventListener('click', () => kickUser(user.id, user.name));
      item.append(kick);
    }

    el.userList.append(item);
  }
}

async function kickUser(userId, name) {
  try {
    await api('/api/admin/kick', { method: 'POST', body: { userId } });
    toast(`${name} wurde entfernt.`);
    await refreshUsers();
  } catch (error) {
    toast(error.message);
  }
}

/* ------------------------------------------------------------------- Admin */

el.adminForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const adminKey = el.adminKey.value;
  try {
    const result = await api('/api/admin/unlock', { method: 'POST', body: { adminKey } });
    state.user = result.user;
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    el.meBadge.hidden = !result.user.isAdmin;
    el.adminKey.value = '';
    el.adminState.textContent = 'freigeschaltet';
    el.adminState.classList.add('admin__state--open');
    el.adminActions.hidden = false;
    toast('Admin-Rechte aktiv.');
    await refreshUsers();
    if (state.activeRoomId) selectRoom(state.activeRoomId);
  } catch (error) {
    toast(error.message);
  }
});

el.adminCloseRoom.addEventListener('click', async () => {
  if (!state.activeRoomId) return;
  const room = state.rooms.find((item) => item.id === state.activeRoomId);
  if (!room || !confirm(`Raum „${room.name}“ wirklich schließen?`)) return;
  try {
    await api(`/api/rooms/${state.activeRoomId}`, { method: 'DELETE' });
    toast(`Raum „${room.name}“ geschlossen.`);
    state.activeRoomId = '';
    await refreshRooms();
    selectRoom(state.rooms[0] ? state.rooms[0].id : '');
  } catch (error) {
    toast(error.message);
  }
});

function applyAdminUi() {
  const isAdmin = Boolean(state.user && state.user.isAdmin);
  el.adminState.textContent = isAdmin ? 'freigeschaltet' : 'gesperrt';
  el.adminState.classList.toggle('admin__state--open', isAdmin);
  el.adminActions.hidden = !isAdmin;
  el.adminForm.hidden = isAdmin;
}

/* --------------------------------------------------------------- WebSocket */

function connect() {
  if (state.socket) state.socket.close();
  if (!state.token) return;

  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://${location.host}/ws?token=${encodeURIComponent(state.token)}`);
  state.socket = socket;

  socket.addEventListener('open', () => {
    state.reconnectDelay = 750;
    el.connState.textContent = 'verbunden';
    el.connState.classList.add('conn--online');
    el.connState.classList.remove('conn--offline');
  });

  socket.addEventListener('message', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    handleSocketEvent(payload);
  });

  socket.addEventListener('close', (event) => {
    el.connState.textContent = 'getrennt';
    el.connState.classList.remove('conn--online');
    el.connState.classList.add('conn--offline');
    if (event.code === 4001) {
      handleUnauthorized();
      return;
    }
    if (!el.chatView.hidden) scheduleReconnect();
  });

  socket.addEventListener('error', () => socket.close());
}

function scheduleReconnect() {
  setTimeout(() => {
    if (!el.chatView.hidden && state.token) connect();
  }, state.reconnectDelay);
  state.reconnectDelay = Math.min(state.reconnectDelay * 2, 10000);
}

function handleSocketEvent(event) {
  switch (event.type) {
    case 'hello':
      state.users = event.users;
      state.rooms = event.rooms;
      renderUsers();
      renderRooms();
      applyAdminUi();
      break;

    case 'message':
      if (event.roomId === state.activeRoomId) appendMessage(event.message);
      updateRoomPreview(event.roomId, event.message);
      break;

    case 'message_deleted': {
      const node = el.messages.querySelector(`[data-message-id="${event.messageId}"]`);
      if (node) node.remove();
      break;
    }

    case 'room_created':
      refreshRooms().catch(() => {});
      break;

    case 'room_deleted':
      if (state.activeRoomId === event.roomId) state.activeRoomId = '';
      refreshRooms()
        .then(() => {
          if (!state.activeRoomId && state.rooms[0]) selectRoom(state.rooms[0].id);
        })
        .catch(() => {});
      break;

    case 'presence':
      if (Array.isArray(event.users)) {
        state.users = event.users;
        renderUsers();
      } else {
        refreshUsers().catch(() => {});
      }
      break;

    case 'kicked':
      if (state.user && event.userId === state.user.id) {
        toast('Du wurdest vom Admin entfernt.');
        el.logoutBtn.click();
      } else {
        refreshUsers().catch(() => {});
      }
      break;

    case 'error':
      toast(event.error || 'Verbindungsfehler.');
      break;

    default:
      break;
  }
}

function updateRoomPreview(roomId, message) {
  const room = state.rooms.find((item) => item.id === roomId);
  if (!room) return;
  room.lastMessage = { id: message.id, text: message.text, userName: message.userName, createdAt: message.createdAt };
  room.messageCount += 1;
  renderRooms();
  if (roomId === state.activeRoomId) {
    const activeRoom = state.rooms.find((item) => item.id === roomId);
    el.roomMeta.textContent = `${activeRoom.messageCount} Nachrichten`;
  }
}

function handleUnauthorized() {
  clearSession();
  if (state.socket) state.socket.close();
  el.chatView.hidden = true;
  el.loginView.hidden = false;
  showError('Deine Sitzung ist abgelaufen. Melde dich bitte neu an.');
}

/* ------------------------------------------------------------------- Start */

(async function boot() {
  if (!state.token || !state.user) {
    clearSession();
    return;
  }
  try {
    const data = await api('/api/me');
    state.user = data.user;
    el.loginStatus.hidden = true;
    await enterChat();
  } catch (error) {
    if (error.status === 401) {
      clearSession();
      return;
    }
    showError('Server nicht erreichbar. Bitte kurz warten und erneut versuchen.');
  }
})();
