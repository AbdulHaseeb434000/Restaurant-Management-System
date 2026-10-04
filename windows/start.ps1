# Starts PostgreSQL, the backend and the frontend in the background, then opens the browser.
param([switch]$NoBrowser)

. (Join-Path $PSScriptRoot 'common.ps1')

if (-not (Test-Path $PythonExe) -or -not (Test-Path (Join-Path $Frontend '.next\BUILD_ID'))) {
    Write-Host "The app is not installed yet. Run INSTALL-Windows.bat first." -ForegroundColor Red
    exit 1
}
Ensure-Dir $Logs
$url = "http://localhost:$FrontendPort"

Write-Step "Database"
Start-Postgres
Write-Ok "PostgreSQL running on port $PgPort"

Write-Step "Backend (API)"
if (Test-PortListening $BackendPort) {
    Write-Ok "already running on port $BackendPort"
} else {
    $procId = Start-Detached $PythonExe "-m uvicorn app.main:app --host 127.0.0.1 --port $BackendPort" $Backend (Join-Path $Logs 'backend.log')
    Set-Content -Path (Join-Path $Runtime 'backend.pid') -Value $procId
    if (-not (Wait-Url "http://127.0.0.1:$BackendPort/api/health" 120)) {
        Write-Host "Backend did not start. Last log lines:" -ForegroundColor Red
        Get-Content (Join-Path $Logs 'backend.log') -Tail 25
        exit 1
    }
    Write-Ok "started on port $BackendPort"
}

Write-Step "Frontend (web app)"
if (Test-PortListening $FrontendPort) {
    Write-Ok "already running on port $FrontendPort"
} else {
    # 0.0.0.0 lets tablets/phones on the same network use the app too
    $next = Join-Path $Frontend 'node_modules\next\dist\bin\next'
    $procId = Start-Detached $NodeExe "`"$next`" start -p $FrontendPort -H 0.0.0.0" $Frontend (Join-Path $Logs 'frontend.log')
    Set-Content -Path (Join-Path $Runtime 'frontend.pid') -Value $procId
    if (-not (Wait-Url "http://127.0.0.1:$FrontendPort/login" 90)) {
        Write-Host "Frontend did not start. Last log lines:" -ForegroundColor Red
        Get-Content (Join-Path $Logs 'frontend.log') -Tail 25
        exit 1
    }
    Write-Ok "started on port $FrontendPort"
}

Write-Host ""
Write-Host "  Restaurant Manager is running:  $url" -ForegroundColor Green
foreach ($ip in Get-LanAddresses) { Write-Host "  Other devices on this network:  http://${ip}:$FrontendPort" }
Write-Host "  Logs: $Logs"
Write-Host "  To stop it, use the 'Stop Restaurant Manager' shortcut (or STOP-Windows.bat)."
if (-not $NoBrowser) { Start-Process $url }
