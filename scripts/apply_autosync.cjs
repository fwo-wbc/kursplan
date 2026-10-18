/**
 * apply_autosync.cjs
 * ------------------------------------------------------------------
 * Setzt den automatischen Hintergrund-Sync um:
 *  - page.tsx:  loadData(silent = false), Silent-Reload-Listener,
 *               lokales Status-/Kürzel-Update in handleTrainerChange,
 *               'kursplan:trigger-sync' nach erfolgreichem POST.
 *  - Navigation.tsx:  reagiert auf 'kursplan:trigger-sync', roter
 *               Sync-Button bei laufendem/fehlgeschlagenem Sync,
 *               'kursplan:reload-silent' statt window.location.reload().
 *
 * Ausgabe bei Erfolg: "PATCH OK"
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PAGE_PATH = path.join(__dirname, '..', 'app', 'src', 'app', 'page.tsx');
const NAV_PATH = path.join(__dirname, '..', 'app', 'src', 'app', 'components', 'Navigation.tsx');

/** Liest eine Datei und normalisiert CRLF -> LF, damit die Muster matchen. */
function readNormalized(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

/** Schreibt eine Datei und wandelt LF wieder in CRLF zurück (Originalformat). */
function writeOriginal(filePath, content) {
  fs.writeFileSync(filePath, content.replace(/\n/g, '\r\n'), 'utf8');
}

/** Wende einen Patch an: ersetzt exakt ein Vorkommen; sonst Abbruch. */
function patch(name, source, search, replace, optional = false) {
  if (!source.includes(search)) {
    if (optional) return source; // bereits angewendet -> überspringen
    console.error(`PATCH FEHLGESCHLAGEN: Muster "${name}" nicht gefunden.`);
    process.exit(1);
  }
  const count = source.split(search).length - 1;
  if (count !== 1) {
    if (optional) return source; // bereits angewendet -> überspringen
    console.error(`PATCH FEHLGESCHLAGEN: Muster "${name}" ${count}x gefunden (erwartet 1x).`);
    process.exit(1);
  }
  return source.replace(search, replace);
}

// ===========================================================================
// 1) app/src/app/page.tsx
// ===========================================================================
let page = readNormalized(PAGE_PATH);

// 1a) loadData(silent = false): kein setLoading(true) bei silent.
//     (silent !== true statt !silent, damit onClick={loadData} mit dem
//     durchgereichten MouseEvent weiterhin den Ladezustand anzeigt.)
page = patch(
  'loadData Signatur + silent',
  page,
  [
    '  const loadData = useCallback(async () => {',
    '    setIsLoading(true);',
  ].join('\n'),
  [
    '  const loadData = useCallback(async (silent = false) => {',
    '    if (silent !== true) setIsLoading(true);',
  ].join('\n'),
  true
);

// 1b) Window-Event 'kursplan:reload-silent' -> loadData(true)
page = patch(
  'Silent-Reload-Listener',
  page,
  [
    '  useEffect(() => {',
    '    loadData();',
    '  }, [loadData]);',
  ].join('\n'),
  [
    '  useEffect(() => {',
    '    loadData();',
    '    const onSilentReload = () => loadData(true);',
    "    window.addEventListener('kursplan:reload-silent', onSilentReload);",
    "    return () => window.removeEventListener('kursplan:reload-silent', onSilentReload);",
    '  }, [loadData]);',
  ].join('\n'),
  true
);

// 1c) handleTrainerChange: optimistisches Update setzt Zuweisungs-Status
//     lokal ('n. v.' -> null, Trainer -> 'ausgeschrieben' falls leer/null).
page = patch(
  'Optimistisches Status-/Kürzel-Update',
  page,
  [
    '          const neueZuweisung: Zuweisung = {',
    '            ...(bisherige ?? {',
    '              id: null,',
    '              trainer_id: null,',
    '              status: null,',
    '              notiz: null,',
    '              honorar_manuell: null,',
    '              trainer: null,',
    '            }),',
    '            trainer: {',
    '              kuerzel: neuesKuerzel,',
    '            },',
    '            quelle: \'lokal\',',
    '          };',
  ].join('\n'),
  [
    '          const neueZuweisung: Zuweisung = {',
    '            ...(bisherige ?? {',
    '              id: null,',
    '              trainer_id: null,',
    '              status: null,',
    '              notiz: null,',
    '              honorar_manuell: null,',
    '              trainer: null,',
    '            }),',
    '            // Sofortige lokale Aktualisierung des Zuweisungs-Status:',
    "            // 'n. v.' hebt die Zuweisung auf (Status null), jede Trainer-",
    "            // Zuweisung setzt 'ausgeschrieben', sofern kein Status stand.",
    '            status:',
    '              neuesKuerzel === \'n. v.\'',
    '                ? null',
    "                : (bisherige?.status ?? 'ausgeschrieben'),",
    '            trainer: {',
    '              kuerzel: neuesKuerzel,',
    '            },',
    '            quelle: \'lokal\',',
    '          };',
  ].join('\n'),
  true
);

// 1d) Nach erfolgreichem POST 'kursplan:trigger-sync' feuern.
//     Idempotent: nur einfügen, wenn der Dispatch noch nicht vorhanden ist.
if (
  page.includes("window.dispatchEvent(new CustomEvent('kursplan:trigger-sync'));")
) {
  // bereits angewendet -> nichts tun
} else {
  page = patch(
    'Trigger-Sync nach erfolgreichem POST',
    page,
    [
      '        if (!res.ok) {',
      '          throw new Error(data.error ?? `HTTP ${res.status}`);',
      '        }',
    ].join('\n'),
    [
      '        if (!res.ok) {',
      '          throw new Error(data.error ?? `HTTP ${res.status}`);',
      '        }',
      '',
      '        // Nach erfolgreichem POST den Hintergrund-Sync anstoßen (die',
      '        // Navigation hört auf \'kursplan:trigger-sync\' und startet den Sync).',
      "        window.dispatchEvent(new CustomEvent('kursplan:trigger-sync'));",
    ].join('\n'),
    true
  );
}

// 1e) onClick={loadData} -> Arrow, damit kein MouseEvent als 'silent' durchgereicht
//     wird (der manuelle Refresh-Button soll weiterhin den Ladezustand zeigen).
page = patch(
  'onClick loadData Arrow',
  page,
  '            onClick={loadData}',
  '            onClick={() => loadData()}',
  true
);

writeOriginal(PAGE_PATH, page);

// ===========================================================================
// 2) app/src/app/components/Navigation.tsx
// ===========================================================================
let nav = readNormalized(NAV_PATH);

// 2a) useEffect importieren.
nav = patch(
  'useEffect-Import',
  nav,
  "import { useState } from 'react';",
  "import { useEffect, useState } from 'react';",
  true
);

// 2b) Statt hartem Reload das Silent-Refresh-Event feuern.
nav = patch(
  'Silent-Refresh statt window.location.reload()',
  nav,
  [
    '      setTimeout(() => {',
    '        window.location.reload();',
    '      }, 600);',
  ].join('\n'),
  [
    '      setTimeout(() => {',
    "        window.dispatchEvent(new CustomEvent('kursplan:reload-silent'));",
    '      }, 600);',
  ].join('\n'),
  true
);

// 2c) Auf 'kursplan:trigger-sync' hören: bestehenden Sync automatisch starten.
//     Idempotent: nur einfügen, wenn der Listener noch nicht vorhanden ist.
if (
  nav.includes("window.addEventListener('kursplan:trigger-sync', onTriggerSync);")
) {
  // bereits angewendet -> nichts tun
} else {
  nav = patch(
    'Trigger-Sync-Listener',
    nav,
    "  const isLoading = status === 'loading';",
    [
      '  // Auf den Hintergrund-Sync-Auslöser aus page.tsx reagieren',
      "  // (kursplan:trigger-sync) und den bestehenden Sync automatisch starten.",
      '  useEffect(() => {',
      '    const onTriggerSync = () => {',
      '      void handleSync();',
      '    };',
      "    window.addEventListener('kursplan:trigger-sync', onTriggerSync);",
      "    return () => window.removeEventListener('kursplan:trigger-sync', onTriggerSync);",
      '  }, [handleSync]);',
      '',
      "  const isLoading = status === 'loading';",
    ].join('\n'),
    true
  );
}

// 2d) Sync-Button rot darstellen, während der Sync läuft (oder wiederholt
//     werden muss).
nav = patch(
  'Button-Klassen (rot bei loading/error)',
  nav,
  [
    "        status === 'success'",
    "          ? 'border-green-300 bg-green-50 text-green-700'",
    "          : status === 'error'",
    "            ? 'border-red-300 bg-red-50 text-red-700'",
    "            : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'",
  ].join('\n'),
  [
    "        status === 'success'",
    "          ? 'border-green-300 bg-green-50 text-green-700'",
    "          : status === 'loading' || status === 'error'",
    "            ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse'",
    "            : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'",
  ].join('\n'),
  true
);

// 2e) Icon-Farbe passend zum roten Button (weiß statt rot auf rotem Grund).
nav = patch(
  'Icon-Farbe (weiß bei loading/error)',
  nav,
  [
    "          status === 'success'",
    "            ? 'text-green-600'",
    "            : status === 'error'",
    "              ? 'text-red-600'",
    "              : 'text-slate-500'",
  ].join('\n'),
  [
    "          status === 'success'",
    "            ? 'text-green-600'",
    "            : status === 'loading' || status === 'error'",
    "              ? 'text-white'",
    "              : 'text-slate-500'",
  ].join('\n'),
  true
);

writeOriginal(NAV_PATH, nav);

console.log('PATCH OK');
