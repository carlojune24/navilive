# Lets station laptops and phones on the venue WiFi reach the central app. Run ONCE in an Administrator PowerShell.
param([int]$Port = 3000, [string]$Profile = 'Private')
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Run this in an Administrator PowerShell.' -ForegroundColor Red; exit 1
}
Get-NetFirewallRule -DisplayName 'Race Central' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Race Central' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile $Profile | Out-Null
Write-Host "Allowed inbound TCP $Port on '$Profile' networks."
Get-NetConnectionProfile | ForEach-Object { Write-Host "  Network '$($_.Name)' is $($_.NetworkCategory)" }
Write-Host "If the venue WiFi shows Public, switch it: Set-NetConnectionProfile -Name '<name>' -NetworkCategory Private"
