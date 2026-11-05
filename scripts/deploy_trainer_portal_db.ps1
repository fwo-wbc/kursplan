# =============================================================================
# Führt das Remote-Setup für das Trainer-Portal über SSH aus
# (Muster: scripts/deploy_header_verify.ps1).
# Nutzung:
#   powershell -ExecutionPolicy Bypass -File scripts\deploy_trainer_portal_db.ps1
# =============================================================================
$ErrorActionPreference = 'Stop'

$scriptFile = Join-Path $PSScriptRoot 'portal_db_setup_remote.sh'
if (-not (Test-Path $scriptFile)) {
  throw "Fehlendes Skript: $scriptFile"
}

$content = Get-Content -Raw -Path $scriptFile
$content = $content -replace "`r`n", "`n"
$bytes = [Text.Encoding]::UTF8.GetBytes($content)
$b64 = [Convert]::ToBase64String($bytes)

ssh -o BatchMode=yes root@46.62.206.211 "echo $b64 | base64 -d | bash"
if ($LASTEXITCODE -ne 0) {
  throw "Remote-Setup fehlgeschlagen (Exit $LASTEXITCODE)"
}
