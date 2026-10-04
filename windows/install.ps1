# One-time installer (safe to run again: it repairs/updates and never deletes your data).
param([switch]$Unattended)

. (Join-Path $PSScriptRoot 'common.ps1')

$NodeVersion = 'v22.22.0'
# Tried in order until one downloads (the newest builds are listed first).
$PgVersions = @('16.10-1', '16.9-1', '16.8-1', '16.6-1', '16.4-1')

function Ask([string]$question, [string]$default) {
    if ($Unattended) { return $default }
    $answer = Read-Host "$question [$default]"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $default }
    return $answer.Trim()
}

Write-Host ""
Write-Host "  Restaurant Management System - Windows installer" -ForegroundColor White
Write-Host "  Install folder: $Root"
Write-Host "  Needs an internet connection (about 250 MB download the first time)."

if ((Test-PortListening $BackendPort) -or (Test-PortListening $FrontendPort)) {
    Write-Step "The app is running - stopping it before updating"
    & (Join-Path $PSScriptRoot 'stop.ps1')
}

Ensure-Dir $Runtime
Ensure-Dir $Logs
$Tmp = Join-Path $Runtime 'tmp'
Ensure-Dir $Tmp

try {
    # ------------------------------------------------------------------ Node.js
    Write-Step "Node.js $NodeVersion"
    if (-not (Test-Path $NodeExe)) {
        $zip = Join-Path $Tmp 'node.zip'
        Download-File "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip" $zip
        Expand-Archive -Path $zip -DestinationPath $Tmp -Force
        if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
        Move-Item (Join-Path $Tmp "node-$NodeVersion-win-x64") $NodeDir
    }
    Write-Ok "node $(& $NodeExe --version)"

    # ------------------------------------------------------------------ uv (manages Python)
    Write-Step "Python tooling (uv)"
    if (-not (Test-Path $UvExe)) {
        $zip = Join-Path $Tmp 'uv.zip'
        Download-File 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' $zip
        Ensure-Dir (Split-Path $UvExe)
        Expand-Archive -Path $zip -DestinationPath (Split-Path $UvExe) -Force
    }
    Write-Ok (& $UvExe --version)

    # ------------------------------------------------------------------ PostgreSQL (portable)
    Write-Step "PostgreSQL 16 (portable, port $PgPort)"
    if (-not (Test-Path (Join-Path $PgBin 'pg_ctl.exe'))) {
        $zip = Join-Path $Tmp 'pgsql.zip'
        $got = $false
        foreach ($v in $PgVersions) {
            try {
                Download-File "https://get.enterprisedb.com/postgresql/postgresql-$v-windows-x64-binaries.zip" $zip
                $got = $true
                break
            } catch { Write-Warn2 "version $v not available, trying the next one" }
        }
        if (-not $got) { throw "Could not download PostgreSQL binaries from get.enterprisedb.com" }
        Expand-Archive -Path $zip -DestinationPath $Runtime -Force   # creates runtime\pgsql
    }
    if ((Invoke-Native (Join-Path $PgBin 'initdb.exe') @('--version')) -ne 0) {
        Write-Warn2 "PostgreSQL needs the Microsoft Visual C++ runtime - installing it (Windows may ask for permission)"
        $vc = Join-Path $Tmp 'vc_redist.x64.exe'
        Download-File 'https://aka.ms/vs/17/release/vc_redist.x64.exe' $vc
        Start-Process -FilePath $vc -ArgumentList '/install', '/quiet', '/norestart' -Verb RunAs -Wait
    }
    Write-Ok (& (Join-Path $PgBin 'postgres.exe') --version)

    # ------------------------------------------------------------------ configuration (.env)
    Write-Step "Configuration"
    $dbPassword = Get-DbPassword
    if (-not (Test-Path $EnvFile)) {
        $dbPassword = New-RandomSecret 24
        $tz = Ask 'Business timezone (IANA name, e.g. Asia/Karachi, Asia/Dubai, Europe/London)' 'Asia/Karachi'
        $demo = Ask 'Load DEMO data (sample menu, tables and 30 days of history)? y/n' 'n'
        $adminPw = Ask 'Password for the first "admin" login' 'admin123'
        $seed = 'false'
        if ($demo -match '^[yY]') { $seed = 'true' }
        $backupDir = Join-Path $Root 'backups'
        $lines = @(
            "DATABASE_URL=postgresql+psycopg2://postgres:$dbPassword@127.0.0.1:$PgPort/restaurant",
            "SECRET_KEY=$(New-RandomSecret 48)",
            "TIMEZONE=$tz",
            "SEED_DEMO_DATA=$seed",
            "ADMIN_USERNAME=admin",
            "ADMIN_PASSWORD=$adminPw",
            "CORS_ORIGINS=http://localhost:$FrontendPort",
            "BACKUP_DIR=$backupDir",
            "BACKUP_INTERVAL_HOURS=24",
            "BACKUP_KEEP=14"
        )
        # UTF-8 without BOM so python-dotenv reads the first key correctly
        [IO.File]::WriteAllLines($EnvFile, $lines, (New-Object Text.UTF8Encoding $false))
        Write-Ok "created backend\.env"
    } else {
        Write-Ok "keeping existing backend\.env"
    }
    if (-not $dbPassword) { throw "backend\.env exists but has no PostgreSQL password in DATABASE_URL. Fix or delete backend\.env and run the installer again." }

    # ------------------------------------------------------------------ database
    Write-Step "Database"
    if (-not (Test-Path (Join-Path $PgData 'PG_VERSION'))) {
        $pwFile = Join-Path $Tmp 'pw.txt'
        [IO.File]::WriteAllText($pwFile, $dbPassword)
        & (Join-Path $PgBin 'initdb.exe') -D $PgData -U postgres -E UTF8 --locale=C --auth=scram-sha-256 --pwfile=$pwFile | Out-Null
        Remove-Item $pwFile -Force
        if ($LASTEXITCODE -ne 0) { throw "initdb failed" }
        Write-Ok "created data folder runtime\pgdata"
    } else {
        Write-Ok "keeping existing data in runtime\pgdata"
    }
    Start-Postgres
    $env:PGPASSWORD = $dbPassword
    $exists = & (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -p $PgPort -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='restaurant'"
    if ($exists -ne '1') {
        & (Join-Path $PgBin 'createdb.exe') -h 127.0.0.1 -p $PgPort -U postgres restaurant
        if ($LASTEXITCODE -ne 0) { throw "createdb failed" }
        Write-Ok "created database 'restaurant'"
    } else {
        Write-Ok "database 'restaurant' already exists"
    }

    # ------------------------------------------------------------------ backend (Python)
    Write-Step "Backend (Python packages)"
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $Runtime 'python'
    if (-not (Test-Path $PythonExe)) {
        & $UvExe venv $Venv --python 3.12
        if ($LASTEXITCODE -ne 0) { throw "could not create the Python environment" }
    }
    & $UvExe pip install --python $PythonExe -r (Join-Path $Backend 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
    Write-Ok "backend ready"

    # ------------------------------------------------------------------ frontend (Next.js build)
    Write-Step "Frontend (npm install + production build, takes a few minutes)"
    $env:Path = "$NodeDir;$env:Path"
    $env:NEXT_TELEMETRY_DISABLED = '1'
    $env:BACKEND_URL = "http://127.0.0.1:$BackendPort"
    Push-Location $Frontend
    try {
        & (Join-Path $NodeDir 'npm.cmd') ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
        & (Join-Path $NodeDir 'npm.cmd') run build
        if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
    } finally { Pop-Location }
    Write-Ok "frontend built"

    # ------------------------------------------------------------------ shortcuts
    Write-Step "Shortcuts"
    $shell = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath('Desktop')
    foreach ($s in @(@('Restaurant Manager', 'START-Windows.bat', 'Start the restaurant app'),
                     @('Stop Restaurant Manager', 'STOP-Windows.bat', 'Stop the restaurant app'))) {
        $lnk = $shell.CreateShortcut((Join-Path $desktop "$($s[0]).lnk"))
        $lnk.TargetPath = Join-Path $Root $s[1]
        $lnk.WorkingDirectory = $Root
        $lnk.Description = $s[2]
        $lnk.IconLocation = "$env:SystemRoot\System32\shell32.dll,43"
        $lnk.Save()
    }
    Write-Ok "desktop shortcuts created"
    $auto = Ask 'Start the app automatically when Windows starts? y/n' 'n'
    $startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Restaurant Manager.lnk'
    if ($auto -match '^[yY]') {
        $lnk = $shell.CreateShortcut($startup)
        $lnk.TargetPath = Join-Path $Root 'START-Windows.bat'
        $lnk.Arguments = '/nobrowser'
        $lnk.WorkingDirectory = $Root
        $lnk.WindowStyle = 7
        $lnk.Save()
        Write-Ok "added to Windows startup"
    } elseif (Test-Path $startup) {
        Remove-Item $startup -Force
    }
}
finally {
    Stop-Postgres
    if (Test-Path $Tmp) { Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ""
Write-Host "  Installation complete." -ForegroundColor Green
Write-Host "  Start the app with the 'Restaurant Manager' desktop shortcut (or START-Windows.bat)."
Write-Host "  Sign in as: admin  (password you chose, default admin123) - change it under Settings."
