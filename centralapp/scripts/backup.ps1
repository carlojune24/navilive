# Saves a full database backup to centralapp\backups. Restore: pg_restore -U postgres -h localhost -d racecentral --clean <file>
Set-Location (Split-Path $PSScriptRoot -Parent)
$url = (Select-String -Path .env -Pattern '^DATABASE_URL=(.+)$').Matches.Groups[1].Value
if ($url -notmatch '^postgres://([^:]+):([^@]*)@([^:/]+):?(\d*)/(.+)$') { Write-Host 'Cannot read DATABASE_URL from .env' -ForegroundColor Red; exit 1 }
$user, $env:PGPASSWORD, $dbhost, $port, $db = $Matches[1..5]
if (-not $port) { $port = 5432 }
$bin = (Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe' | Sort-Object FullName | Select-Object -Last 1).FullName
New-Item -ItemType Directory -Force backups | Out-Null
$file = "backups\racecentral-$(Get-Date -Format 'yyyyMMdd-HHmmss').dump"
& $bin -U $user -h $dbhost -p $port -Fc $db -f $file
if ($LASTEXITCODE) { Write-Host 'Backup FAILED' -ForegroundColor Red; exit 1 }
Write-Host "Backup saved: $file ($([math]::Round((Get-Item $file).Length/1KB)) KB)"
