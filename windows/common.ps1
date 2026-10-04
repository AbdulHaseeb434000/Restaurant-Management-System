# Shared paths and helpers for the Windows install / start / stop scripts.
# Everything the app needs lives under <app folder>\runtime - nothing is installed system-wide.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest much faster
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root      = Split-Path -Parent $PSScriptRoot
$Runtime   = Join-Path $Root 'runtime'
$Logs      = Join-Path $Runtime 'logs'
$NodeDir   = Join-Path $Runtime 'node'
$NodeExe   = Join-Path $NodeDir 'node.exe'
$UvExe     = Join-Path $Runtime 'uv\uv.exe'
$PgDir     = Join-Path $Runtime 'pgsql'
$PgBin     = Join-Path $PgDir 'bin'
$PgData    = Join-Path $Runtime 'pgdata'
$Venv      = Join-Path $Runtime 'venv'
$PythonExe = Join-Path $Venv 'Scripts\python.exe'
$Backend   = Join-Path $Root 'backend'
$Frontend  = Join-Path $Root 'frontend'
$EnvFile   = Join-Path $Backend '.env'

$PgPort       = 5433
$BackendPort  = 8111
$FrontendPort = 3111

function Write-Step([string]$text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Ok([string]$text) { Write-Host "    $text" -ForegroundColor Green }
function Write-Warn2([string]$text) { Write-Host "    $text" -ForegroundColor Yellow }

function Ensure-Dir([string]$path) {
    if (-not (Test-Path $path)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
}

function Download-File([string]$url, [string]$out) {
    Write-Host "    downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
}

# Run a native program without letting its stderr output abort the script
# (Windows PowerShell 5.1 turns redirected stderr into terminating errors under 'Stop').
function Invoke-Native([string]$exe, [string[]]$arguments) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $exe @arguments *> $null } catch { } finally { $ErrorActionPreference = $old }
    return $LASTEXITCODE
}

# Start a long-running program in its own hidden console so it keeps running after this window
# closes; output goes to a log file. Returns the process id (of the cmd.exe wrapper).
function Start-Detached([string]$exe, [string]$arguments, [string]$workDir, [string]$logFile) {
    $cmdLine = "/c `"`"$exe`" $arguments > `"$logFile`" 2>&1`""
    $p = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList $cmdLine `
        -WorkingDirectory $workDir -WindowStyle Hidden -PassThru
    return $p.Id
}

function Test-PortListening([int]$port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        $ok = $async.AsyncWaitHandle.WaitOne(500)
        if ($ok) { $client.EndConnect($async) }
        return $ok -and $client.Connected
    } catch { return $false } finally { $client.Close() }
}

function Wait-Url([string]$url, [int]$seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Read-EnvValue([string]$key) {
    if (-not (Test-Path $EnvFile)) { return $null }
    foreach ($line in Get-Content $EnvFile) {
        if ($line -match "^\s*$key\s*=\s*(.*)$") { return $Matches[1].Trim() }
    }
    return $null
}

function Get-DbPassword {
    # DATABASE_URL=postgresql+psycopg2://postgres:<password>@127.0.0.1:5433/restaurant
    $url = Read-EnvValue 'DATABASE_URL'
    if ($url -and $url -match '://[^:]+:([^@]+)@') { return $Matches[1] }
    return $null
}

function Test-PgRunning {
    if (-not (Test-Path (Join-Path $PgData 'PG_VERSION'))) { return $false }
    return ((Invoke-Native (Join-Path $PgBin 'pg_ctl.exe') @('-D', $PgData, 'status')) -eq 0)
}

function Start-Postgres {
    if (Test-PgRunning) { return }
    Ensure-Dir $Logs
    $opts = "-p $PgPort -c listen_addresses=127.0.0.1"
    $code = Invoke-Native (Join-Path $PgBin 'pg_ctl.exe') @('-D', $PgData, '-l', (Join-Path $Logs 'postgres.log'), '-o', $opts, '-w', '-t', '60', 'start')
    if ($code -ne 0) { throw "PostgreSQL did not start. See $Logs\postgres.log" }
}

function Stop-Postgres {
    if (Test-Path (Join-Path $PgBin 'pg_ctl.exe')) {
        if (Test-PgRunning) { [void](Invoke-Native (Join-Path $PgBin 'pg_ctl.exe') @('-D', $PgData, '-m', 'fast', '-w', 'stop')) }
    }
}

function New-RandomSecret([int]$length) {
    $chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'.ToCharArray()
    $bytes = New-Object byte[] $length
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Get-LanAddresses {
    try {
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
            Select-Object -ExpandProperty IPAddress
    } catch { @() }
}
