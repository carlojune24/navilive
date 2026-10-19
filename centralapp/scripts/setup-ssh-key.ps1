# One-time: lets deploy.ps1 log in without typing the server password (and lets you turn password login off later).
# Creates an SSH key on THIS computer and adds its public half to the server's authorized keys.
# You are asked for the server password once. The private key never leaves this computer.
param([string]$Server = 'ubuntu@51.79.159.222')
$ErrorActionPreference = 'Stop'
$key = Join-Path $HOME '.ssh\id_ed25519'
if (-not (Test-Path "$key.pub")) {
  New-Item -ItemType Directory -Force (Split-Path $key) | Out-Null
  ssh-keygen -t ed25519 -f $key -N '""' -C "race-central-deploy@$env:COMPUTERNAME"
  if ($LASTEXITCODE) { exit 1 }
} else {
  Write-Host "Using the existing key $key.pub"
}
$pub = (Get-Content "$key.pub" -Raw).Trim()
# append only if it is not already there
$remote = "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && (grep -qxF '$pub' ~/.ssh/authorized_keys || echo '$pub' >> ~/.ssh/authorized_keys) && echo 'key installed'"
ssh -o StrictHostKeyChecking=accept-new $Server $remote
if ($LASTEXITCODE) { Write-Host 'Failed to install the key.' -ForegroundColor Red; exit 1 }
Write-Host "`nTesting a login with no password..."
ssh -o BatchMode=yes -o PasswordAuthentication=no $Server 'echo "key login works"'
if ($LASTEXITCODE) { Write-Host 'Key login did not work yet.' -ForegroundColor Red; exit 1 }
