// ---------------------------------------------------------------------------
// TEMPORÄRER Test: Basis-Ermittlung + Payload-Zusammenbau für die Zeile
// "06.12.2027|09:00|wrd-serie" (Kategorie category_25ea33c5e986_4391280140).
//
// Repliziert exakt die Frontend-Logik aus syncToEdoobox():
//   - fetchBasisForCategory()  -> GET /api/edoobox/basis (hier: direkte SQL)
//   - Payload-Objekt je Kurs   -> { basis, sourceOfferId, category, number, ... }
//
// Verwendung: node app/tmp_test_wrd_payload.cjs
// ---------------------------------------------------------------------------
const path = require('path');
const pgPath = path.join(__dirname, 'node_modules', 'pg');
const { Client } = require(pgPath);

// --- Simulierte Excel-Zeile (aus Kurstransfer-MS-Office.xlsx, Blatt Terminplanung 2027) ---
const row = {
  datum: '06.12.2027',
  beginn: '09:00',
  kursCode: 'wrd-serie',
  kursname: 'Word - Seriendruck',
  kategorieId: 'category_25ea33c5e986_4391280140',
};

function pad2(n) { return String(n).padStart(2, '0'); }

function toIsoDate(datum, beginn) {
  const d = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(datum || '').trim());
  if (!d) return null;
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(beginn || '').trim());
  const hh = t ? pad2(t[1]) : '00';
  const mm = t ? t[2] : '00';
  const ss = t && t[3] ? t[3] : '00';
  return d[3] + '-' + pad2(d[2]) + '-' + pad2(d[1]) + 'T' + hh + ':' + mm + ':' + ss + '.000Z';
}

async function fetchBasisForCategory(client, categoryId) {
  const result = await client.query(
    `SELECT o.offer_id, o.offer_number, o.name
     FROM edoobox_raw.offer o
     LEFT JOIN edoobox_raw.offer_date d
            ON d.offer_id = o.offer_id
           AND (d.is_deleted IS NOT TRUE)
     WHERE o.category_ref = $1::text
       AND (o.is_deleted IS NOT TRUE)
     GROUP BY o.offer_id, o.offer_number, o.name
     ORDER BY MAX(COALESCE(d.date_start, o.date_start)) DESC NULLS LAST,
              o.offer_id DESC
     LIMIT 1`,
    [categoryId]
  );
  const r = result.rows[0];
  if (!r || !r.offer_id) throw new Error('Kein Basis-Angebot in Kategorie gefunden');
  return { offer_id: String(r.offer_id), offer_number: r.offer_number, name: r.name };
}

async function main() {
  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5433,
    database: process.env.DB_NAME || 'kursplan',
    user: process.env.DB_USER || 'kursplan_user',
    password: process.env.DB_PASSWORD || 'MeinAdmin2026',
  });
  await client.connect();
  try {
    const basis = await fetchBasisForCategory(client, row.kategorieId);
    console.log('fetchBasisForCategory(' + row.kategorieId + ') =>');
    console.log(JSON.stringify(basis, null, 2));

    const isoDate = toIsoDate(row.datum, row.beginn);
    const d = new Date(isoDate);
    const mmyy = pad2(d.getMonth() + 1) + String(d.getFullYear()).slice(-2);
    const baseNumber = String(row.kursCode).trim();
    const finalNumber = baseNumber + '-' + mmyy + '-1';

    // NEU: basis UND sourceOfferId werden gesendet (Robustheit gegen n8n-Erwartung)
    const payload = {
      basis: String(basis.offer_id).trim(),
      sourceOfferId: String(basis.offer_id).trim(),
      category: String(row.kategorieId).trim(),
      number: finalNumber,
      name: row.kursname,
      date_start: isoDate,
      kurs_key: row.datum + '|' + row.beginn + '|' + baseNumber,
      datum: row.datum,
      beginn: row.beginn,
      kursCode: baseNumber,
    };

    console.log('\nPayload für "' + payload.kurs_key + '":');
    console.log(JSON.stringify(payload, null, 2));

    // --- Verifikation ---
    const okBasis = payload.basis && payload.basis !== 'undefined' && payload.basis.startsWith('offer_');
    console.log('\nbasis korrekt befüllt:', okBasis, '->', payload.basis);
    console.log('generierte Nummer:', payload.number);

    // Kollisionsprüfung: existiert die generierte Nummer bereits in edoobox?
    const collision = await client.query(
      `SELECT offer_id, offer_number, category_ref, is_deleted
       FROM edoobox_raw.offer
       WHERE offer_number = $1`,
      [payload.number]
    );
    console.log('\nKollisionsprüfung Nummer "' + payload.number + '":');
    console.table(collision.rows);
    if (collision.rows.length > 0) {
      console.warn('WARNUNG: Nummer existiert bereits -> /copy kann mit Duplikat-Fehler abbrechen.');
    }

    if (!okBasis) process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fehler im Test:', err.message);
  process.exit(1);
});
