# Starts the website's server (web\scripts\serve.mjs) and keeps it running (supervisor loop).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\run-server.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\run-server.ps1 -CheckOnly
#
# This is what the HungaryElectionsSite scheduled task on Server-PC runs at boot (as Oliver, S4U).
# Under the task there is no console and no desktop, so every step is written to
# logs\bootstrap.log before Node is launched; the server's own output goes to logs\server.log
# and logs\server.err.log. Paths are derived from this script's location.
#
# The server listens on 127.0.0.1:1235 only; Caddy publishes it as
# https://hungary.enideszk.duckdns.org. If it exits, it is restarted after a delay that grows
# (up to 60 s) while it keeps failing quickly. Stop it with
#   Stop-ScheduledTask -TaskName HungaryElectionsSite; Get-Process node | Where-Object Path ...
# (stopping the task ends this script; end the node.exe it started as well).

param(
    # Only verify that everything needed is present, then exit.
    [switch]$CheckOnly,
    [int]$Port = 1235
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$web = Join-Path $repo 'web'
$logDir = Join-Path $repo 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$bootLog = Join-Path $logDir 'bootstrap.log'

function Say([string]$msg) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    try { Add-Content -LiteralPath $bootLog -Value $line -Encoding UTF8 } catch { }
    Write-Output $line
}

# Keep the logs from growing forever.
foreach ($log in @($bootLog, (Join-Path $logDir 'server.log'), (Join-Path $logDir 'server.err.log'))) {
    try {
        if ((Get-Item -LiteralPath $log -ErrorAction Stop).Length -gt 5MB) { Move-Item -LiteralPath $log -Destination "$log.1" -Force }
    } catch { }
}

Say '==================== run-server.ps1 ===================='
Say ('running as : ' + [Security.Principal.WindowsIdentity]::GetCurrent().Name)
Say ('repository : ' + $repo)

$node = $null
foreach ($candidate in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { $node = $candidate; break }
}
if (-not $node) { $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
if (-not $node) {
    Say 'FATAL: node.exe not found (install Node.js 18 or newer).'
    exit 3
}
Say ('node       : ' + $node)

$serve = Join-Path $web 'scripts\serve.mjs'
& $node $serve --check 2>&1 | ForEach-Object { Say ('check      : ' + $_) }
if ($LASTEXITCODE -ne 0) {
    Say 'FATAL: build or data missing: run `npm run build` in web\ and `.\etl export`.'
    exit 4
}
if ($CheckOnly) {
    Say 'CheckOnly: everything needed is present. Not launching.'
    exit 0
}

$stdout = Join-Path $logDir 'server.log'
$stderr = Join-Path $logDir 'server.err.log'
$env:PORT = "$Port"
$env:HOST = '127.0.0.1'
$delay = 2

while ($true) {
    $started = Get-Date
    Say "starting server on 127.0.0.1:$Port"
    try {
        $proc = Start-Process -FilePath $node -ArgumentList @("`"$serve`"") -WorkingDirectory $web -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $null = $proc.Handle   # cache the handle now, or ExitCode stays empty after exit
        $proc.WaitForExit()
        $code = $proc.ExitCode
    } catch {
        $code = -1
        Say ('could not start node: ' + $_.Exception.Message)
    }
    $ran = [int]((Get-Date) - $started).TotalSeconds
    Say "server exited with code $code after $ran s (see logs\server.err.log)"
    if ($ran -ge 120) { $delay = 2 } else { $delay = [Math]::Min($delay * 2, 60) }
    Say "restarting in $delay s"
    Start-Sleep -Seconds $delay
}
