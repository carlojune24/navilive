# Creates the database named in .env if it is missing, then applies every db\*.sql in order. Safe to re-run (the files are idempotent).
Set-Location (Split-Path $PSScriptRoot -Parent)
$url = (Select-String -Path .env -Pattern '^DATABASE_URL=(.+)$').Matches.Groups[1].Value
if ($url -notmatch '^postgres://([^:]+):([^@]*)@([^:/]+):?(\d*)/(.+)$') { Write-Host 'Cannot read DATABASE_URL from .env' -ForegroundColor Red; exit 1 }
$user, $env:PGPASSWORD, $dbhost, $port, $db = $Matches[1..5]
if (-not $port) { $port = 5432 }
$psql = (Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' | Sort-Object FullName | Select-Object -Last 1).FullName
$conn = '-U', $user, '-h', $dbhost, '-p', $port

$exists = & $psql @conn -d postgres -tAc "select 1 from pg_database where datname='$db'"
if ($LASTEXITCODE) { Write-Host 'Cannot connect to PostgreSQL' -ForegroundColor Red; exit 1 }
if (-not $exists) {
  & $psql @conn -d postgres -c "create database ""$db"""
  if ($LASTEXITCODE) { Write-Host 'Cannot create database' -ForegroundColor Red; exit 1 }
}

foreach ($f in Get-ChildItem db\*.sql | Sort-Object Name) {
  & $psql @conn -d $db -v ON_ERROR_STOP=1 -q -f $f.FullName
  if ($LASTEXITCODE) { Write-Host "FAILED: $($f.Name)" -ForegroundColor Red; exit 1 }
  Write-Host "applied $($f.Name)"
}
Write-Host "Database '$db' is up to date." -ForegroundColor Green
