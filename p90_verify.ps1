$ErrorActionPreference = 'Stop'
$j = Get-Content -Raw -Encoding UTF8 -LiteralPath 'P90 Ressourcen-Unterworkflow.json' | ConvertFrom-Json

Write-Output ("Nodes: " + $j.nodes.Count)
Write-Output ("Connections: " + ($j.connections.PSObject.Properties | Measure-Object).Count)
Write-Output ""
Write-Output "Node-Namen:"
$j.nodes | ForEach-Object { Write-Output ("  - " + $_.name + " (" + $_.type + ")") }

$konfig = ($j.nodes | Where-Object { $_.name -eq 'P90 Konfiguration aufloesen' }).parameters.jsCode
$zaehl  = ($j.nodes | Where-Object { $_.name -eq 'P90 Zaehlwerte ausgeben' }).parameters.jsCode
$holen  = ($j.nodes | Where-Object { $_.name -eq 'P90 Ressource holen' }).parameters.jsCode

Write-Output ""
Write-Output "Ressourcenkennungen in KONFIG (soll 12x vorhanden sein):"
$kennungen = 'edo_admins','edo_dates','edo_offers','edo_bookings','edo_invoices','edo_vat','edo_countries','edo_categories','edo_users','edo_pricecategories','edo_attendances','edo_transactions'
foreach ($k in $kennungen) {
  $found = $konfig.Contains($k)
  Write-Output ("  " + $k + " : " + $found)
}

Write-Output ""
Write-Output ("sync_run_resource im Zaehlwerte-Node: " + $zaehl.Contains('sync_run_resource'))
Write-Output ("protokollSql im Zaehlwerte-Node: " + $zaehl.Contains('protokollSql'))
Write-Output ("NICHT_SPIEGELBAR noch vorhanden: " + $konfig.Contains('NICHT_SPIEGELBAR'))

Write-Output ""
Write-Output "Ableitungen (abgeleitete Tabellen aus Listenressourcen):"
Write-Output ("  Konfig: date_leader        : " + $konfig.Contains('date_leader'))
Write-Output ("  Konfig: booking_position   : " + $konfig.Contains('booking_position'))
Write-Output ("  Konfig: booking_transaction: " + $konfig.Contains('booking_transaction'))
Write-Output ("  Konfig: quelleRoht users   : " + $konfig.Contains("quelleRoht: 'users'"))
Write-Output ("  Konfig: quelleRoht leader  : " + $konfig.Contains("quelleRoht: 'leader'"))
Write-Output ("  Holen:  ableitungsCtes     : " + $holen.Contains('ableitungsCtes'))
Write-Output ("  Holen:  jsonb_array_elements_text : " + $holen.Contains('jsonb_array_elements_text'))
Write-Output ("  Holen:  jsonb_to_recordset (users) : " + $holen.Contains('jsonb_to_recordset'))
Write-Output ("  Holen:  pricecategory-JOIN  : " + $holen.Contains('edoobox_raw.pricecategory'))
Write-Output ("  Holen:  date_leader-UPSERT  : " + $holen.Contains('date_leader'))
Write-Output ("  Holen:  booking_transaction-UPSERT : " + $holen.Contains('booking_transaction'))
