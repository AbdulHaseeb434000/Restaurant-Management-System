# Stops the frontend, backend and database started by start.ps1.
. (Join-Path $PSScriptRoot 'common.ps1')

function Stop-ByPidFile([string]$name) {
    $file = Join-Path $Runtime "$name.pid"
    if (Test-Path $file) {
        $procId = [int](Get-Content $file | Select-Object -First 1)
        # /T also ends child processes
        [void](Invoke-Native 'taskkill.exe' @('/PID', "$procId", '/T', '/F'))
        Remove-Item $file -Force
    }
}

function Stop-ByPort([int]$port) {
    try {
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
            ForEach-Object { [void](Invoke-Native 'taskkill.exe' @('/PID', "$($_.OwningProcess)", '/T', '/F')) }
    } catch { }
}

Write-Step "Stopping Restaurant Manager"
Stop-ByPidFile 'frontend'
Stop-ByPidFile 'backend'
Stop-ByPort $FrontendPort
Stop-ByPort $BackendPort
Stop-Postgres
Write-Ok "stopped"
