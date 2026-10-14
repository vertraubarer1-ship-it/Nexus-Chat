#!/usr/bin/env bash
# Nexus – PNG- und SVG-Icons neu zeichnen.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node tools/make-icons.mjs
