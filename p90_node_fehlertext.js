// P90 - Fehlertext aufbereiten (Eingang des Fehlerpfads)
// Extrahiert Fehlermeldung und ggf. run_id und uebergibt sie parametrisiert
// (jsonb) an die Fehlerprotokollierung.

const fehler = $input.first().json;
const meldung = fehler.message ?? fehler.error?.message ?? fehler.error ?? 'Unbekannter Fehler in P90';
const rohRunId = fehler.run_id ?? fehler.runId ?? null;
const runId = (rohRunId === null || rohRunId === '' || rohRunId === undefined)
  ? null
  : Number(rohRunId);

const fehlerText = String(meldung).slice(0, 2000);

return [{
  json: {
    fehler_text: fehlerText,
    run_id: runId,
    fehlerJson: JSON.stringify([{ fehler_text: fehlerText, run_id: runId }]),
  },
}];
