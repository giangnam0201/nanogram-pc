<#
  Runs Nanogram PC locally in web mode — the same target Vercel serves, and the
  one the Multi-Creator work is aimed at (phone + browser).

  It installs dependencies on first run, then starts the Vite dev server bound to
  every interface so you can open the same session on your phone over Wi-Fi.

  Usage:
    .\run-local.ps1              # dev server, hot reload
    .\run-local.ps1 -Build       # production build, then preview it
    .\run-local.ps1 -Port 5183   # override the port
#>

[CmdletBinding()]
param(
  [switch]$Build,
  [int]$Port = 5183
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Info($m) { Write-Host "  $m" -ForegroundColor DarkGray }
function Ok($m)   { Write-Host "  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }

Write-Host ""
Write-Host "  Nanogram PC - local web" -ForegroundColor Cyan
Write-Host "  -----------------------" -ForegroundColor Cyan

# --- node ------------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Warn "Node.js is not on PATH. Install Node 22+ from https://nodejs.org and re-run."
  exit 1
}
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 22) {
  Warn "Node $(node -v) found; this project needs 22 or newer."
  exit 1
}
Info "node $(node -v)"

# --- dependencies ----------------------------------------------------------
if (-not (Test-Path 'node_modules')) {
  Info "node_modules missing - installing (first run, takes a minute)..."
  if (Test-Path 'package-lock.json') { npm ci } else { npm install }
  if ($LASTEXITCODE -ne 0) { Warn "Dependency install failed."; exit 1 }
  Ok "dependencies installed"
} else {
  Info "dependencies present"
}

# --- build + preview -------------------------------------------------------
if ($Build) {
  Info "building web bundle..."
  npm run build:web
  if ($LASTEXITCODE -ne 0) { Warn "Build failed."; exit 1 }
  Ok "built to dist/"
  Warn "Note: 'preview' serves static files only - /api/* edge functions do NOT run,"
  Warn "so CDN images and game frames will 404. Use the dev server for those."
  npx vite preview --port $Port --host
  exit $LASTEXITCODE
}

# --- LAN address for phone testing ----------------------------------------
# Virtual adapters (Hyper-V, VirtualBox, WSL, Docker, Tailscale/CGNAT 100.64/10)
# all hand out addresses your phone cannot reach, and they often win on metric.
# Prefer a genuine RFC1918 address on a physical Wi-Fi/Ethernet adapter.
function Get-LanCandidates {
  $ifaces = @{}
  Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
    Where-Object Status -eq 'Up' |
    ForEach-Object { $ifaces[$_.ifIndex] = $_.Name }

  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $ip = $_.IPAddress
      ($ip -like '192.168.*' -or $ip -like '10.*' -or $ip -match '^172\.(1[6-9]|2[0-9]|3[01])\.') -and
      $ifaces.ContainsKey($_.InterfaceIndex)
    } |
    Sort-Object InterfaceMetric |
    ForEach-Object {
      [pscustomobject]@{ IP = $_.IPAddress; Adapter = $ifaces[$_.InterfaceIndex] }
    }
}

$candidates = @(Get-LanCandidates)
$lan = if ($candidates.Count) { $candidates[0].IP } else { $null }

Write-Host ""
Ok "starting dev server (api/* edge functions served too)"
Info "desktop:  http://localhost:$Port"
if ($lan) {
  Info "phone:    http://${lan}:$Port   (via $($candidates[0].Adapter))"
  foreach ($c in $candidates | Select-Object -Skip 1) {
    Info "          http://$($c.IP):$Port   (or try $($c.Adapter))"
  }
  Info "If the phone cannot connect, allow node.exe through Windows Firewall on private networks."
} else {
  Warn "no reachable LAN address found - phone testing unavailable on this network"
}
Info "Ctrl+C to stop."
Write-Host ""

npx vite --mode web --port $Port --host
exit $LASTEXITCODE
