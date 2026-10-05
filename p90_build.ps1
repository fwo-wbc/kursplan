$ErrorActionPreference = 'Stop'

function ReadJs([string]$path) {
  $raw = Get-Content -Raw -Encoding UTF8 -LiteralPath $path
  return ($raw -replace '\r?\n$', '')
}

$konfigJs     = ReadJs 'p90_node_konfig.js'
$holenJs      = ReadJs 'p90_node_holen.js'
$zaehlwerteJs = ReadJs 'p90_node_zaehlwerte.js'
$fehlertextJs = ReadJs 'p90_node_fehlertext.js'

$fehlerQuery = @'
WITH f AS (
    SELECT fehler_text, run_id
    FROM jsonb_to_recordset($p90err${{ $json.fehlerJson }}$p90err$::jsonb)
         AS x(fehler_text text, run_id bigint)
)
UPDATE edoobox_raw.sync_run AS r
SET status      = 'fehler',
    finished_at = now(),
    error_text  = f.fehler_text
FROM f
WHERE r.status = 'laeuft'
  AND (f.run_id IS NULL OR r.run_id = f.run_id)
RETURNING r.run_id, r.status;
'@

$nodes = @(
  [ordered]@{ parameters = @{}; id = 'p90-0001-input'; name = 'P90 Eingang'; type = 'n8n-nodes-base.executeWorkflowTrigger'; typeVersion = 1; position = @(240, 300) },
  [ordered]@{ parameters = @{ jsCode = $konfigJs }; id = 'p90-0002-konfig'; name = 'P90 Konfiguration aufloesen'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(460, 300) },
  [ordered]@{
    parameters = [ordered]@{
      method = 'POST'
      url = 'https://app1.edoobox.com/v2/auth'
      authentication = 'genericCredentialType'
      genericAuthType = 'httpCustomAuth'
      sendHeaders = $true
      headerParameters = [ordered]@{ parameters = @( @{ name = 'grant-type'; value = 'password' }, @{ name = 'Content-Type'; value = 'application/json' } ) }
      sendBody = $true
      contentType = 'json'
      specifyBody = 'keypair'
      bodyParameters = [ordered]@{ parameters = @( @{ name = 'expire'; value = '={{ $now.plus({ hours: 2 }).toISO() }}' } ) }
      options = @{}
    }
    id = 'p90-0003-token'
    name = 'P90 Token holen'
    type = 'n8n-nodes-base.httpRequest'
    typeVersion = 4.2
    position = @(680, 300)
    executeOnce = $true
  },
  [ordered]@{ parameters = @{ jsCode = $holenJs }; id = 'p90-0004-holen'; name = 'P90 Ressource holen'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(900, 300) },
  [ordered]@{ parameters = [ordered]@{ operation = 'executeQuery'; query = '={{ $json.upsertSql }}'; options = @{} }; id = 'p90-0005-speichern'; name = 'P90 Ressource speichern'; type = 'n8n-nodes-base.postgres'; typeVersion = 2.6; position = @(1120, 300) },
  [ordered]@{ parameters = @{ jsCode = $zaehlwerteJs }; id = 'p90-0006-zaehlwerte'; name = 'P90 Zaehlwerte ausgeben'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(1340, 300) },
  [ordered]@{ parameters = [ordered]@{ operation = 'executeQuery'; query = '={{ $json.protokollSql }}'; options = @{} }; id = 'p90-0007-protokoll'; name = 'P90 Protokoll speichern'; type = 'n8n-nodes-base.postgres'; typeVersion = 2.6; position = @(1560, 300) },
  [ordered]@{ parameters = @{}; id = 'p90-0008-fehlertrigger'; name = 'P90 Fehler auffangen'; type = 'n8n-nodes-base.errorTrigger'; typeVersion = 1; position = @(240, 520) },
  [ordered]@{ parameters = @{ jsCode = $fehlertextJs }; id = 'p90-0009-fehlertext'; name = 'P90 Fehlertext aufbereiten'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(460, 520) },
  [ordered]@{ parameters = [ordered]@{ operation = 'executeQuery'; query = $fehlerQuery; options = @{} }; id = 'p90-0010-fehlerlog'; name = 'P90 Fehler protokollieren'; type = 'n8n-nodes-base.postgres'; typeVersion = 2.6; position = @(680, 520) }
)

function Conn($node, $type, $index) { return @{ node = $node; type = $type; index = $index } }

$connections = [ordered]@{
  'P90 Eingang'                = [ordered]@{ main = @( @( (Conn 'P90 Konfiguration aufloesen' 'main' 0) ) ) }
  'P90 Konfiguration aufloesen' = [ordered]@{ main = @( @( (Conn 'P90 Token holen' 'main' 0) ) ) }
  'P90 Token holen'            = [ordered]@{ main = @( @( (Conn 'P90 Ressource holen' 'main' 0) ) ) }
  'P90 Ressource holen'        = [ordered]@{ main = @( @( (Conn 'P90 Ressource speichern' 'main' 0) ) ) }
  'P90 Ressource speichern'    = [ordered]@{ main = @( @( (Conn 'P90 Zaehlwerte ausgeben' 'main' 0) ) ) }
  'P90 Zaehlwerte ausgeben'    = [ordered]@{ main = @( @( (Conn 'P90 Protokoll speichern' 'main' 0) ) ) }
  'P90 Fehler auffangen'       = [ordered]@{ main = @( @( (Conn 'P90 Fehlertext aufbereiten' 'main' 0) ) ) }
  'P90 Fehlertext aufbereiten' = [ordered]@{ main = @( @( (Conn 'P90 Fehler protokollieren' 'main' 0) ) ) }
}

$workflow = [ordered]@{
  name = 'P90 Ressourcen-Unterworkflow'
  nodes = $nodes
  connections = $connections
  pinData = @{}
  settings = [ordered]@{ executionOrder = 'v1' }
  active = $false
  tags = @()
}

$json = $workflow | ConvertTo-Json -Depth 40

# Validierung: laesst sich das erzeugte JSON fehlerfrei zuruecklesen?
$null = $json | ConvertFrom-Json

$out = Join-Path $PWD.Path 'P90 Ressourcen-Unterworkflow.json'
[System.IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ('P90-Workflow geschrieben: ' + $out)
Write-Output ('JSON-Laenge: ' + $json.Length)
