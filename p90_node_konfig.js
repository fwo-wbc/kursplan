// P90 - Konfiguration aufloesen
// Prueft die Ressourcenkennung gegen die fest hinterlegte Konfigurationstabelle.
// Zielwerte (Endpunkt, Tabelle, Primaerschluessel, Seitengroesse) kommen
// ausschliesslich aus dieser festen Konfiguration, NICHT aus Aufrufer-Eingaben
// (E-31c, E-31j: keine dynamischen SQL-/Tabellennamen aus Nutzereingaben).
//
// Stand 07.09.2026: Alle zwoelf Ressourcen sind spiegelbar (O-1/O-2 entschieden).
// Kennungen vereinheitlicht: edo_vat, edo_countries.
//
// VERIFIKATIONSPUNKT: Die normalisierten Kernspalten der sieben neu ergaenzten
// Ressourcen (name, rate, code, parent, offer, amount, currency, number, time,
// user, date, status) sind gegen die echten edoobox-Antworten zu verifizieren.
// Bei personenbezugsfreien Referenzressourcen sichert payload (jsonb) die
// Verlustfreiheit, bis die Kernspalten bestaetigt sind.

const eingabe = $input.first().json;

function feld(name, fallback) {
  const w = eingabe[name];
  if (w !== undefined && w !== null && w !== '') return w;
  return fallback;
}

const kennung = feld('Ressourcenkennung', feld('ressourcenkennung', feld('kennung', feld('resource_key', null))));
const runId = feld('Laufkennung', feld('run_id', feld('runId', null)));
const loeschungenEingabe =
  eingabe['Löschungen auswerten'] !== undefined ? eingabe['Löschungen auswerten'] :
  eingabe['Loeschungen auswerten'] !== undefined ? eingabe['Loeschungen auswerten'] :
  eingabe['loeschungen_auswerten'] !== undefined ? eingabe['loeschungen_auswerten'] :
  eingabe['track_deletions'];

// ---------------------------------------------------------------------------
// Feste Konfigurationstabelle. Alle zwoelf Ressourcen.
// ---------------------------------------------------------------------------
const KONFIG = {
  edo_admins: {
    kennung: 'edo_admins',
    endpunkt: '/admin/list',
    schema: 'edoobox_raw',
    zieltabelle: 'trainer_admin',
    pk: 'admin_id',
    seitengroesse: 2000,
    loeschungen: true,
    hash: false,
    payload: false,
    spalten: [
      { ziel: 'admin_id',  quelle: 'id',         typ: 'kennung', sqlTyp: 'text' },
      { ziel: 'shortcut',  quelle: 'shortcut',   typ: 'text',    sqlTyp: 'text' },
      { ziel: 'permission', quelle: 'permission', typ: 'text',   sqlTyp: 'text' },
      { ziel: 'is_active', quelle: 'status',     typ: 'wahr',    sqlTyp: 'boolean' },
    ],
    zusatzSpalten: [],
    userRef: null,
    hashFelder: ['shortcut', 'permission', 'is_active'],
  },

  edo_dates: {
    kennung: 'edo_dates',
    endpunkt: '/date/list',
    schema: 'edoobox_raw',
    zieltabelle: 'offer_date',
    pk: 'date_id',
    seitengroesse: 2000,
    loeschungen: true,
    hash: false,
    payload: false,
    // 10-Wochen-Fenster: -28 Tage bis +42 Tage (operatives Zeitfenster).
    // date_from = NOW() - 28 Tage (00:00:00), date_to = NOW() + 42 Tage (23:59:59).
    // Der Abruf wird auf date_start im Fenster gefiltert; die Loeschpruefung
    // (fehlend-CTE) gilt ausschliesslich fuer Termine im Fenster.
    fenster: {
      tageVergangenheit: 28,
      tageZukunft: 42,
      loeschWhere: 'date_start BETWEEN $date_from AND $date_to',
    },
    spalten: [
      { ziel: 'date_id',    quelle: 'id',         typ: 'kennung', sqlTyp: 'text' },
      { ziel: 'offer_id',   quelle: 'offer',      typ: 'kennung', sqlTyp: 'text' },
      { ziel: 'date_start', quelle: 'date_start', typ: 'zeitpunkt', sqlTyp: 'timestamptz' },
      { ziel: 'date_end',   quelle: 'date_end',   typ: 'zeitpunkt', sqlTyp: 'timestamptz' },
      { ziel: 'place_ref',  quelle: 'place',      typ: 'kennung', sqlTyp: 'text' },
      { ziel: 'room_ref',   quelle: 'room',       typ: 'kennung', sqlTyp: 'text' },
    ],
    zusatzSpalten: [],
    ableitungen: [
      {
        typ: 'leaders',
        quelleRoht: 'leader',
        eingangFeld: 'leaders',
        schema: 'edoobox_raw',
        tabelle: 'date_leader',
        pkSpalten: ['date_id', 'admin_id'],
        loeschSchluessel: 'date_id',
        loeschungBeiVollabgleich: true,
        // Loeschung der date_leader nur fuer Termine im 10-Wochen-Fenster,
        // damit Trainer-Zuordnungen historischer Termine unangetastet bleiben.
        // idSpalte: Schluessel in der Zieltabelle, spalte: Fenster-Datumsfeld.
        loeschFenster: { tabelle: 'offer_date', idSpalte: 'date_id', spalte: 'date_start' },
      },
    ],
    userRef: null,
    hashFelder: ['offer_id', 'date_start', 'date_end', 'place_ref', 'room_ref'],
  },

  edo_offers: {
    kennung: 'edo_offers',
    endpunkt: '/offer/list',
    schema: 'edoobox_raw',
    zieltabelle: 'offer',
    pk: 'offer_id',
    seitengroesse: 2000,
    loeschungen: true,
    hash: true,
    payload: true,
    // Vollabgleich (Option 3): Kein Zeitfenster, kein offer_ids-Filter.
    // Abruf und Loeschpruefung gelten fuer alle Angebote.
    spalten: [
      { ziel: 'offer_id',            quelle: 'id',                 typ: 'kennung',   sqlTyp: 'text' },
      { ziel: 'offer_number',        quelle: 'number',             typ: 'text',      sqlTyp: 'text' },
      { ziel: 'name',                quelle: 'name',               typ: 'text',      sqlTyp: 'text' },
      { ziel: 'category_ref',        quelle: 'category',           typ: 'kennung',   sqlTyp: 'text' },
      { ziel: 'offerdef_ref',        quelle: 'offerdef',           typ: 'kennung',   sqlTyp: 'text' },
      { ziel: 'place_ref',           quelle: 'place',              typ: 'kennung',   sqlTyp: 'text' },
      { ziel: 'date_start',          quelle: 'date_start',         typ: 'zeitpunkt', sqlTyp: 'timestamptz' },
      { ziel: 'date_end',            quelle: 'date_end',           typ: 'zeitpunkt', sqlTyp: 'timestamptz' },
      { ziel: 'date_signupstart',    quelle: 'date_signupstart',   typ: 'zeitpunkt', sqlTyp: 'timestamptz' },
      { ziel: 'date_close',          quelle: 'date_close',         typ: 'zeitpunkt', sqlTyp: 'timestamptz' },
      { ziel: 'user_minimal',        quelle: 'user_minimal',       typ: 'ganzzahl',  sqlTyp: 'integer' },
      { ziel: 'user_maximum',        quelle: 'user_maximum',       typ: 'ganzzahl',  sqlTyp: 'integer' },
      { ziel: 'status',              quelle: 'status',             typ: 'text',      sqlTyp: 'text' },
      { ziel: 'mode',                quelle: 'mode',               typ: 'text',      sqlTyp: 'text' },
      { ziel: 'offer_type',          quelle: 'type',               typ: 'text',      sqlTyp: 'text' },
      { ziel: 'vat_rate',            quelle: 'vat',                typ: 'kommazahl', sqlTyp: 'numeric(6,3)' },
      { ziel: 'country',             quelle: 'country',            typ: 'text',      sqlTyp: 'text' },
      { ziel: 'internal_code',       quelle: 'internal_code',      typ: 'text',      sqlTyp: 'text' },
      { ziel: 'is_archived',         quelle: 'archive',            typ: 'wahr',      sqlTyp: 'boolean' },
      { ziel: 'is_trash',            quelle: 'trash',              typ: 'wahr',      sqlTyp: 'boolean' },
      { ziel: 'has_waiting_list',    quelle: 'waiting_list',       typ: 'wahr',      sqlTyp: 'boolean' },
      { ziel: 'mustpay',             quelle: 'mustpay',            typ: 'wahr',      sqlTyp: 'boolean' },
      { ziel: 'is_multi_offer',      quelle: 'multi_offer',        typ: 'wahr',      sqlTyp: 'boolean' },
      { ziel: 'is_multi_offer_child', quelle: 'multi_offer_child', typ: 'wahr',      sqlTyp: 'boolean' },
    ],
    zusatzSpalten: [],
    userRef: null,
    hashFelder: [
      'name', 'offer_number', 'category_ref', 'place_ref',
      'date_start', 'date_end', 'user_minimal', 'user_maximum',
      'status', 'mode', 'offer_type', 'vat_rate', 'is_archived', 'is_trash',
    ],
  },

  edo_bookings: {
    kennung: 'edo_bookings',
    endpunkt: '/booking/list',
    schema: 'edoobox_raw',
    zieltabelle: 'booking',
    pk: 'booking_id',
    seitengroesse: 2000,
    loeschungen: true,
    hash: true,
    payload: false,
    source: 'api',
    spalten: [
      { ziel: 'booking_id',     quelle: 'id',           typ: 'kennung',   sqlTyp: 'text' },
      { ziel: 'offer_id',       quelle: 'offer',        typ: 'kennung',   sqlTyp: 'text' },
      { ziel: 'status',         quelle: 'status',       typ: 'text',      sqlTyp: 'text' },
      { ziel: 'booking_time',   quelle: 'time',         typ: 'zeitpunkt', sqlTyp: 'timestamptz' },
      { ziel: 'is_b2b',         quelle: 'b2b',          typ: 'wahr',      sqlTyp: 'boolean' },
      { ziel: 'is_multi_offer', quelle: 'multi_offer',  typ: 'wahr',      sqlTyp: 'boolean' },
    ],
    zusatzSpalten: [
      { name: 'owner',   quelle: 'owner',   typ: 'text', sqlTyp: 'text' },
      { name: 'mustpay', quelle: 'mustpay', typ: 'wahr', sqlTyp: 'boolean' },
      { name: 'label',   quelle: 'label',   typ: 'text', sqlTyp: 'text' },
    ],
    ableitungen: [
      {
        typ: 'booking_position',
        quelleRoht: 'users',
        eingangFeld: 'users',
        schema: 'edoobox_raw',
        tabelle: 'booking_position',
        pkSpalten: ['booking_id', 'pricecategory_id'],
        loeschSchluessel: null,
        loeschungBeiVollabgleich: false,
      },
      {
        typ: 'booking_transaction',
        quelleRoht: 'transactions',
        eingangFeld: 'transactions',
        schema: 'edoobox_raw',
        tabelle: 'booking_transaction',
        pkSpalten: ['transaction_id'],
        loeschSchluessel: 'transaction_id',
        loeschungBeiVollabgleich: true,
      },
    ],
    userRef: { quelle: 'owner', ziel: 'user_ref' },
    hashFelder: ['offer_id', 'status', 'booking_time', 'mustpay', 'label'],
  },

  edo_invoices: {
    kennung: 'edo_invoices',
    endpunkt: '/invoice/list',
    schema: 'edoobox_raw',
    zieltabelle: 'invoice',
    pk: 'invoice_id',
    seitengroesse: 2000,
    loeschungen: true,
    hash: true,
    payload: true,
    spalten: [
      { ziel: 'invoice_id',       quelle: 'id',               typ: 'kennung',      sqlTyp: 'text' },
      { ziel: 'invoice_number',   quelle: 'number',           typ: 'text',         sqlTyp: 'text' },
      { ziel: 'status',           quelle: 'status',           typ: 'ganzzahl',     sqlTyp: 'integer' },
      { ziel: 'status_text',      quelle: 'status',           typ: 'rechnungsstatus', sqlTyp: 'text' },
      { ziel: 'currency',         quelle: 'currency',         typ: 'waehrung',     sqlTyp: 'text' },
      { ziel: 'amount',           quelle: 'amount',           typ: 'kommazahl',    sqlTyp: 'numeric(12,2)' },
      { ziel: 'date_create',      quelle: 'date_create',      typ: 'zeitpunkt',    sqlTyp: 'timestamptz' },
      { ziel: 'date_pay',         quelle: 'date_pay',         typ: 'zeitpunkt',    sqlTyp: 'timestamptz' },
      { ziel: 'date_payuntil',    quelle: 'date_payuntil',    typ: 'zeitpunkt',    sqlTyp: 'timestamptz' },
      { ziel: 'date_cancelled',   quelle: 'date_cancelled',   typ: 'zeitpunkt',    sqlTyp: 'timestamptz' },
      { ziel: 'offer_start_date', quelle: 'offer_start_date', typ: 'zeitpunkt',    sqlTyp: 'timestamptz' },
    ],
    zusatzSpalten: [
      { name: 'user', quelle: 'user', typ: 'text', sqlTyp: 'text' },
    ],
    userRef: { quelle: 'user', ziel: 'user_ref' },
    hashFelder: [
      'invoice_number', 'status', 'status_text', 'currency', 'amount',
      'date_create', 'date_pay', 'date_payuntil', 'date_cancelled', 'offer_start_date',
    ],
  },

  // ---- Neu angelegt (O-2), ab 07.09.2026 ----

  edo_vat: {
    kennung: 'edo_vat',
    endpunkt: '/vat/list',
    schema: 'edoobox_raw',
    zieltabelle: 'vat',
    pk: 'vat_id',
    seitengroesse: 2000,
    loeschungen: true,
    hash: false,
    payload: true,
    spalten: [
      { ziel: 'vat_id', quelle: 'id',   typ: 'kennung',   sqlTyp: 'text' },
      { ziel: 'name',   quelle: 'name', typ: 'text',      sqlTyp: 'text' },
      { ziel: 'rate',   quelle: 'rate', typ: 'kommazahl', sqlTyp: 'numeric(6,3)' },
    ],
    zusatzSpalten: [],
    userRef: null,
    hashFelder: ['name', 'rate'],
  },

  edo_countries: {
    kennung: 'edo_countries',
    endpunkt: '/country/list',
    schema: 'edoobox_raw',
    zieltabelle: 'country',
    pk: 'country_id',
    seitengroesse: 2000,
    loeschungen: true,
    hash: false,
    payload: true,
    spalten: [
      { ziel: 'country_id', quelle: 'id',   typ: 'kennung', sqlTyp: 'text' },
      { ziel: 'iso_code',   quelle: 'code', typ: 'text',    sqlTyp: 'text' },
      { ziel: 'name',       quelle: 'name', typ: 'text',    sqlTyp: 'text' },
    ],
    zusatzSpalten: [],
    userRef: null,
    hashFelder: ['iso_code', 'name'],
  },

  edo_categories: {
    kennung: 'edo_categories',
    endpunkt: '/category/list',
    schema: 'edoobox_raw',
    zieltabelle: 'category',
    pk: 'category_id',
    seitengroesse: 2000,
    loeschungen: true,
    hash: false,
    payload: true,
    spalten: [
      { ziel: 'category_id', quelle: 'id',     typ: 'kennung', sqlTyp: 'text' },
      { ziel: 'name',        quelle: 'name',   typ: 'text',    sqlTyp: 'text' },
      { ziel: 'parent_ref',  quelle: 'parent', typ: 'kennung', sqlTyp: 'text' },
    ],
    zusatzSpalten: [],
    userRef: null,
    hashFelder: ['name', 'parent_ref'],
  },

  edo_users: {
    kennung: 'edo_users',
    endpunkt: '/user/list',
    schema: 'edoobox_raw',
    zieltabelle: 'user_account',
    pk: 'user_ref',
    seitengroesse: 2000,
    loeschungen: true,
    hash: false,
    payload: false,
    spalten: [],
    zusatzSpalten: [
      { name: 'owner', quelle: 'id', typ: 'kennung', sqlTyp: 'text' },
    ],
    userRef: { quelle: 'owner', ziel: 'user_ref' },
    hashFelder: ['user_ref'],
  },

  edo_pricecategories: {
    kennung: 'edo_pricecategories',
    endpunkt: '/pricecategory/list',
    schema: 'edoobox_raw',
    zieltabelle: 'pricecategory',
    pk: 'pricecategory_id',
    seitengroesse: 2000,
    loeschungen: true,
    hash: true,
    payload: true,
    spalten: [
      { ziel: 'pricecategory_id', quelle: 'id',       typ: 'kennung',   sqlTyp: 'text' },
      { ziel: 'offer_id',         quelle: 'offer',    typ: 'kennung',   sqlTyp: 'text' },
      { ziel: 'name',             quelle: 'name',     typ: 'text',      sqlTyp: 'text' },
      { ziel: 'amount_net',       quelle: 'amount',   typ: 'kommazahl', sqlTyp: 'numeric(12,2)' },
      { ziel: 'currency',         quelle: 'currency', typ: 'waehrung',  sqlTyp: 'char(3)' },
    ],
    zusatzSpalten: [],
    userRef: null,
    hashFelder: ['offer_id', 'name', 'amount_net', 'currency'],
  },

  edo_attendances: {
    kennung: 'edo_attendances',
    endpunkt: '/attendance/list',
    schema: 'edoobox_raw',
    zieltabelle: 'attendance',
    pk: 'attendance_id',
    seitengroesse: 2000,
    loeschungen: true,
    hash: false,
    payload: false,
    spalten: [
      { ziel: 'attendance_id', quelle: 'id',     typ: 'kennung', sqlTyp: 'text' },
      { ziel: 'date_id',       quelle: 'date',   typ: 'kennung', sqlTyp: 'text' },
      { ziel: 'status',        quelle: 'status', typ: 'text',    sqlTyp: 'text' },
    ],
    zusatzSpalten: [
      { name: 'owner', quelle: 'user', typ: 'kennung', sqlTyp: 'text' },
    ],
    userRef: { quelle: 'owner', ziel: 'user_ref' },
    hashFelder: ['date_id', 'status'],
  },

  edo_transactions: {
    kennung: 'edo_transactions',
    endpunkt: '/transaction/list',
    schema: 'edoobox_raw',
    zieltabelle: 'transaction_full',
    pk: 'transaction_id',
    seitengroesse: 2000,
    loeschungen: true,
    hash: false,
    payload: false,
    spalten: [
      { ziel: 'transaction_id',     quelle: 'id',       typ: 'kennung',   sqlTyp: 'text' },
      { ziel: 'booking_id',         quelle: 'booking',  typ: 'kennung',   sqlTyp: 'text' },
      { ziel: 'offer_id',           quelle: 'offer',    typ: 'kennung',   sqlTyp: 'text' },
      { ziel: 'transaction_number', quelle: 'number',   typ: 'text',      sqlTyp: 'text' },
      { ziel: 'amount',             quelle: 'amount',   typ: 'kommazahl', sqlTyp: 'numeric(12,2)' },
      { ziel: 'currency',           quelle: 'currency', typ: 'waehrung',  sqlTyp: 'char(3)' },
      { ziel: 'transaction_time',   quelle: 'time',     typ: 'zeitpunkt', sqlTyp: 'timestamptz' },
    ],
    zusatzSpalten: [],
    userRef: null,
    hashFelder: ['booking_id', 'offer_id', 'transaction_number', 'amount', 'currency', 'transaction_time'],
  },

  // ---- Tag-Ressource (Referenzdaten, verifiziert 26.09.2026) ----
  // GET /v2/tag/list liefert Objekte { id, name, value } ohne Personenbezug.
  edo_tags: {
    kennung: 'edo_tags',
    endpunkt: '/tag/list',
    schema: 'edoobox_raw',
    zieltabelle: 'tag',
    pk: 'tag_id',
    seitengroesse: 2000,
    loeschungen: true,
    hash: false,
    payload: true,
    spalten: [
      { ziel: 'tag_id', quelle: 'id',   typ: 'kennung', sqlTyp: 'text' },
      { ziel: 'name',   quelle: 'name', typ: 'text',    sqlTyp: 'text' },
    ],
    zusatzSpalten: [],
    userRef: null,
    hashFelder: ['name'],
  },
};

if (!kennung) {
  throw new Error('P90: Parameter "Ressourcenkennung" fehlt.');
}

const konfig = KONFIG[kennung];
if (!konfig) {
  throw new Error(
    'P90: Unbekannte Ressourcenkennung "' + kennung + '". Bekannt: ' + Object.keys(KONFIG).join(', ')
  );
}

// Loesch-Auswertung: Der Aufrufer kann den Modus steuern (P01 normal=false,
// P03 voll=true). Ohne explizite Vorgabe gilt der Konfigurationswert.
const loeschungen = typeof loeschungenEingabe === 'boolean' ? loeschungenEingabe : konfig.loeschungen;

return [{
  json: {
    kennung: konfig.kennung,
    endpunkt: konfig.endpunkt,
    zieltabelle: konfig.zieltabelle,
    primaerschluessel: konfig.pk,
    seitengroesse: konfig.seitengroesse,
    loeschungen,
    run_id: runId,
    hash: konfig.hash,
    konfig,
  },
}];
