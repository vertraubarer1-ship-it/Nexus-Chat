#!/usr/bin/env node
/* ==========================================================================
   Nexus-Chat – Admin-Schlüsselpaar erzeugen
   --------------------------------------------------------------------------
   Erzeugt ein ECDSA-P-256-Schlüsselpaar:

     * der ÖFFENTLICHE Teil (JWK) gehört als ADMIN_PUB in index.html
     * der PRIVATE Teil wird nach admin-key.local.txt geschrieben
       (steht in .gitignore und darf NIEMALS committet werden)

   Aufruf:  node tools/admin-key.mjs [--force]
   ========================================================================== */

import { webcrypto as crypto } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keyFile = join(root, 'admin-key.local.txt');
const appFile = join(root, 'index.html');
const force = process.argv.includes('--force');

if (existsSync(keyFile) && !force) {
  console.log(`admin-key.local.txt gibt es schon. --force zum Überschreiben.`);
  process.exit(0);
}

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);

const pubJson = JSON.stringify(pub, null, 2);
const privJson = JSON.stringify(priv, null, 2);

writeFileSync(keyFile, `${privJson}\n`, { mode: 0o600 });
console.log('Privater Schlüssel -> admin-key.local.txt (NICHT committen!)');
console.log('\nÖffentlicher Schlüssel – als ADMIN_PUB in index.html eintragen:\n');
console.log(pubJson);

if (existsSync(appFile)) {
  const html = readFileSync(appFile, 'utf8');
  const next = html.replace(
    /(const ADMIN_PUB = )\{[\s\S]*?\};/,
    `$1${JSON.stringify(pub)};`
  );
  if (next !== html) {
    writeFileSync(appFile, next);
    console.log('\nADMIN_PUB in index.html wurde aktualisiert.');
  } else {
    console.log('\nHinweis: ADMIN_PUB in index.html wurde nicht automatisch ersetzt – bitte manuell eintragen.');
  }
}
