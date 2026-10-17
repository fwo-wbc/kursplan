// ---------------------------------------------------------------------------
// Diagnose: Key-Abgleich Kurstransfer (Excel-Parsing wie im Frontend vs. DB)
// ---------------------------------------------------------------------------
const path = require('path');
const fs = require('fs');

const appRoot = path.join(__dirname, '..', 'app');
const xlsxPath = path.join(appRoot, 'node_modules', 'xlsx');
const pgPath = path.join(appRoot, 'node_modules', 'pg');

const XLSX = require(xlsxPath);
const { Client } = require(pgPath);

// --- Exakt wie im Frontend (index.html) ---
function pad2(n) { return String(n).padStart(2, "0"); }

function formatDate(value) {
  if (value instanceof Date && !isNaN(value)) {
    return pad2(value.getDate()) + "." + pad2(value.getMonth() + 1) + "." + value.getFullYear();
  }
  if (typeof value === "number" && value > 0) {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return pad2(d.d) + "." + pad2(d.m) + "." + d.y;
  }
  return value == null ? "" : String(value).trim();
}

function cellText(v) {
  if (v == null) return "";
  if (v instanceof Date) return formatDate(v);
  return String(v).trim();
}

function getRowKey(r) {
  const d = String((r && r.datum) || "").trim();
  const b = String((r && r.beginn) || "").trim();
  const k = String((r && r.kursCode) || "").trim();
  // Kein Key mit leeren Segmenten (z.B. "01.01.2027||") erzeugen.
  // Nur vollständige Keys "DD.MM.YYYY|HH:MM|kurs_code" sind abgleichsfähig.
  return d && b && k ? d + "|" + b + "|" + k : "";
}

const SHEET_DEFS = "Kurs_Definitionen";

function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const defMap = new Map();
  const defSheet = wb.Sheets[SHEET_DEFS];
  if (defSheet) {
    const defRows = XLSX.utils.sheet_to_json(defSheet, { header: 1, defval: "", blankrows: false });
    if (defRows.length > 1) {
      const h = defRows[0].map((x) => String(x).trim());
      const iCode = h.indexOf("Kurs_Code");
      const iName = h.indexOf("Kursname");
      const iKat = h.indexOf("Kategorie_ID");
      const iKatName = h.indexOf("Kategorie_Name");
      const iOffer = h.indexOf("Vorlage_Offer_ID");
      for (let r = 1; r < defRows.length; r++) {
        const code = cellText(defRows[r][iCode]);
        if (!code) continue;
        defMap.set(code, {
          kursname: cellText(defRows[r][iName]),
          kategorieId: iKat >= 0 ? cellText(defRows[r][iKat]) : "",
          kategorieName: iKatName >= 0 ? cellText(defRows[r][iKatName]) : "",
          vorlageOfferId: iOffer >= 0 ? cellText(defRows[r][iOffer]) : "",
        });
      }
    }
  }

  let termSheetName = wb.SheetNames.find(n => n !== SHEET_DEFS);
  if (!termSheetName) termSheetName = wb.SheetNames[0];
  const termSheet = wb.Sheets[termSheetName];
  if (!termSheet) throw new Error('Die Excel-Datei ist komplett leer.');

  const termRows = XLSX.utils.sheet_to_json(termSheet, { header: 1, defval: "", blankrows: false });
  const h = termRows[0].map((x) => String(x).trim());
  const iDatum = h.indexOf("Datum");
  const iBeginn = h.indexOf("Beginn");
  const iCode1 = h.indexOf("Kurs_Code");
  const iCode2 = h.indexOf("Kurs_Code_Prio2");
  const iCode3 = h.indexOf("Kurs_Code_Prio3");
  const iStatus = h.indexOf("Sync_Status");
  const iEdoId = h.indexOf("edoobox_ID");

  console.log('HEADER-ZEILE:', JSON.stringify(h));
  console.log('Spaltenindizes -> Datum:', iDatum, '| Beginn:', iBeginn, '| Kurs_Code:', iCode1, '| Prio2:', iCode2, '| Prio3:', iCode3, '| Sync_Status:', iStatus, '| edoobox_ID:', iEdoId);

  const result = [];
  let seq = 0;
  for (let r = 1; r < termRows.length; r++) {
    const row = termRows[r];
    const datum = formatDate(row[iDatum]);
    const beginn = iBeginn >= 0 ? cellText(row[iBeginn]) : "";
    const status = (iStatus >= 0 ? cellText(row[iStatus]) : "") || "Offen";
    const edooboxId = iEdoId >= 0 ? cellText(row[iEdoId]) : "";

    // Identisch zum Frontend: Ohne gültiges Datum UND gültige Uhrzeit keine Kurszeile.
    if (!datum || !beginn) continue;

    const codes = [iCode1, iCode2, iCode3].filter((i) => i >= 0).map((i) => cellText(row[i])).filter((c) => c !== "");

    for (const code of codes) {
      const def = defMap.get(code);
      result.push({
        id: "row-" + (seq++),
        datum: datum,
        beginn: beginn,
        kursCode: code,
        kursname: def ? def.kursname : "",
        status: status,
        edooboxId: edooboxId,
        vorlageOfferId: def ? def.vorlageOfferId : "",
        kategorieId: def ? def.kategorieId : "",
        kategorieName: def ? def.kategorieName : "",
        done: status.toLowerCase() === "erledigt",
      });
    }
  }
  return result;
}

async function main() {
  const file = process.argv[2] || path.join(__dirname, '..', 'app', 'public', 'Kurstransfer', 'Planungstabellen Excel', 'Kurstransfer-MS-Office.xlsx');
  const buffer = fs.readFileSync(file);
  const rows = parseWorkbook(buffer);
  console.log('Excel-Zeilen (Frontend-Parsing):', rows.length);

  // Rohwerte der ersten 5 Zeilen anzeigen (um Format-Abweichungen zu sehen)
  // WICHTIG: Hier die ERMITTELTEN Spaltenindizes (iDatum, iBeginn, iCode1) verwenden,
  // nicht feste Indizes 0/1/2 – sonst zeigt die Ausgabe fälschlich "Tag"/"KW" statt "Beginn"/"Kurs_Code".
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const termSheetName = wb.SheetNames.find(n => n !== SHEET_DEFS) || wb.SheetNames[0];
  const termRows = XLSX.utils.sheet_to_json(wb.Sheets[termSheetName], { header: 1, defval: "", blankrows: false });
  const h2 = termRows[0].map((x) => String(x).trim());
  const iDatum2 = h2.indexOf("Datum");
  const iBeginn2 = h2.indexOf("Beginn");
  const iCode2 = h2.indexOf("Kurs_Code");
  console.log('\nROH-ZELLEN (erste 5 Datenzeilen, Typ + Wert):');
  for (let r = 1; r < Math.min(6, termRows.length); r++) {
    const row = termRows[r];
    const datumCell = row[iDatum2];
    const beginnCell = iBeginn2 >= 0 ? row[iBeginn2] : undefined;
    const kursCodeCell = iCode2 >= 0 ? row[iCode2] : undefined;
    const key = getRowKey({
      datum: formatDate(datumCell),
      beginn: iBeginn2 >= 0 ? cellText(beginnCell) : "",
      kursCode: iCode2 >= 0 ? cellText(kursCodeCell) : ""
    });
    console.log(
      'Zeile', r,
      '| Datum:', JSON.stringify(datumCell), '(' + (datumCell instanceof Date ? 'Date' : typeof datumCell) + ')',
      '| Beginn:', JSON.stringify(beginnCell), '(' + (beginnCell instanceof Date ? 'Date' : typeof beginnCell) + ')',
      '| Kurs_Code:', JSON.stringify(kursCodeCell), '(' + (kursCodeCell instanceof Date ? 'Date' : typeof kursCodeCell) + ')',
      '| Key:', JSON.stringify(key)
    );
  }

  // DB-Keys laden
  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5433,
    database: process.env.DB_NAME || 'kursplan',
    user: process.env.DB_USER || 'kursplan_user',
    password: process.env.DB_PASSWORD || 'MeinAdmin2026',
  });
  await client.connect();
  const dbRes = await client.query('SELECT kurs_key, status FROM kurstransfer_status');
  await client.end();

  const dbKeys = new Map(dbRes.rows.map((r) => [r.kurs_key, r.status]));
  console.log('\nDB-Einträge:', dbRes.rows.length);
  for (const [k, s] of dbKeys) console.log('  DB:', JSON.stringify(k), '->', s);

  // Frontend-Keys erzeugen
  const feKeys = new Map();
  for (const row of rows) {
    const key = getRowKey(row);
    if (!feKeys.has(key)) feKeys.set(key, []);
    feKeys.get(key).push(row);
  }
  console.log('\nFrontend-Keys (eindeutig):', feKeys.size);

  // Vergleich: DB-Keys, die im Frontend NICHT vorkommen
  console.log('\n=== DB-Keys OHNE Frontend-Treffer (Mismatch-Kandidaten) ===');
  let mismatches = 0;
  for (const [k, s] of dbKeys) {
    if (k === 'undefined|undefined|undefined') continue; // bekannter Altmüll
    if (!feKeys.has(k)) {
      mismatches++;
      console.log('  DB-Key:', JSON.stringify(k), '->', s, '| NICHT im Frontend gefunden');
    }
  }
  if (mismatches === 0) console.log('  (keine – alle DB-Keys matchen Frontend-Keys)');

  // Umgekehrt: Frontend-Keys, die in der DB als erledigt markiert sind
  console.log('\n=== Frontend-Keys mit DB-Status erledigt (sollten grün sein) ===');
  let matched = 0;
  for (const [k, rowsArr] of feKeys) {
    const s = dbKeys.get(k);
    if (s === 'erledigt') {
      matched++;
      console.log('  MATCH:', JSON.stringify(k), '-> erledigt (', rowsArr.length, 'Zeile(n) )');
    }
  }
  console.log('  Erledigt-Matches gesamt:', matched);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FEHLER:', err.message);
    process.exit(1);
  });
