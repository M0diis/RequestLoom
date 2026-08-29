#!/usr/bin/env pwsh
<#
.SYNOPSIS
  RequestLoom dev launcher for Windows (native PowerShell).
.DESCRIPTION
  Start/stop/restart/status for the .NET backend and Vite frontend.
  Kills conflicting port holders automatically.
.PARAMETER Action
  One of: start, stop, restart, status
.EXAMPLE
  .\scripts\dev.ps1 start
  .\scripts\dev.ps1 stop
  .\scripts\dev.ps1 status
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "restart", "status")]
    [string]$Action = ""
)

$ErrorActionPreference = "Stop"

$ROOT_DIR = Split-Path -Parent $PSScriptRoot
$BACKEND_DIR = Join-Path $ROOT_DIR "backend"
$FRONTEND_DIR = Join-Path $ROOT_DIR "frontend"
$LOG_DIR = Join-Path $ROOT_DIR ".dev-logs"
$PID_DIR = Join-Path $ROOT_DIR ".dev-pids"

$BACKEND_PID_FILE = Join-Path $PID_DIR "backend.pid"
$FRONTEND_PID_FILE = Join-Path $PID_DIR "frontend.pid"
$BACKEND_LOG = Join-Path $LOG_DIR "backend.log"
$FRONTEND_LOG = Join-Path $LOG_DIR "frontend.log"
$STDIN_FILE = Join-Path $LOG_DIR "dev-stdin.txt"

$BACKEND_PORT = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "5056" }
$FRONTEND_PORT = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "5173" }

$DOTNET_HOME = if ($env:DOTNET_ROOT) { $env:DOTNET_ROOT } else { Join-Path $env:USERPROFILE ".dotnet" }
if (Test-Path $DOTNET_HOME) {
    $env:PATH = "$DOTNET_HOME;$env:PATH"
}
if (-not $env:DOTNET_ROOT) {
    $env:DOTNET_ROOT = $DOTNET_HOME
}
if (-not $env:DOTNET_SYSTEM_GLOBALIZATION_INVARIANT) {
    $env:DOTNET_SYSTEM_GLOBALIZATION_INVARIANT = "1"
}

function Write-Usage {
    @"
Usage: dev.ps1 <start|stop|restart|status>

Commands:
  start    Start backend and frontend (kills conflicting ports when needed)
  stop     Stop backend and frontend
  restart  Stop then start both services
  status   Show PID/port status

Environment variables:
  BACKEND_PORT   Backend port (default: 5056)
  FRONTEND_PORT  Frontend Vite port (default: 5173)
  DOTNET_ROOT    Path to .NET installation (default: %USERPROFILE%\.dotnet)
"@ | Write-Host
}

function Test-PidRunning {
    param([int]$ProcId)
    if ($ProcId -le 0) { return $false }
    try {
        $p = Get-Process -Id $ProcId -ErrorAction Stop
        return (-not $p.HasExited)
    } catch {
        return $false
    }
}

function Read-PidFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return 0 }
    $raw = (Get-Content -Path $Path -Raw).Trim()
    $id = 0
    if ([int]::TryParse($raw, [ref]$id)) { return $id }
    return 0
}

function Get-PidsOnPort {
    param([int]$Port)
    $pids = @()
    $lines = & netstat -ano 2>$null | Select-String ":$Port " | Select-String "LISTENING"
    foreach ($line in $lines) {
        $parts = -split $line
        $last = $parts[-1]
        $id = 0
        if ([int]::TryParse($last, [ref]$id) -and $id -gt 0) {
            $pids += $id
        }
    }
    return ($pids | Sort-Object -Unique)
}

function Stop-Port {
    param([int]$Port, [string]$Label)
    $pids = Get-PidsOnPort $Port
    if ($pids.Count -eq 0) { return }
    Write-Host "Port $Port is in use; killing process(es) for $Label..."
    foreach ($id in $pids) {
        try { Stop-Process -Id $id -Force -ErrorAction Stop } catch {}
    }
    Start-Sleep -Milliseconds 500
}

function Stop-ProcessGracefully {
    param([int]$ProcId, [string]$Name)
    if (-not (Test-PidRunning $ProcId)) { return }
    Write-Host "Stopping $Name (PID $ProcId)..."
    try { Stop-Process -Id $ProcId -ErrorAction Stop } catch {}
    for ($i = 0; $i -lt 20; $i++) {
        if (-not (Test-PidRunning $ProcId)) { break }
        Start-Sleep -Milliseconds 100
    }
    if (Test-PidRunning $ProcId) {
        Write-Host "Force killing $Name (PID $ProcId)..."
        try { Stop-Process -Id $ProcId -Force -ErrorAction Stop } catch {}
    }
}

function Start-Backend {
    $pidVal = Read-PidFile $BACKEND_PID_FILE
    if (($pidVal -gt 0) -and (Test-PidRunning $pidVal)) {
        Write-Host "Backend already running (PID $pidVal)."
        return
    }
    Stop-Port -Port $BACKEND_PORT -Label "backend"

    Write-Host "Starting backend on http://localhost:${BACKEND_PORT} ..."
    $env:ASPNETCORE_URLS = "http://localhost:$BACKEND_PORT"

    $proc = Start-Process -FilePath "dotnet" `
        -ArgumentList "run" `
        -WorkingDirectory $BACKEND_DIR `
        -RedirectStandardOutput $BACKEND_LOG `
        -RedirectStandardError (Join-Path $LOG_DIR "backend-error.log") `
        -RedirectStandardInput $STDIN_FILE `
        -WindowStyle Hidden `
        -PassThru

    $proc.Id | Out-File -FilePath $BACKEND_PID_FILE -NoNewline

    if (Test-PidRunning $proc.Id) {
        Write-Host "Backend started (PID $($proc.Id)). Log: $BACKEND_LOG"
    } else {
        Write-Host "Backend exited early. Check log: $BACKEND_LOG"
    }
}

function Start-Frontend {
    $pidVal = Read-PidFile $FRONTEND_PID_FILE
    if (($pidVal -gt 0) -and (Test-PidRunning $pidVal)) {
        Write-Host "Frontend already running (PID $pidVal)."
        return
    }
    Stop-Port -Port $FRONTEND_PORT -Label "frontend"

    Write-Host "Starting frontend on http://localhost:${FRONTEND_PORT} ..."
    $proc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "npm run dev -- --host 0.0.0.0 --port $FRONTEND_PORT --strictPort" `
        -WorkingDirectory $FRONTEND_DIR `
        -RedirectStandardOutput $FRONTEND_LOG `
        -RedirectStandardError (Join-Path $LOG_DIR "frontend-error.log") `
        -RedirectStandardInput $STDIN_FILE `
        -WindowStyle Hidden `
        -PassThru

    $proc.Id | Out-File -FilePath $FRONTEND_PID_FILE -NoNewline

    if (Test-PidRunning $proc.Id) {
        Write-Host "Frontend started (PID $($proc.Id)). Log: $FRONTEND_LOG"
    } else {
        Write-Host "Frontend exited early. Check log: $FRONTEND_LOG"
    }
}

function Stop-Backend {
    $pidVal = Read-PidFile $BACKEND_PID_FILE
    if ($pidVal -gt 0) {
        Stop-ProcessGracefully -ProcId $pidVal -Name "backend"
        Remove-Item -Force $BACKEND_PID_FILE -ErrorAction SilentlyContinue
    } else {
        Write-Host "Backend PID file not found."
    }
    Stop-Port -Port $BACKEND_PORT -Label "backend"
}

function Stop-Frontend {
    $pidVal = Read-PidFile $FRONTEND_PID_FILE
    if ($pidVal -gt 0) {
        Stop-ProcessGracefully -ProcId $pidVal -Name "frontend"
        Remove-Item -Force $FRONTEND_PID_FILE -ErrorAction SilentlyContinue
    } else {
        Write-Host "Frontend PID file not found."
    }
    Stop-Port -Port $FRONTEND_PORT -Label "frontend"
}

function Show-Status {
    $backendPid = Read-PidFile $BACKEND_PID_FILE
    if (($backendPid -gt 0) -and (Test-PidRunning $backendPid)) {
        Write-Host "Backend:  running (PID $backendPid)"
    } else {
        Write-Host "Backend:  stopped"
    }

    $backPids = Get-PidsOnPort $BACKEND_PORT
    if ($backPids.Count -gt 0) {
        Write-Host "Backend:  port $BACKEND_PORT is in use (PID $($backPids -join ', '))"
    } else {
        Write-Host "Backend:  port $BACKEND_PORT is free"
    }

    $frontendPid = Read-PidFile $FRONTEND_PID_FILE
    if (($frontendPid -gt 0) -and (Test-PidRunning $frontendPid)) {
        Write-Host "Frontend: running (PID $frontendPid)"
    } else {
        Write-Host "Frontend: stopped"
    }

    $frontPids = Get-PidsOnPort $FRONTEND_PORT
    if ($frontPids.Count -gt 0) {
        Write-Host "Frontend: port $FRONTEND_PORT is in use (PID $($frontPids -join ', '))"
    } else {
        Write-Host "Frontend: port $FRONTEND_PORT is free"
    }
}

function Start-All {
    New-Item -ItemType Directory -Force -Path $LOG_DIR, $PID_DIR | Out-Null
    if (-not (Test-Path -LiteralPath $STDIN_FILE)) {
        New-Item -ItemType File -Path $STDIN_FILE | Out-Null
    }
    Start-Backend
    Start-Frontend
    Write-Host ""
    Write-Host "Dev app started."
    Write-Host "Backend:  http://localhost:${BACKEND_PORT}"
    Write-Host "Frontend: http://localhost:${FRONTEND_PORT}"
    Write-Host "Logs:"
    Write-Host "  $BACKEND_LOG"
    Write-Host "  $FRONTEND_LOG"
}

function Stop-All {
    Stop-Backend
    Stop-Frontend
    Write-Host ""
    Write-Host "Dev app stopped."
}

function Validate-Prerequisites {
    $ok = $true

    try {
        $ver = dotnet --version 2>&1
        if ($LASTEXITCODE -ne 0) { throw }
        Write-Host "dotnet:  $ver"
    } catch {
        Write-Host "dotnet:  MISSING - install .NET SDK from https://dotnet.microsoft.com/en-us/download" -ForegroundColor Red
        $ok = $false
    }

    try {
        $ver = npm --version 2>&1
        if ($LASTEXITCODE -ne 0) { throw }
        Write-Host "npm:     $ver"
    } catch {
        Write-Host "npm:     MISSING - install Node.js from https://nodejs.org" -ForegroundColor Red
        $ok = $false
    }

    if (-not $ok) { exit 1 }
}

# --- Main ---
if (-not $Action) {
    Write-Host "ERROR: No action specified." -ForegroundColor Red
    Write-Usage
    exit 1
}

switch ($Action) {
    "start"   { Validate-Prerequisites; Start-All }
    "stop"    { Stop-All }
    "restart" { Stop-All; Validate-Prerequisites; Start-All }
    "status"  { Show-Status }
    default   { Write-Usage; exit 1 }
}
