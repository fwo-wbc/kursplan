// P90 - Ressource holen
// Seitenweiser Abruf (Paginierung ueber limit[start]/limit[reply]),
// Normalisierung, Hash-Bildung und Erzeugung der parametrisierten UPSERT-Abfrage.
// Tabellen-/Spaltennamen stammen ausschliesslich aus der festen Konfiguration.
//
// Zusaetzlich werden die abgeleiteten Tabellen (date_leader, booking_position,
// booking_transaction) aus den Listenressourcen befuellt (O-8: ohne
// Buchungs-Detailendpunkt). Die Ableitungs-CTEs haengen an derselben
// SQL-Anweisung wie das Haupt-UPSERT.

const auth = $('P90 Token holen').first().json;
const token = typeof auth.data === 'string' ? auth.data : auth.access_token;
const edid = auth.edid ?? auth?.data?.edid;
if (!token || !edid) {
  throw new Error('P90: Token oder edid nicht gefunden. Felder: ' + Object.keys(auth).join(', '));
}

const meta = $('P90 Konfiguration aufloesen').first().json;
const k = meta.konfig;
const runId = meta.run_id;
const loeschungen = meta.loeschungen;

const headers = {
  edid,
  'grant-type': 'access_token',
  Authorization: 'Bearer ' + token,
  'Content-Type': 'application/json',
};

const basis = 'https://app1.edoobox.com/v2';

// ---- 10-Wochen-Fenster (operatives Zeitfenster) ----
// date_from = NOW() - 28 Tage (00:00:00), date_to = NOW() + 42 Tage (23:59:59).
// Nur edo_dates besitzt eine fenster-Konfiguration; alle uebrigen Ressourcen
// (inkl. edo_offers) laufen unveraendert als Vollabgleich.
const fenster = k.fenster || null;
let dateFromMs = null;
let dateToMs = null;
let dateFromSql = null;
let dateToSql = null;
if (fenster) {
  const jetzt = new Date();
  const von = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() - fenster.tageVergangenheit, 0, 0, 0);
  const bis = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + fenster.tageZukunft, 23, 59, 59);
  const p = (n) => String(n).padStart(2, '0');
  const fmt = (d) => d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  dateFromMs = von.getTime();
  dateToMs = bis.getTime();
  dateFromSql = fmt(von);
  dateToSql = fmt(bis);
}

// ---- Normalisierungs-Helfer (vgl. Schritt 16/26/54) ----
function kennung(w) {
  if (w === null || w === undefined || w === '') return null;
  if (typeof w === 'string' || typeof w === 'number') return String(w);
  if (typeof w === 'object') return w.id ? String(w.id) : null;
  return null;
}
function text(w) {
  if (w === null || w === undefined) return null;
  if (typeof w === 'string') return w;
  if (typeof w === 'number' || typeof w === 'boolean') return String(w);
  return null;
}
function ganzzahl(w) {
  const n = Number(w);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function kommazahl(w) {
  if (w === null || w === undefined || w === '') return null;
  const n = Number(String(w).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function zeitpunkt(w) {
  if (typeof w !== 'string') return null;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(w)) return null;
  if (/^0{4}-0{2}-0{2}/.test(w)) return null;
  return w;
}
function wahr(w) {
  if (w === true || w === 1 || w === '1' || w === 'true') return true;
  if (w === false || w === 0 || w === '0' || w === 'false' || w === '' || w === null || w === undefined) return false;
  return Boolean(w);
}
function rechnungsstatus(w) {
  const n = Number(w);
  return ({ 1: 'offen', 2: 'bezahlt', 3: 'storniert' })[n] ?? null;
}
function waehrung(w) {
  const t = text(w);
  if (!t) return 'EUR';
  return t.toUpperCase().slice(0, 3);
}

function transformiere(typ, w) {
  switch (typ) {
    case 'kennung': return kennung(w);
    case 'text': return text(w);
    case 'ganzzahl': return ganzzahl(w);
    case 'kommazahl': return kommazahl(w);
    case 'zeitpunkt': return zeitpunkt(w);
    case 'wahr': return wahr(w);
    case 'rechnungsstatus': return rechnungsstatus(w);
    case 'waehrung': return waehrung(w);
    default: return text(w);
  }
}

// ---- Paginierung ----
// Optionaler Filter (10-Wochen-Fenster): Nur Datensaetze, die der Filter
// behaelt, landen in "alle". Der Versatz und die Abbruchbedingungen beziehen
// sich weiterhin auf die ungefilterte API-Seite. Bei gefiltertem Abruf ist
// der Vollstaendigkeitsnachweis (gemeldet = gelesen) nicht beurteilbar und
// entfaellt.
async function holeAlle(pfad, reply, filter) {
  const alle = [];
  let start = 0;
  let total = null;
  let abrufe = 0;
  let ersteIdVorher = null;
  const hoechstzahlSeiten = 500; // Schutz gegen Endlosschleifen

  for (let seite = 1; seite <= hoechstzahlSeiten; seite += 1) {
    const a = await this.helpers.httpRequest({
      method: 'GET',
      url: basis + pfad,
      headers,
      qs: { 'limit[start]': start, 'limit[reply]': reply },
      json: true,
      returnFullResponse: true,
      timeout: 120000,
      ignoreHttpStatusErrors: true,
    });
    abrufe += 1;

    if (!(a.statusCode >= 200 && a.statusCode < 300)) {
      throw new Error('P90: ' + pfad + ' lieferte HTTP ' + a.statusCode + ' ab Versatz ' + start);
    }

    const body = a.body;
    const limit = body && body.limit ? body.limit : {};
    if (total === null && limit.total !== undefined && limit.total !== null) {
      total = Number(limit.total);
    }

    const roh = body ? body.data : undefined;
    const eintraege = Array.isArray(roh)
      ? roh
      : (roh && typeof roh === 'object' ? Object.values(roh) : []);

    if (eintraege.length === 0) break;

    // Schutz gegen nicht angenommenen Versatz: wiederholt sich die erste Kennung
    // einer Folgeseite, wird abgebrochen (kein Endlosschleifen, E-31f).
    const ersteId = eintraege[0] && typeof eintraege[0] === 'object' ? String(eintraege[0].id ?? '') : '';
    if (seite > 1 && ersteId !== '' && ersteId === ersteIdVorher) {
      throw new Error('P90: ' + pfad + ' nimmt Versatz ab ' + start + ' nicht an (gleiche erste Kennung ' + ersteId + ')');
    }
    ersteIdVorher = ersteId;

    const behalten = filter ? eintraege.filter(filter) : eintraege;
    alle.push(...behalten);
    start += eintraege.length;

    if (eintraege.length < reply || (total !== null && start >= total)) break;
  }

  // Vollstaendigkeitsnachweis: gemeldet = gelesen (E-31f).
  if (!filter && total !== null && alle.length !== total) {
    throw new Error('P90: ' + pfad + ' meldet ' + total + ' Datensaetze, gelesen ' + alle.length);
  }

  return { alle, total, abrufe };
}

// ---- Fenster-Filter fuer den Abruf ----
// Nur edo_dates filtert auf date_start im 10-Wochen-Fenster. edo_offers
// laeuft als Vollabgleich (Option 3): immer holeAlle, keine offer_ids-Begrenzung.
let fensterFilter = null;
let offerIds = null;
if (fenster && k.kennung === 'edo_dates') {
  fensterFilter = (satz) => {
    const t = Date.parse(satz.date_start ?? '');
    return !Number.isNaN(t) && t >= dateFromMs && t <= dateToMs;
  };
}

const seitenGroesse = Math.min(k.seitengroesse || 2000, 2000);
const holeErgebnis = await holeAlle(k.endpunkt, seitenGroesse, fensterFilter);
const alleSaetze = holeErgebnis.alle;
const gemeldetTotal = holeErgebnis.total;
const anzahlAbrufe = holeErgebnis.abrufe;

// ---- Eindeutige offer_ids aus den Terminen im Fenster sammeln ----
// Der Aufrufer (P90-Hauptworkflow) uebergibt diese Liste an den edo_offers-Lauf.
if (k.kennung === 'edo_dates' && fenster) {
  const gesehen = new Set();
  const ids = [];
  for (const s of alleSaetze) {
    const oid = s.offer;
    if (oid !== null && oid !== undefined && oid !== '') {
      const schluessel = String(oid);
      if (!gesehen.has(schluessel)) {
        gesehen.add(schluessel);
        ids.push(schluessel);
      }
    }
  }
  offerIds = ids;
}

// ---- Normalisierung ----
function normalisiere(satz) {
  const s = satz && typeof satz === 'object' ? satz : {};
  const out = {};
  for (const spN of k.spalten) out[spN.ziel] = transformiere(spN.typ, s[spN.quelle]);
  for (const zN of (k.zusatzSpalten || [])) out[zN.name] = transformiere(zN.typ, s[zN.quelle]);
  if (k.payload) out.payload = s;
  // O-8: booking/list liefert keinen status-Wert, sondern canceled (bool)
  // und waiting_list (bool). Fachstatus ableiten, damit die Erloessichten
  // (status='gebucht'/'storniert'/'warteliste') korrekt filtern koennen.
  if (k.kennung === 'edo_bookings') {
    out.status = s.waiting_list === true ? 'warteliste'
               : (s.canceled === true ? 'storniert' : 'gebucht');
  }
  // Rohfelder fuer abgeleitete Tabellen (jsonb im eingang-CTE behalten):
  for (const abN of (k.ableitungen || [])) {
    if (abN.eingangFeld && abN.quelleRoht) out[abN.eingangFeld] = s[abN.quelleRoht] ?? null;
  }
  return out;
}

const saetze = alleSaetze.map(normalisiere);
const datenJson = JSON.stringify(saetze);

// ---- UPSERT-Abfrage generieren ----
function quotIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

const tabelleQualifiziert = quotIdent(k.schema) + '.' + quotIdent(k.zieltabelle);
const pk = k.pk;
const pkQualifiziert = quotIdent(pk);

const recordset = [];
for (const spR of k.spalten) recordset.push(quotIdent(spR.ziel) + ' ' + (spR.sqlTyp || 'text'));
for (const zR of (k.zusatzSpalten || [])) recordset.push(quotIdent(zR.name) + ' ' + (zR.sqlTyp || 'text'));
if (k.payload) recordset.push(quotIdent('payload') + ' jsonb');
for (const abR of (k.ableitungen || [])) {
  if (abR.eingangFeld) recordset.push(quotIdent(abR.eingangFeld) + ' jsonb');
}
const recordsetDef = recordset.join(', ');

const insertSpalten = [];
const insertWerte = [];
for (const spI of k.spalten) {
  insertSpalten.push(quotIdent(spI.ziel));
  insertWerte.push('e.' + quotIdent(spI.ziel));
}
if (k.payload) {
  insertSpalten.push(quotIdent('payload'));
  insertWerte.push('e.' + quotIdent('payload'));
}
if (k.userRef) {
  insertSpalten.push(quotIdent(k.userRef.ziel));
  insertWerte.push('e.' + quotIdent(k.userRef.ziel));
}
if (k.source) {
  insertSpalten.push(quotIdent('source'));
  insertWerte.push("'" + String(k.source).replace(/'/g, "''") + "'");
}

function hashExpr(alias, felder) {
  const teile = felder.map((f) => alias + '.' + quotIdent(f) + '::text');
  return "md5(concat_ws('|', " + teile.join(', ') + '))';
}

// Dollar-Tag so waehlen, dass es nicht im datenJson vorkommt.
let tag = '$p90' + Math.random().toString(36).slice(2, 10) + '$';
while (datenJson.includes(tag)) tag = '$p90' + Math.random().toString(36).slice(2, 10) + '$';
const jsonLiteral = tag + datenJson + tag + '::jsonb';

// Zusaetzlich berechnete Felder im eingang-CTE.
const userRefSelect = k.userRef
  ? ', CASE WHEN t.' + quotIdent(k.userRef.quelle) + ' IS NULL THEN NULL ELSE md5(t.' + quotIdent(k.userRef.quelle) + ') END AS ' + quotIdent(k.userRef.ziel)
  : '';

// Spalten fuer DO UPDATE SET (alle Nicht-PK-Zielspalten + payload + user_ref + source).
const updateSet = [];
for (const spU of k.spalten) {
  if (spU.ziel === pk) continue;
  updateSet.push(quotIdent(spU.ziel) + ' = EXCLUDED.' + quotIdent(spU.ziel));
}
if (k.payload) updateSet.push(quotIdent('payload') + ' = EXCLUDED.' + quotIdent('payload'));
if (k.userRef) updateSet.push(quotIdent(k.userRef.ziel) + ' = EXCLUDED.' + quotIdent(k.userRef.ziel));
if (k.source) updateSet.push(quotIdent('source') + ' = EXCLUDED.' + quotIdent('source'));

let sql = '';

if (k.hash) {
  // Variante mit gespeichertem payload_hash und last_changed_at.
  const hashEingang = hashExpr('t', k.hashFelder);
  const buchInsert = insertSpalten.concat([
    quotIdent('first_seen_at'), quotIdent('last_synced_at'),
    quotIdent('last_changed_at'), quotIdent('payload_hash'), quotIdent('is_deleted'),
  ]).join(', ');
  const buchWerte = insertWerte.concat([
    'now()', 'now()', 'now()', 'e.' + quotIdent('payload_hash'), 'false',
  ]).join(', ');

  sql =
    'WITH eingang AS (\n    SELECT t.*, ' + hashEingang + ' AS ' + quotIdent('payload_hash') + userRefSelect +
    '\n    FROM jsonb_to_recordset(' + jsonLiteral + ') AS t(' + recordsetDef + ')\n),\n' +
    'kennzahlen AS (\n    SELECT\n        count(*) AS zeilen,\n' +
    '        count(*) FILTER (WHERE o.' + pkQualifiziert + ' IS NULL) AS neu,\n' +
    '        count(*) FILTER (WHERE o.' + pkQualifiziert + ' IS NOT NULL AND o.' + quotIdent('payload_hash') + ' IS DISTINCT FROM e.' + quotIdent('payload_hash') + ') AS geaendert\n' +
    '    FROM eingang e\n    LEFT JOIN ' + tabelleQualifiziert + ' o ON o.' + pkQualifiziert + ' = e.' + pkQualifiziert + '\n),\n' +
    'geschrieben AS (\n    INSERT INTO ' + tabelleQualifiziert + ' AS o (' + buchInsert + ')\n' +
    '    SELECT ' + buchWerte + '\n    FROM eingang e\n' +
    '    ON CONFLICT (' + pkQualifiziert + ') DO UPDATE SET\n        ' + updateSet.join(',\n        ') + ',\n' +
    '        ' + quotIdent('last_synced_at') + ' = now(),\n' +
    '        ' + quotIdent('is_deleted') + ' = false,\n' +
    '        ' + quotIdent('last_changed_at') + ' = CASE WHEN o.' + quotIdent('payload_hash') + ' IS DISTINCT FROM EXCLUDED.' + quotIdent('payload_hash') + ' THEN now() ELSE o.' + quotIdent('last_changed_at') + ' END,\n' +
    '        ' + quotIdent('payload_hash') + ' = EXCLUDED.' + quotIdent('payload_hash') + '\n' +
    '    RETURNING o.' + pkQualifiziert + '\n)';
} else {
  // Variante ohne gespeicherten Hash (offer_date, trainer_admin, Referenzdaten):
  // "geaendert" wird ueber einen On-the-fly-Hashvergleich der bestehenden Zeile bestimmt.
  const hashO = hashExpr('o', k.hashFelder);
  const hashE = hashExpr('e', k.hashFelder);
  const buchInsert = insertSpalten.concat([
    quotIdent('first_seen_at'), quotIdent('last_synced_at'), quotIdent('is_deleted'),
  ]).join(', ');
  const buchWerte = insertWerte.concat(['now()', 'now()', 'false']).join(', ');

  sql =
    'WITH eingang AS (\n    SELECT t.*' + userRefSelect +
    '\n    FROM jsonb_to_recordset(' + jsonLiteral + ') AS t(' + recordsetDef + ')\n),\n' +
    'kennzahlen AS (\n    SELECT\n        count(*) AS zeilen,\n' +
    '        count(*) FILTER (WHERE o.' + pkQualifiziert + ' IS NULL) AS neu,\n' +
    '        count(*) FILTER (WHERE o.' + pkQualifiziert + ' IS NOT NULL AND ' + hashO + ' IS DISTINCT FROM ' + hashE + ') AS geaendert\n' +
    '    FROM eingang e\n    LEFT JOIN ' + tabelleQualifiziert + ' o ON o.' + pkQualifiziert + ' = e.' + pkQualifiziert + '\n),\n' +
    'geschrieben AS (\n    INSERT INTO ' + tabelleQualifiziert + ' AS o (' + buchInsert + ')\n' +
    '    SELECT ' + buchWerte + '\n    FROM eingang e\n' +
    '    ON CONFLICT (' + pkQualifiziert + ') DO UPDATE SET\n        ' + updateSet.join(',\n        ') + ',\n' +
    '        ' + quotIdent('last_synced_at') + ' = now(),\n' +
    '        ' + quotIdent('is_deleted') + ' = false\n' +
    '    RETURNING o.' + pkQualifiziert + '\n)';
}

// Loesch-Markierung nur im Vollabgleich. Bei aktivem 10-Wochen-Fenster wird
// die Pruefung auf Datensaetze im Fenster begrenzt (loeschWhere aus der festen
// Konfiguration); Datensaetze ausserhalb des Fensters bleiben unangetastet
// (is_deleted bleibt unveraendert).
if (loeschungen) {
  let fensterBedingung = '';
  if (fenster && fenster.loeschWhere) {
    fensterBedingung = '\n      AND ' + fenster.loeschWhere
      .replace('$date_from', "'" + dateFromSql + "'")
      .replace('$date_to', "'" + dateToSql + "'");
  }
  sql +=
    ',\nfehlend AS (\n    UPDATE ' + tabelleQualifiziert + '\n' +
    '    SET ' + quotIdent('is_deleted') + ' = true, ' + quotIdent('last_synced_at') + ' = now()\n' +
    '    WHERE ' + quotIdent('is_deleted') + ' = false\n' +
    '      AND ' + pkQualifiziert + ' NOT IN (SELECT ' + pkQualifiziert + ' FROM eingang)' +
    fensterBedingung + '\n' +
    '    RETURNING ' + pkQualifiziert + '\n)';
}

// ---- Abgeleitete Tabellen (date_leader, booking_position, booking_transaction) ----
// Die CTE-Bloecke werden an dieselbe SQL-Anweisung angehaengt und laufen
// damit transaktional zusammen mit geschrieben/fehlend. Alle Tabellen- und
// Spaltennamen stammen ausschliesslich aus der festen KONFIG (E-31c, E-31j).
function ableitungsCtes() {
  let out = '';
  let i = 0;
  for (const ab of (k.ableitungen || [])) {
    i += 1;
    const ziel = quotIdent(ab.schema) + '.' + quotIdent(ab.tabelle);
    const pkListe = (ab.pkSpalten || []).map(quotIdent).join(', ');

    if (ab.typ === 'leaders') {
      // date_leader: n Trainer je Datumszeile. leaders ist ein JSON-Array aus Strings.
      out +=
        ',\nab_' + i + '_geschrieben AS (\n' +
        '    INSERT INTO ' + ziel + ' (' + quotIdent('date_id') + ', ' + quotIdent('admin_id') + ', ' + quotIdent('last_synced_at') + ')\n' +
        '    SELECT e.' + quotIdent('date_id') + ', l.admin_id, now()\n' +
        '    FROM eingang e\n' +
        '    CROSS JOIN LATERAL jsonb_array_elements_text(e.' + quotIdent(ab.eingangFeld) + ') AS l(admin_id)\n' +
        '    ON CONFLICT (' + pkListe + ') DO UPDATE SET ' + quotIdent('last_synced_at') + ' = now()\n' +
        '    RETURNING 1\n' +
        ')';
      if (loeschungen && ab.loeschungBeiVollabgleich) {
        // Bei aktivem 10-Wochen-Fenster nur Zuordnungen von Terminen im Fenster
        // loeschen (loeschFenster aus der festen Konfiguration); historische
        // Termine bleiben unangetastet.
        let fensterBedingung = '';
        if (fenster && ab.loeschFenster) {
          const lt = quotIdent(k.schema) + '.' + quotIdent(ab.loeschFenster.tabelle);
          fensterBedingung = '\n      AND ' + quotIdent(ab.loeschSchluessel) + ' IN (SELECT ' + quotIdent(ab.loeschFenster.idSpalte) + ' FROM ' + lt + ' WHERE ' + quotIdent(ab.loeschFenster.spalte) + ' BETWEEN ' + "'" + dateFromSql + "'" + ' AND ' + "'" + dateToSql + "'" + ')';
        }
        out +=
          ',\nab_' + i + '_fehlend AS (\n' +
          '    DELETE FROM ' + ziel + '\n' +
          '    WHERE ' + quotIdent(ab.loeschSchluessel) + ' NOT IN (SELECT e.' + quotIdent(ab.loeschSchluessel) + ' FROM eingang e)' +
          fensterBedingung + '\n' +
          '    RETURNING 1\n' +
          ')';
      }
    } else if (ab.typ === 'booking_position') {
      // booking_position: Gruppierung der users[]-Eintraege je Preiskategorie.
      // Name/Betrag/Waehrung stammen aus der bereits gespiegelten Preisliste
      // (edoobox_raw.pricecategory). is_default ist in der Listenressource nicht
      // enthalten und bleibt NULL (Verifikationspunkt O-8).
      const pcTabelle = 'edoobox_raw.pricecategory';
      out +=
        ',\nab_' + i + '_pos AS (\n' +
        '    SELECT e.' + quotIdent('booking_id') + ' AS booking_id,\n' +
        '           u.pricecategory AS pricecategory_id,\n' +
        '           count(*) AS quantity\n' +
        '    FROM eingang e\n' +
        '    CROSS JOIN LATERAL jsonb_to_recordset(e.' + quotIdent(ab.eingangFeld) + ') AS u(pricecategory text)\n' +
        '    WHERE u.pricecategory IS NOT NULL\n' +
        '    GROUP BY e.' + quotIdent('booking_id') + ', u.pricecategory\n' +
        '),\n' +
        'ab_' + i + '_geschrieben AS (\n' +
        '    INSERT INTO ' + ziel + ' (' +
          quotIdent('booking_id') + ', ' + quotIdent('pricecategory_id') + ', ' +
          quotIdent('pricecategory_name') + ', ' + quotIdent('amount_net') + ', ' +
          quotIdent('currency') + ', ' + quotIdent('quantity') + ', ' +
          quotIdent('is_default') + ', ' + quotIdent('last_synced_at') + ')\n' +
        '    SELECT p.booking_id, p.pricecategory_id,\n' +
        '           COALESCE(pc.name, \'(ohne Bezeichnung)\'),\n' +
        '           COALESCE(pc.amount_net, 0),\n' +
        '           COALESCE(pc.currency, \'EUR\'),\n' +
        '           p.quantity,\n' +
        '           NULL, now()\n' +
        '    FROM ab_' + i + '_pos p\n' +
        '    LEFT JOIN ' + pcTabelle + ' pc ON pc.' + quotIdent('pricecategory_id') + ' = p.pricecategory_id\n' +
        '    ON CONFLICT (' + pkListe + ') DO UPDATE SET\n' +
        '        ' + quotIdent('pricecategory_name') + ' = EXCLUDED.' + quotIdent('pricecategory_name') + ',\n' +
        '        ' + quotIdent('amount_net') + ' = EXCLUDED.' + quotIdent('amount_net') + ',\n' +
        '        ' + quotIdent('currency') + ' = EXCLUDED.' + quotIdent('currency') + ',\n' +
        '        ' + quotIdent('quantity') + ' = EXCLUDED.' + quotIdent('quantity') + ',\n' +
        '        ' + quotIdent('last_synced_at') + ' = now()\n' +
        '    RETURNING 1\n' +
        ')';
    } else if (ab.typ === 'booking_transaction') {
      // booking_transaction: buchungsbezogene Vorgaenge aus bookings.transactions[]
      // (Listenressource). Feldnamen: transaction (ID), number, amount, currency.
      // transaction_time ist in der Liste nicht enthalten und bleibt NULL.
      const txRecordset =
        quotIdent('transaction') + ' text, ' +
        quotIdent('number') + ' text, ' +
        quotIdent('amount') + ' numeric(12,2), ' +
        quotIdent('currency') + ' char(3)';
      out +=
        ',\nab_' + i + '_geschrieben AS (\n' +
        '    INSERT INTO ' + ziel + ' (' +
          quotIdent('transaction_id') + ', ' + quotIdent('booking_id') + ', ' +
          quotIdent('transaction_number') + ', ' + quotIdent('amount') + ', ' +
          quotIdent('currency') + ', ' + quotIdent('last_synced_at') + ')\n' +
        '    SELECT t.transaction, e.' + quotIdent('booking_id') + ', t.number, t.amount, t.currency, now()\n' +
        '    FROM eingang e\n' +
        '    CROSS JOIN LATERAL jsonb_to_recordset(e.' + quotIdent(ab.eingangFeld) + ') AS t(' + txRecordset + ')\n' +
        '    WHERE t.transaction IS NOT NULL\n' +
        '    ON CONFLICT (' + pkListe + ') DO UPDATE SET\n' +
        '        ' + quotIdent('booking_id') + ' = EXCLUDED.' + quotIdent('booking_id') + ',\n' +
        '        ' + quotIdent('transaction_number') + ' = EXCLUDED.' + quotIdent('transaction_number') + ',\n' +
        '        ' + quotIdent('amount') + ' = EXCLUDED.' + quotIdent('amount') + ',\n' +
        '        ' + quotIdent('currency') + ' = EXCLUDED.' + quotIdent('currency') + ',\n' +
        '        ' + quotIdent('last_synced_at') + ' = now()\n' +
        '    RETURNING 1\n' +
        ')';
      if (loeschungen && ab.loeschungBeiVollabgleich) {
        out +=
          ',\nab_' + i + '_fehlend AS (\n' +
          '    DELETE FROM ' + ziel + '\n' +
          '    WHERE ' + quotIdent(ab.loeschSchluessel) + ' NOT IN (\n' +
          '        SELECT abt.transaction FROM eingang e\n' +
          '        CROSS JOIN LATERAL jsonb_to_recordset(e.' + quotIdent(ab.eingangFeld) + ') AS abt(' + txRecordset + ')\n' +
          '        WHERE abt.transaction IS NOT NULL\n' +
          '    )\n' +
          '    RETURNING 1\n' +
          ')';
      }
    }
  }
  return out;
}

sql += ableitungsCtes();

sql +=
  '\nSELECT\n' +
  '    (SELECT zeilen FROM kennzahlen) AS gelesen,\n' +
  '    (SELECT neu FROM kennzahlen) AS neu,\n' +
  '    (SELECT geaendert FROM kennzahlen) AS geaendert,\n' +
  '    (SELECT count(*) FROM geschrieben) AS gespeichert' +
  (loeschungen ? ',\n    (SELECT count(*) FROM fehlend) AS geloescht' : '') +
  ';';

return [{
  json: {
    kennung: k.kennung,
    run_id: runId,
    endpunkt: k.endpunkt,
    zieltabelle: k.zieltabelle,
    gemeldet_total: gemeldetTotal,
    gelesen: saetze.length,
    anzahlAbrufe,
    // Bei gefiltertem Abruf (Fenster) ist die Gesamtzahl nicht beurteilbar.
    vollstaendig: fensterFilter ? null : (gemeldetTotal !== null ? saetze.length === gemeldetTotal : null),
    loeschungen,
    fenster: fenster ? { date_from: dateFromSql, date_to: dateToSql } : null,
    offer_ids: offerIds,
    upsertSql: sql,
    datenJson,
  },
}];
