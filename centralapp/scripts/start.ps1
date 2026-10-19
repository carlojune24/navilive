# Starts the central app for the event. Run from the centralapp folder: .\scripts\start.ps1
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path .env)) { Write-Host 'Missing .env (see README).' -ForegroundColor Red; exit 1 }
if ((Select-String -Path .env -Pattern '^ADMIN_PASSWORD=change-me$' -Quiet)) {
  Write-Host 'WARNING: admin password is still "change-me". Edit .env first.' -ForegroundColor Yellow
}
if (-not (Test-Path build\index.js)) { npm run build; if ($LASTEXITCODE) { exit 1 } }
$port = ((Select-String -Path .env -Pattern '^PORT=(\d+)').Matches.Groups[1].Value); if (-not $port) { $port = 3000 }
Write-Host "`nAdmin (on this laptop):   http://localhost:$port/admin"
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' } | ForEach-Object {
  Write-Host "Stations / live board:    http://$($_.IPAddress):$port   ($($_.InterfaceAlias))"
}
Write-Host "`nCtrl+C to stop.`n"
node --env-file=.env build
