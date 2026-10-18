// Aktualisiert n8n/P98_Update_Trainer_Single.json:
//  1. Code-Knoten "P98 Lektionstitel anpassen": neuer_titel als Alias ergänzen
//  2. SQL-Knoten "P98 Lokal aktualisieren (trainer_zuweisung)": Query umbauen
//     - Alle Variablen strikt über $("P98 Lektionstitel anpassen").first().json
//     - is_unassign wird referenziert (Zuweisung vs. Aufhebung)
//     - neuer_titel wird für die lokale Titel-Spiegelung (edoobox_raw.offer) genutzt
//     - edoobox_raw.date_leader wird bei Zuweisung geschrieben / bei Aufhebung entfernt
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'n8n', 'P98_Update_Trainer_Single.json');
const w = JSON.parse(fs.readFileSync(file, 'utf8'));

// ---------------------------------------------------------------------------
// 1. Code-Knoten: neuer_titel als Alias für neuer_lektionstitel
// ---------------------------------------------------------------------------
const codeNode = w.nodes.find((n) => n.name === 'P98 Lektionstitel anpassen');
if (!codeNode) throw new Error('Code-Knoten "P98 Lektionstitel anpassen" nicht gefunden');

const marker = '    is_unassign: isUnassign,\n    neuer_lektionstitel\n  }\n}];';
if (!codeNode.parameters.jsCode.includes(marker)) {
  throw new Error('Marker im jsCode des Code-Knotens nicht gefunden');
}
codeNode.parameters.jsCode = codeNode.parameters.jsCode.replace(
  marker,
  '    is_unassign: isUnassign,\n    neuer_lektionstitel,\n    neuer_titel: neuer_lektionstitel\n  }\n}];'
);

// ---------------------------------------------------------------------------
// 2. SQL-Knoten: Query vollständig ersetzen
// ---------------------------------------------------------------------------
const sqlNode = w.nodes.find((n) => n.name === 'P98 Lokal aktualisieren (trainer_zuweisung)');
if (!sqlNode) throw new Error('SQL-Knoten "P98 Lokal aktualisieren (trainer_zuweisung)" nicht gefunden');

const neuerQuery = `-- ============================================================
-- P98 Lokal aktualisieren (trainer_zuweisung)
-- Alle Variablen strikt über $("P98 Lektionstitel anpassen").first().json
-- ============================================================

-- 1. Lokale Titel-Spiegelung: Angebotstitel in edoobox_raw.offer aktualisieren
--    (neuer_titel = Lektionstitel ohne/mit Trainerkürzel aus edoobox)
UPDATE edoobox_raw.offer
SET name = '{{ $("P98 Lektionstitel anpassen").first().json.neuer_titel }}',
    last_synced_at = NOW()
WHERE offer_id = '{{ $("P98 Lektionstitel anpassen").first().json.offer_id }}'
  AND is_deleted IS NOT TRUE;

-- 2. date_leader (n:m-Leiter): Bei Zuweisung (is_unassign = false) schreiben,
--    bei Aufhebung (is_unassign = true) entfernen.
--    Hinweis: date_leader besitzt keine is_deleted-Spalte, daher DELETE.
INSERT INTO edoobox_raw.date_leader (date_id, admin_id, last_synced_at)
SELECT
  '{{ $("P98 Lektionstitel anpassen").first().json.date_id }}',
  '{{ $("P98 Lektionstitel anpassen").first().json.neuer_trainer_admin_id }}',
  NOW()
WHERE '{{ $("P98 Lektionstitel anpassen").first().json.is_unassign }}' = 'false'
  AND '{{ $("P98 Lektionstitel anpassen").first().json.neuer_trainer_admin_id }}' IS NOT NULL
  AND '{{ $("P98 Lektionstitel anpassen").first().json.neuer_trainer_admin_id }}' <> ''
ON CONFLICT (date_id, admin_id)
DO UPDATE SET last_synced_at = NOW();

DELETE FROM edoobox_raw.date_leader
WHERE date_id = '{{ $("P98 Lektionstitel anpassen").first().json.date_id }}'
  AND '{{ $("P98 Lektionstitel anpassen").first().json.is_unassign }}' = 'true';

-- 3. Neuen Trainer zuweisen und den bestehenden Status 1:1 übernehmen
--    (nur bei Zuweisung, is_unassign = false)
WITH neu AS (
  SELECT t.id AS trainer_id
  FROM public.trainer t
  WHERE t.edoobox_admin_id = '{{ $("P98 Lektionstitel anpassen").first().json.neuer_trainer_admin_id }}'
  LIMIT 1
),
alt AS (
  SELECT status, notiz, honorar_manuell
  FROM public.trainer_zuweisung
  WHERE date_id = '{{ $("P98 Lektionstitel anpassen").first().json.date_id }}'
  ORDER BY updated_at DESC
  LIMIT 1
)
INSERT INTO public.trainer_zuweisung (trainer_id, date_id, status, notiz, honorar_manuell, updated_at)
SELECT 
  neu.trainer_id, 
  '{{ $("P98 Lektionstitel anpassen").first().json.date_id }}', 
  COALESCE(alt.status, 'ausgeschrieben'),
  alt.notiz,
  alt.honorar_manuell,
  NOW()
FROM neu
LEFT JOIN alt ON true
WHERE neu.trainer_id IS NOT NULL
  AND '{{ $("P98 Lektionstitel anpassen").first().json.is_unassign }}' = 'false'
ON CONFLICT (date_id, trainer_id)
DO UPDATE SET 
  status = EXCLUDED.status,
  notiz = EXCLUDED.notiz,
  honorar_manuell = EXCLUDED.honorar_manuell,
  updated_at = NOW();

-- 4. Zuweisung des bisherigen Trainers restlos löschen
--    (bei Aufhebung oder wenn kein neuer Trainer gefunden wurde)
DELETE FROM public.trainer_zuweisung
WHERE date_id = '{{ $("P98 Lektionstitel anpassen").first().json.date_id }}'
  AND (
    '{{ $("P98 Lektionstitel anpassen").first().json.is_unassign }}' = 'true'
    OR '{{ $("P98 Lektionstitel anpassen").first().json.neuer_trainer_admin_id }}' IS NULL
    OR '{{ $("P98 Lektionstitel anpassen").first().json.neuer_trainer_admin_id }}' = ''
    OR trainer_id NOT IN (
      SELECT t.id FROM public.trainer t
      WHERE t.edoobox_admin_id = '{{ $("P98 Lektionstitel anpassen").first().json.neuer_trainer_admin_id }}'
    )
  );`;

sqlNode.parameters.query = neuerQuery;

fs.writeFileSync(file, JSON.stringify(w, null, 2) + '\n');
console.log('P98_Update_Trainer_Single.json erfolgreich aktualisiert.');
