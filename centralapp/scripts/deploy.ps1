# Deploys Race Central to the OVH server in one command:  npm run deploy   (or .\scripts\deploy.ps1)
#
#   1. checks types and runs the tests          (skip with -Quick)
#   2. builds with the public address baked in
#   3. uploads the build, backs up the database, applies db\*.sql, restarts, health-checks
#   4. rolls back to the previous build automatically if the new one does not start
#
# Password: ssh asks for it (twice). Nothing is stored. For no prompts at all, run scripts\setup-ssh-key.ps1 once.
# Database changes must be idempotent (create ... if not exists, add column if not exists): every db\*.sql file runs on every deploy.
param(
  [string]$Server = 'ubuntu@51.79.159.222',
  [string]$PublicUrl = 'https://navilive.duckdns.org',
  [string]$AppDir = '/home/ubuntu/apps/race-central',
  [switch]$Quick
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Step($n) { Write-Host "`n== $n" -ForegroundColor Cyan }
function Run($what, [scriptblock]$cmd) {
  # Windows PowerShell 5.1 turns a program's warnings on stderr into errors; only the exit code matters here
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & $cmd
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($code) { Write-Host "FAILED: $what (exit $code)." -ForegroundColor Red; exit 1 }
}
foreach ($tool in 'ssh', 'scp', 'tar', 'npm') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Write-Host "Missing '$tool' on this computer." -ForegroundColor Red; exit 1 }
}
$sshOpts = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=15')

if (-not $Quick) {
  Step 'Checking types and running tests'
  Run 'type check' { npm run check *> $null }
  Run 'tests' { npx vitest run 2>&1 | Select-Object -Last 4 }
}

Step "Building for $PublicUrl"
$env:PUBLIC_URL = $PublicUrl
if (Test-Path build) { Remove-Item -Recurse -Force build }
Run 'build' { npm run build *> $null }
if (-not (Test-Path build\index.js)) { Write-Host 'Build produced no build\index.js' -ForegroundColor Red; exit 1 }

Step 'Packing (no secrets: .env is never included)'
$pack = Join-Path $env:TEMP 'race-central-deploy.tar.gz'
if (Test-Path $pack) { Remove-Item $pack }
Run 'pack' { tar -czf $pack build package.json package-lock.json db scripts }
Write-Host ("  {0:N0} KB" -f ((Get-Item $pack).Length / 1KB))

Step "Uploading to $Server (enter the server password if asked)"
Run 'upload' { scp @sshOpts $pack "${Server}:race-central-deploy.tar.gz" }

Step 'Installing on the server'
# scripts/remote-deploy.sh is read straight out of the uploaded package and run there (no script text is piped through PowerShell)
Run 'server install' { ssh @sshOpts $Server "tar -xzOf ~/race-central-deploy.tar.gz scripts/remote-deploy.sh | APP_DIR=$AppDir bash -s" }

Step 'Checking the public site'
$resp = Invoke-WebRequest -Uri "$PublicUrl/login" -UseBasicParsing -TimeoutSec 30
if ($resp.StatusCode -ne 200) { Write-Host "Public site answered $($resp.StatusCode)" -ForegroundColor Red; exit 1 }
Write-Host "`nDeployed. $PublicUrl is serving the new version." -ForegroundColor Green
