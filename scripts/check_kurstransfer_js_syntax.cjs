// ---------------------------------------------------------------------------
// Syntax-Check des Inline-JavaScripts in app/public/Kurstransfer/index.html.
// Extrahiert den Inline-<script>-Block (ohne src) und prüft ihn via new Function.
// Verwendung: node scripts/check_kurstransfer_js_syntax.cjs
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'app', 'public', 'Kurstransfer', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// Inline-Skriptblöcke: <script> ... </script> OHNE src-Attribut.
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let match;
let gefunden = 0;

while ((match = re.exec(html)) !== null) {
  gefunden++;
  const code = match[1];
  try {
    // eslint-disable-next-line no-new-func
    new Function(code);
    console.log(`OK: Inline-Skript #${gefunden} ist syntaktisch gültig (${code.length} Zeichen).`);
  } catch (err) {
    console.error(`SYNTAXFEHLER in Inline-Skript #${gefunden}:`, err.message);
    process.exit(1);
  }
}

if (gefunden === 0) {
  console.error('Kein Inline-Skript gefunden.');
  process.exit(1);
}
console.log(`Syntax-Check erfolgreich (${gefunden} Inline-Skript(e)).`);
