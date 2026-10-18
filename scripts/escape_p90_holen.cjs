// Hilfsskript: escaped p90_node_holen.js als JSON-String fuer den jsCode-Parameter.
// - normalisiert CRLF -> LF (konsistent zum bestehenden n8n-Code)
// - schreibt den escaped String in kurze Zeilen, damit read_file ihn vollstaendig lesen kann
const fs = require('fs');
const code = fs.readFileSync('p90_node_holen.js', 'utf8').replace(/\r\n/g, '\n');
const escaped = JSON.stringify(code);
const chunks = [];
for (let i = 0; i < escaped.length; i += 100) {
  chunks.push(escaped.slice(i, i + 100));
}
fs.writeFileSync('p90_node_holen_escaped.txt', chunks.join('\n'));
console.log('OK, Laenge:', escaped.length, 'Zeilen:', chunks.length);