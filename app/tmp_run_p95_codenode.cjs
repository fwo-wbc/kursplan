/* Fuehrt die NEUE Version des P95-Code-Nodes ("P95 Auftraege aufbereiten") mit
   einer n8n-$-Simulation aus. Kein Netzwerkzugriff, keine DB.
   Beweist: realistische Webhook-Payloads (Trainerwechsel) erzeugen die
   erwarteten Auftrag-Items inkl. korrigiertem Modultitel.

   Neue Version im Vergleich zur alten:
   - Token kommt aus $input (direkter Input "P95 Token holen")
   - Webhook wird ueber $('Webhook').all() gelesen (alle Items)
   - "n. v."-Kuerzel fuehrt zu keinem Titel-Update
   - Ohne altes Kuerzel wird das neue Kuerzel angehaengt
   - Zusaetzliche Output-Felder: name, kuerzel, altes_kuerzel */
const assert = require('assert');

const jsCode = `// 1. Token- und EDID-Werte vom direkten Input ("P95 Token holen") abgreifen
const tokenInput = $input.first()?.json || {};
const token = tokenInput.token || tokenInput.access_token || "";
const edid = tokenInput.edid || "";

// 2. Original-Webhook-Payload gezielt ueber den Node-Namen holen (Name ggf. anpassen, falls abweichend)
const webhookItems = $('Webhook').all();
const results = [];

for (const wItem of webhookItems) {
  const body = wItem.json.body || {};

  const aktuellerTitel = body.titel || "";
  const altesKuerzel = body.altes_kuerzel || "";
  const neuesKuerzel = body.trainer_kuerzel || "";
  const edooboxAdminId = body.edoobox_admin_id || "";
  const offerId = body.offer_id || "";

  let neuerTitel = aktuellerTitel;
  let titelGeaendert = false;

  // Titel-Logik (Ersetzen oder anhaengen)
  // Schutz: bei unveraendertem Kuerzel (altes == neues) kein Titel-Update.
  if (neuesKuerzel && neuesKuerzel !== "n. v." && neuesKuerzel !== altesKuerzel) {
    if (altesKuerzel) {
      const regex = new RegExp('\\\\s*\\\\(?\\\\b' + altesKuerzel + '\\\\b\\\\)?$');
      neuerTitel = aktuellerTitel.replace(regex, ' (' + neuesKuerzel + ')');
    } else {
      neuerTitel = aktuellerTitel + ' (' + neuesKuerzel + ')';
    }
    titelGeaendert = (aktuellerTitel !== neuerTitel);
  }

  // date_ids aufteilen und alle fuer die Folgeknoten benoetigten Felder mitgeben
  const dateIds = Array.isArray(body.date_ids) ? body.date_ids : [body.date_ids];

  for (const dateId of dateIds) {
    results.push({
      json: {
        token: token,
        edid: edid,
        edoobox_admin_id: edooboxAdminId,
        date_id: dateId,
        offer_id: offerId,
        name: aktuellerTitel,
        kuerzel: neuesKuerzel,
        altes_kuerzel: altesKuerzel,
        neuer_titel: neuerTitel,
        titel_geaendert: titelGeaendert
      }
    });
  }
}

return results;`;

/**
 * Simuliert die n8n-Umgebung:
 * - $input  = aktuelles Item (Token-Node "P95 Token holen")
 * - $('Webhook').all() = alle Webhook-Items
 */
function run(body, tokenJson = { token: 'TOKEN123', edid: 'EDID777' }, extraWebhookItems = []) {
  const webhookItems = [{ json: { body } }, ...extraWebhookItems];
  const $input = { first: () => ({ json: tokenJson }) };
  const $ = (name) => {
    if (name === 'Webhook') return { all: () => webhookItems };
    throw new Error('Unbekannter Node: ' + name);
  };
  const fn = new Function('$', '$input', jsCode);
  return fn($, $input);
}

(async () => {
  // Fall 1: Trainerwechsel FW -> MS, Titel endet nackt auf "FW", 2 Termine.
  const items1 = run({
    offer_id: 'offer_1001',
    date_ids: ['date_a', 'date_b'],
    titel: 'Excel Grundlagen FW',
    trainer_id: 22,
    trainer_kuerzel: 'MS',
    altes_kuerzel: 'FW',
    edoobox_admin_id: '999',
  });
  assert.strictEqual(items1.length, 2, 'ein Item je date_id');
  for (const item of items1) {
    assert.strictEqual(item.json.neuer_titel, 'Excel Grundlagen (MS)');
    assert.strictEqual(item.json.titel_geaendert, true);
    assert.strictEqual(item.json.offer_id, 'offer_1001');
    assert.strictEqual(item.json.token, 'TOKEN123');
    assert.strictEqual(item.json.edid, 'EDID777');
    assert.strictEqual(item.json.name, 'Excel Grundlagen FW');
    assert.strictEqual(item.json.kuerzel, 'MS');
    assert.strictEqual(item.json.altes_kuerzel, 'FW');
  }
  console.log('✓ Fall 1 (Trainerwechsel, nacktes Kürzel):', items1.map((i) => i.json.date_id + ' -> ' + i.json.neuer_titel).join(', '));

  // Fall 2: Bereits geklammertes Kürzel "(FW)" wird ersetzt.
  const items2 = run({
    offer_id: 'offer_1002',
    date_ids: ['date_c'],
    titel: 'PowerPoint (FW)',
    trainer_kuerzel: 'DH',
    altes_kuerzel: 'FW',
    edoobox_admin_id: '998',
  });
  assert.strictEqual(items2[0].json.neuer_titel, 'PowerPoint (DH)');
  assert.strictEqual(items2[0].json.titel_geaendert, true);
  console.log('✓ Fall 2 (geklammertes Kürzel):', items2[0].json.neuer_titel);

  // Fall 3: Kein Kürzel am Titelende -> kein Titel-Update, aber Item bleibt.
  const items3 = run({
    offer_id: 'offer_1003',
    date_ids: ['date_d'],
    titel: 'Word Grundlagen (kompakt)',
    trainer_kuerzel: 'MS',
    altes_kuerzel: 'FW',
    edoobox_admin_id: '997',
  });
  assert.strictEqual(items3[0].json.titel_geaendert, false);
  assert.strictEqual(items3[0].json.neuer_titel, 'Word Grundlagen (kompakt)');
  assert.strictEqual(items3[0].json.date_id, 'date_d');
  console.log('✓ Fall 3 (kein Titelend-Pattern): Update übersprungen, Item vorhanden');

  // Fall 4: altes == neues Kürzel -> kein Update.
  const items4 = run({
    offer_id: 'offer_1004',
    date_ids: ['date_e'],
    titel: 'Kurs FW',
    trainer_kuerzel: 'FW',
    altes_kuerzel: 'FW',
    edoobox_admin_id: '996',
  });
  assert.strictEqual(items4[0].json.titel_geaendert, false);
  assert.strictEqual(items4[0].json.neuer_titel, 'Kurs FW');
  console.log('✓ Fall 4 (altes == neues Kürzel): kein Update');

  // Fall 5: neues Kürzel "n. v." -> kein Anhängen/Ersetzen.
  const items5 = run({
    offer_id: 'offer_1005',
    date_ids: ['date_f'],
    titel: 'Outlook Grundlagen',
    trainer_kuerzel: 'n. v.',
    altes_kuerzel: 'FW',
    edoobox_admin_id: '995',
  });
  assert.strictEqual(items5[0].json.titel_geaendert, false);
  assert.strictEqual(items5[0].json.neuer_titel, 'Outlook Grundlagen');
  console.log('✓ Fall 5 ("n. v."-Kürzel): kein Titel-Update');

  // Fall 6: kein altes Kürzel, neues Kürzel vorhanden -> anhängen.
  const items6 = run({
    offer_id: 'offer_1006',
    date_ids: ['date_g'],
    titel: 'Access Grundlagen',
    trainer_kuerzel: 'MS',
    altes_kuerzel: '',
    edoobox_admin_id: '994',
  });
  assert.strictEqual(items6[0].json.titel_geaendert, true);
  assert.strictEqual(items6[0].json.neuer_titel, 'Access Grundlagen (MS)');
  console.log('✓ Fall 6 (ohne altes Kürzel): angehängt ->', items6[0].json.neuer_titel);

  // Fall 7: mehrere Webhook-Items über $('Webhook').all() -> alle werden verarbeitet.
  const items7 = run(
    {
      offer_id: 'offer_1007',
      date_ids: ['date_h'],
      titel: 'Kurs A FW',
      trainer_kuerzel: 'MS',
      altes_kuerzel: 'FW',
      edoobox_admin_id: '993',
    },
    { token: 'TOKEN123', edid: 'EDID777' },
    [
      {
        json: {
          body: {
            offer_id: 'offer_1008',
            date_ids: ['date_i', 'date_j'],
            titel: 'Kurs B FW',
            trainer_kuerzel: 'DH',
            altes_kuerzel: 'FW',
            edoobox_admin_id: '992',
          },
        },
      },
    ]
  );
  assert.strictEqual(items7.length, 3, '1 + 2 Items aus beiden Webhook-Payloads');
  assert.strictEqual(items7[0].json.offer_id, 'offer_1007');
  assert.strictEqual(items7[1].json.offer_id, 'offer_1008');
  assert.strictEqual(items7[2].json.offer_id, 'offer_1008');
  assert.strictEqual(items7[1].json.neuer_titel, 'Kurs B (DH)');
  console.log('✓ Fall 7 (mehrere Webhook-Items via .all()):', items7.length, 'Items verarbeitet');

  // Fall 8: Token-Fallback auf access_token, edid leer -> kein Crash.
  const items8 = run(
    {
      offer_id: 'offer_1009',
      date_ids: ['date_k'],
      titel: 'Kurs C',
      trainer_kuerzel: 'MS',
      edoobox_admin_id: '991',
    },
    { access_token: 'TOKEN_ABC', edid: '' }
  );
  assert.strictEqual(items8[0].json.token, 'TOKEN_ABC');
  assert.strictEqual(items8[0].json.edid, '');
  assert.strictEqual(items8[0].json.neuer_titel, 'Kurs C (MS)');
  console.log('✓ Fall 8 (access_token-Fallback, leere edid): kein Crash');

  console.log('\nNeuer Workflow-jsCode (P95 Auftraege aufbereiten) liefert in allen Fällen korrekte Items.');
})().catch((err) => {
  console.error('FEHLER:', err.message);
  process.exit(1);
});
