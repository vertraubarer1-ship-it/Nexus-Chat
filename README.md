# Nexus-Chat

Echtzeit-Chat im Browser: Login mit einmaligen Namen, Räume zum Öffnen und Anlegen,
Nachrichten live über WebSocket – plus ein Admin-Bereich, der per Admin-Key freigeschaltet wird.

## Schnellstart

```bash
npm install
npm start           # http://localhost:3000
```

Entwicklung mit Auto-Reload:

```bash
npm run dev
```

Der Server bindet auf `0.0.0.0` und läuft damit auch hinter einer Proxy-Domain (Live-Preview, Container).

Umgebungsvariablen (optional, z. B. in einer `.env`):

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `PORT` | `3000` | Port des HTTP-/WebSocket-Servers |
| `HOST` | `0.0.0.0` | Bind-Adresse |
| `NEXUS_ADMIN_KEY` | `nexus-admin` | Admin-Key – **in Produktion unbedingt setzen** |

## Features

### Login mit einmaligen Namen

- Anmeldung nur mit Namen, kein Passwort: `POST /api/login { name, adminKey? }`.
- Jeder Name ist **nur einmal gleichzeitig** vergeben. Ein zweiter Versuch liefert
  `409` mit `code: "NAME_TAKEN"` – case-insensitive und ohne doppelte Leerzeichen.
- Namen: 2–24 Zeichen, erlaubt sind Buchstaben (inkl. Umlaute), Zahlen, Leerzeichen, `.`, `_`, `-`.
- Der Name wird wieder freigegeben, sobald der User abgemeldet, gekickt oder inaktiv ist
  (Session-TTL: 10 Minuten ohne Aktivität, Heartbeat über den WebSocket).
- Der Token liegt im Client in `localStorage` und wird als `Authorization: Bearer …` mitgeschickt.

### Screenshot-Cover ohne Blur

Das Cover auf der Login-Seite wird **scharf und unverändert** ausgegeben – der frühere
Weichzeichner ist entfernt.

- `--cover-blur: 0px` in `public/styles.css` (einzige Stelle, an der das Cover gefiltert wird),
- `GET /api/config` meldet `cover: { src, blurPx: 0, filter: "none" }`,
- über dem Bild liegt nur ein leichter Verlauf (`.login__cover-scrim`) für die Lesbarkeit,
  keine `backdrop-filter`-Unschärfe.

### Räume & Chats öffnen

- Drei Start-Räume: *Allgemein*, *Projekte*, *Off-Topic*.
- Räume links anklicken → Verlad wird geladen, danach live aktualisiert.
- Neue Räume anlegen (Name 2–40 Zeichen, doppelte Namen → `409`).
- Nachrichten bis 2000 Zeichen, Verlauf der letzten 500 Nachrichten pro Raum im RAM.
- Ausgewählter Raum bleibt nach Reload erhalten (`localStorage`).

### Admin-Key

- Key beim Login mitgeben oder später im Chat unter **Admin-Bereich** freischalten
  (`POST /api/admin/unlock`).
- Mit Admin-Rechten:
  - Nachrichten löschen (Hover-Button „Löschen“ an jeder Nachricht),
  - Räume schließen,
  - User kicken (dadurch wird deren Name sofort wieder freigegeben).
- Ohne Admin-Rechte liefern diese Endpunkte `403`.

## API

Alle Endpunkte außer `/api/health`, `/api/config` und `/api/login` brauchen einen Token.

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/api/health` | Status, Zähler, Uptime |
| `GET` | `/api/config` | App-/Cover-Konfiguration |
| `POST` | `/api/login` | Anmelden (Name, optional Admin-Key) |
| `POST` | `/api/logout` | Abmelden, Name freigeben |
| `GET` | `/api/me` | eigener User |
| `GET` | `/api/users` | online User |
| `GET` | `/api/rooms` | Räume inkl. letzter Nachricht |
| `POST` | `/api/rooms` | Raum anlegen |
| `GET` | `/api/rooms/:id/messages` | Verlauf |
| `POST` | `/api/rooms/:id/messages` | Nachricht senden |
| `DELETE` | `/api/rooms/:id` | Raum schließen *(Admin)* |
| `DELETE` | `/api/messages/:id` | Nachricht löschen *(Admin)* |
| `POST` | `/api/admin/unlock` | Admin-Key freischalten |
| `GET` | `/api/admin/state` | User, Räume, Statistik *(Admin)* |
| `POST` | `/api/admin/kick` | User kicken *(Admin)* |

### WebSocket

`ws(s)://<host>/ws?token=<token>`

Der Server sendet `hello`, `message`, `message_deleted`, `room_created`, `room_deleted`,
`presence` (inkl. Userliste) und `kicked`. Ein ungültiger Token wird mit `error`
beantwortet und die Verbindung mit Code `4001` geschlossen.

## Struktur

```
server.js            HTTP-Server, Static-Files, WebSocket-Handshake
src/store.js         In-Memory-State: User, Sessions, Räume, Nachrichten
src/api.js           REST-Routen und Auth-Middleware
src/realtime.js      WebSocket-Broadcast + Heartbeat
src/env.js           minimaler .env-Loader
public/              index.html, app.js, styles.css, assets/cover.jpg
```

Der Zustand liegt im Speicher des Node-Prozesses – nach einem Neustart sind User,
Räume und Nachrichten zurückgesetzt (die drei Standard-Räume werden neu angelegt).
