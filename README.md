# Nexus · Freunde-Chat

Ende-zu-Ende-verschlüsselter Chat im Browser. Räume, Direktnachrichten,
acht Spiele, QR-Einladungen und eine installierbare PWA. Es gibt keinen
eigenen Backend-Server für Nachrichten: der öffentliche MQTT-Broker
transportiert nur Chiffretext.

## Start

```bash
npm install          # nur für die Tests (jsdom)
npm start            # http://0.0.0.0:8123
```

Die App selbst ist statisch. `index.html` im Browser öffnen reicht, sobald
die Dateien von einem HTTP-Server kommen (Service Worker brauchen das).
`tools/serve.mjs` bindet auf `0.0.0.0`, Port **8123**. HTML und `sw.js`
werden mit `Cache-Control: no-store` ausgeliefert.

```bash
npm test
# oder
bash tools/test.sh
```

## Anmeldung

Der Startbildschirm ist **Anmelden**. Der Link **Konto erstellen** wechselt
das Formular, und umgekehrt. Der Benutzername bleibt immer editierbar.

- Name: 3–16 Zeichen, nur `a-z`, `0-9` und `_`, Kleinbuchstaben.
- Passwort: mindestens 4 Zeichen, bei der Registrierung zweimal.
- Ein Name ist genau ein Konto. Die Registry liegt retained auf
  `nexusB2/acc/<name>` als `{h, t}`.
- `h` ist SHA-256 von `name::passwort`, auf 24 Hex-Zeichen gekürzt
  (dieselbe Funktion wie `sha()` in der App).
- Ist der Name schon mit einem anderen Hash registriert, kommt
  **„Dieser Name ist schon vergeben“**.
- Login schaut zuerst lokal in `nx_acc`, sonst in die Registry.
  Falsches Passwort und unbekannter Name werden getrennt gemeldet.
- Der Wiederherstellungs-Code bleibt nur auf dem Gerät (`nx_acc`).

Tests können `window.NEXUS_AUTH = { get, put }` setzen und brauchen dafür
keinen Broker.

## Transport und Verschlüsselung

| | |
| --- | --- |
| Broker | `wss://broker.emqx.io:8084/mqtt` |
| Namespace | `nexusB2` |
| Anwesenheit | `nexusB2/presence` |
| Räume | `nexusB2/rooms/<id>` |
| Admin | `nexusB2/admin` |
| Konten | `nexusB2/acc/<name>` retained `{h, t}` |

- Räume: Passwort → PBKDF2 → AES-GCM. Ohne Passwort leitet der Raum einen
  öffentlichen Schlüssel aus seiner ID ab; wer den Raum findet, kann mitlesen.
- Direktnachrichten: ECDH P-256, danach HKDF und AES-GCM.
- Der Broker sieht Topics und Chiffretext, keine Klartextnachrichten.

## Admin

In `index.html` steckt nur der öffentliche ECDSA-P-256-Schlüssel `ADMIN_PUB`.
Admin wird man, indem man den privaten JWK in den Einstellungen lädt.
Der private Schlüssel liegt in `admin-key.local.txt` und ist in `.gitignore` –
nicht committen. Neu erzeugen:

```bash
node tools/admin-key.mjs
```

Signierte Kommandos gehen an `nexusB2/admin` (`room_close`, `kick`, `broadcast`).
Clients prüfen die Signatur gegen `ADMIN_PUB` und ignorieren alles andere.

## Sichtschutz

Das Cover hängt **nur** an `document.hidden` (`visibilitychange`).
`window.blur` / `window.focus` werden nicht benutzt: in iframes und auf dem
iPad bleibt sonst ein schwarzes Overlay liegen und blockiert Chats und Räume.
Tippen auf das Cover schließt es (`dismissCover`). Die Hinweiszeile erscheint
nur im gerade offenen Chat und nicht bei jedem Wechsel erneut.

Raum-Passwörter fragt ein eigener Dialog ab, kein `prompt()`.
`openRoom` und `openDM` fangen Fehler und zeigen einen Toast.
`leaveChat` prüft `GX` und stürzt nicht ab, wenn `games.js` fehlt.

## Spiele

Acht Spiele in `games.js` (Version 1.0.0), rein und ohne DOM:
Tic Tac Toe, Vier Gewinnt, Schere Stein Papier, Memory, Schiffe versenken,
Tank Wars, 20 Fragen, Geld ausgeben.

Gleicher Seed, gleiche Spieler, gleiche Zugliste → gleicher Zustand.
Übers Netz gehen nur Seed und Züge. Im Raum gibt es eine Warteschlange:
der zweite Spieler startet die Partie automatisch. Jedes Spiel kann auch
solo gegen die KI laufen. Bei 20 Fragen kostet ein falscher Tipp eine Frage,
der Rater bleibt am Zug.

## QR

`qr.js` spricht die lokale Bibliothek `vendor/qrcode.js` an und erzwingt
UTF-8. Ohne das kürzt die Bibliothek jedes Zeichen auf ein Byte (SJIS-/Latin-1-Falle).
Einladungslinks legen den Raum in die Query, den Schlüssel ins Fragment.

## PWA

`manifest.json` plus Icons in `icons/`. Der Service Worker (`sw.js`) cacht
die App-Shell für offline, zeigt System-Benachrichtigungen, setzt das
App-Badge und öffnet beim Klick den betroffenen Raum.

Icons neu zeichnen: `bash tools/make-icons.sh`.

## Struktur

```
index.html          Oberfläche und Client-Logik
games.js            Spiele-Engine
qr.js               QR, UTF-8 erzwungen
sw.js               Service Worker
manifest.json       PWA
icons/              App-Icons
vendor/             mqtt.min.js, qrcode.js (kein CDN)
tools/serve.mjs     statischer Server, Port 8123
tools/test.sh       Testlauf
tests/              games, qr, e2e (jsdom)
```

Nachrichten liegen nicht auf einem eigenen Server. Nach einem Reload holt
der Client retained Raum-Metadaten und Konten wieder vom Broker; der
Nachrichtenverlauf einer Sitzung bleibt im Tab, Raum-Schlüssel zusätzlich
lokal.
