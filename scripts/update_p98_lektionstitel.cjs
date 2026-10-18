// Aktualisiert den jsCode des Knotens "P98 Lektionstitel anpassen"
// in n8n/P98_Update_Trainer_Single.json (sichere Logik, kein Abschneiden von "GL"/"M1").
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'n8n', 'P98_Update_Trainer_Single.json');
const raw = fs.readFileSync(file, 'utf8');
const workflow = JSON.parse(raw);

const node = workflow.nodes.find((n) => n.name === 'P98 Lektionstitel anpassen');
if (!node) {
  console.error('FEHLER: Knoten "P98 Lektionstitel anpassen" nicht gefunden.');
  process.exit(1);
}

const neuerJsCode = `const resp = $input.first().json;
const kursData = $('P98 Kurs & Trainerdaten ermitteln').first().json;
const tokenData = $('P98 Token normalisieren').first().json;

const neuer_trainer_kuerzel = String(tokenData.neuer_trainer_kuerzel || '').trim();
const altes_trainer_kuerzel = String(tokenData.altes_trainer_kuerzel || '').trim();

// 1. Lektions-Objekt aus der edoobox-Antwort flexibel extrahieren (Array / Objekt / ID-Map)
let d = resp?.data || resp;
if (Array.isArray(d)) {
  d = d[0] || {};
} else if (d && typeof d === 'object') {
  if (!d.description && !d.title && !d.name) {
    const firstVal = Object.values(d)[0];
    if (firstVal && typeof firstVal === 'object') {
      d = firstVal;
    }
  }
}

// 2. Den bestehenden Modultitel auslesen
let currentDesc = String(d?.description || d?.title || d?.name || '').trim();

// Schutz: Falls kein bestehender Titel auffindbar ist, NIEMALS überschreiben, sondern stoppen!
if (!currentDesc) {
  throw new Error(
    \`Konnte den bestehenden Modultitel für date_id "\${kursData.date_id}" nicht auslesen. Antwort von edoobox: \${JSON.stringify(resp)}\`
  );
}

const isUnassign = neuer_trainer_kuerzel === 'n. v.' || neuer_trainer_kuerzel === '';
const warNichtVergeben = altes_trainer_kuerzel === 'n. v.' || altes_trainer_kuerzel === '';

let neuer_lektionstitel = '';

if (isUnassign) {
  // Neuer Trainer ist 'n. v.' -> bisheriges Kürzel restlos entfernen.
  // Gezielt nur das bekannte alte Kürzel entfernen (Klammer oder " Kürzel" am Ende),
  // damit niemals echte Titelbestandteile wie "GL" oder "M1" abgeschnitten werden.
  if (altes_trainer_kuerzel && !warNichtVergeben) {
    const esc = altes_trainer_kuerzel.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
    neuer_lektionstitel = currentDesc
      .replace(new RegExp(\`\\\\s*\\\\(\\\\s*\${esc}\\\\s*\\\\)\\\\s*$\`, 'i'), '')
      .replace(new RegExp(\`\\\\s+\${esc}\\\\s*$\`, 'i'), '')
      .trim();
  } else {
    // Kein altes Kürzel bekannt -> nur eine Klammer am Ende entfernen, KEINE Zeichen am Wortende.
    neuer_lektionstitel = currentDesc
      .replace(/\\s*\\(\\s*[A-Za-z0-9]{2,4}\\s*\\)\\s*$/i, '')
      .trim();
  }
} else if (warNichtVergeben) {
  // Vorher war kein Dozent zugewiesen ('n. v.' oder leer):
  // NIEMALS Zeichen am Ende abschneiden. Falls doch schon Klammern am Ende existieren,
  // nur den Klammerinhalt ersetzen, sonst einfach anhängen.
  const matchKlammer = currentDesc.match(/^(.*?)\\s*\\(\\s*[^)]*\\s*\\)\\s*$/);
  if (matchKlammer) {
    neuer_lektionstitel = matchKlammer[1].trimEnd() + ' (' + neuer_trainer_kuerzel + ')';
  } else {
    neuer_lektionstitel = currentDesc + ' (' + neuer_trainer_kuerzel + ')';
  }
} else {
  // Vorher war ein Dozent zugewiesen (z. B. 'FW'):
  // Gezielt nur "(FW)" oder " FW" am Ende durch "(neuer_trainer_kuerzel)" ersetzen.
  const matchKlammer = currentDesc.match(/^(.*?)\\s*\\(\\s*[A-Za-z0-9]{2,4}\\s*\\)\\s*$/);
  const matchEnde = currentDesc.match(/^(.*?)\\s+[A-Za-z0-9]{2,4}\\s*$/);
  if (matchKlammer) {
    neuer_lektionstitel = matchKlammer[1].trimEnd() + ' (' + neuer_trainer_kuerzel + ')';
  } else if (matchEnde) {
    neuer_lektionstitel = matchEnde[1].trimEnd() + ' (' + neuer_trainer_kuerzel + ')';
  } else {
    neuer_lektionstitel = currentDesc + ' (' + neuer_trainer_kuerzel + ')';
  }
}

return [{
  json: {
    ...kursData,
    kuerzel: neuer_trainer_kuerzel,
    is_unassign: isUnassign,
    neuer_lektionstitel
  }
}];`;

node.parameters.jsCode = neuerJsCode;

fs.writeFileSync(file, JSON.stringify(workflow, null, 2) + '\n', 'utf8');
console.log('OK: jsCode des Knotens "P98 Lektionstitel anpassen" aktualisiert.');
