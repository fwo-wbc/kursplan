// P90 - Zaehlwerte ausgeben
// Fuehrt die Ergebniszahlen aus dem Speichern-Node und dem Holen-Node zusammen.
// Erzeugt zusaetzlich das parametrisierte INSERT fuer sync_run_resource
// (E-31g, AK-36): je Ressource eine Protokollzeile.

const speichern = $('P90 Ressource speichern').first().json;
const holen = $('P90 Ressource holen').first().json;

function z(w) {
  const n = Number(w);
  return Number.isFinite(n) ? n : 0;
}

const ausgabe = {
  kennung: holen.kennung,
  run_id: holen.run_id,
  endpunkt: holen.endpunkt,
  zieltabelle: holen.zieltabelle,
  api_aufrufe: z(holen.abrufe),
  gemeldet_total: holen.gemeldet_total !== undefined ? holen.gemeldet_total : null,
  gelesen: z(speichern.gelesen ?? holen.gelesen),
  neu: z(speichern.neu),
  geaendert: z(speichern.geaendert),
  gespeichert: z(speichern.gespeichert),
  geloescht: z(speichern.geloescht),
  vollstaendig: holen.vollstaendig,
};

// Protokoll je Ressource (sync_run_resource). run_id bleibt null, wenn der
// Aufrufer keine Laufkennung uebergibt; das INSERT filtert NULL-Werte heraus.
const runIdZahl =
  (ausgabe.run_id === null || ausgabe.run_id === undefined || ausgabe.run_id === '')
    ? null
    : Number(ausgabe.run_id);

const protokollSatz = [{
  run_id: runIdZahl,
  resource: ausgabe.kennung,
  gemeldet: ausgabe.gemeldet_total,
  gelesen: ausgabe.gelesen,
  neu: ausgabe.neu,
  geaendert: ausgabe.geaendert,
  geloescht: ausgabe.geloescht,
  api_calls: ausgabe.api_aufrufe,
}];

const protokollJson = JSON.stringify(protokollSatz);
let ptag = '$p90p' + Math.random().toString(36).slice(2, 10) + '$';
while (protokollJson.includes(ptag)) ptag = '$p90p' + Math.random().toString(36).slice(2, 10) + '$';

ausgabe.protokollSql =
  'INSERT INTO edoobox_raw.sync_run_resource\n' +
  '    (run_id, resource, gemeldet, gelesen, neu, geaendert, geloescht, api_calls)\n' +
  'SELECT x.run_id, x.resource, x.gemeldet, x.gelesen, x.neu, x.geaendert, x.geloescht, x.api_calls\n' +
  'FROM jsonb_to_recordset(' + ptag + protokollJson + ptag + '::jsonb)\n' +
  '     AS x(run_id bigint, resource text, gemeldet integer, gelesen integer,\n' +
  '          neu integer, geaendert integer, geloescht integer, api_calls integer)\n' +
  'WHERE x.run_id IS NOT NULL\n' +
  'ON CONFLICT (run_id, resource) DO UPDATE SET\n' +
  '    gemeldet  = EXCLUDED.gemeldet,\n' +
  '    gelesen   = EXCLUDED.gelesen,\n' +
  '    neu       = EXCLUDED.neu,\n' +
  '    geaendert = EXCLUDED.geaendert,\n' +
  '    geloescht = EXCLUDED.geloescht,\n' +
  '    api_calls = EXCLUDED.api_calls;';

return [{ json: ausgabe }];
