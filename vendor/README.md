# Lokale Bibliotheken

Kein CDN. Beides liegt hier, damit Nexus offline startet und die Seite
keine fremden Skripte nachlädt.

| Datei | Paket | Version | Lizenz |
| --- | --- | --- | --- |
| `mqtt.min.js` | [mqtt](https://github.com/mqttjs/MQTT.js) | 5.16.0 | MIT |
| `qrcode.js` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 1.5.2 | MIT |

## MQTT

Browser-Build (`mqtt.min.js`) für die Verbindung zu
`wss://broker.emqx.io:8084/mqtt`. Der Broker sieht nur Topics und
Chiffretext – Schlüssel bleiben im Browser.

## QR

`qrcode.js` kodiert Strings standardmäßig über `stringToBytesFuncs['default']`
(ein Byte pro Zeichen, `c & 0xff`). Das ist die SJIS-/Latin-1-Falle der
Bibliothek: aus „ä“ wird `0xE4` statt UTF-8 `0xC3 0xA4`.

`qr.js` setzt deshalb beim Laden **einmal** `qrcode.stringToBytes` auf die
mitgelieferte UTF-8-Funktion (`stringToBytesFuncs['UTF-8']`) und erzeugt
QR-Codes im Byte-Modus. Nicht die Datei hier anpassen – die Erzwingung
gehört in `qr.js`, damit ein Update der Bibliothek den Fehler nicht
zurückbringt.
