#!/usr/bin/env bash
# Nexus – Tests. Läuft aus jedem Verzeichnis.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node --test tests/games.test.mjs tests/qr.test.mjs tests/e2e.test.mjs
