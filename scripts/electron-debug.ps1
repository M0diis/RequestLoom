#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Build the local Electron debug runtime.
.DESCRIPTION
  Builds the Vite frontend, publishes a Debug backend, and stages the backend
  beside the Electron entry point so VS Code can launch desktop/main.js.
.PARAMETER Runtime
  .NET runtime identifier. Defaults to win-x64.
.EXAMPLE
  .\scripts\electron-debug.ps1
#>
[CmdletBinding()]
param(
    [ValidateSet("win-x64", "win-arm64", "win-x86")]
    [string]$Runtime = "win-x64"
)

$ErrorActionPreference = "Stop"

$ROOT_DIR = Split-Path -Parent $PSScriptRoot
$FRONTEND_DIR = Join-Path $ROOT_DIR "frontend"
$BACKEND_DIR = Join-Path $ROOT_DIR "backend"
$DESKTOP_DIR = Join-Path $ROOT_DIR "desktop"
$BACKEND_WWWROOT = Join-Path $BACKEND_DIR "wwwroot"
$PUBLISH_DIR = Join-Path $ROOT_DIR ".publish-debug-backend"
$DESKTOP_RUNTIME_BACKEND_DIR = Join-Path $DESKTOP_DIR "runtime\backend"

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

function Invoke-Npm {
    param(
        [string]$WorkingDirectory,
        [string[]]$Arguments
    )

    Push-Location $WorkingDirectory
    try {
        & npm @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "npm $($Arguments -join ' ') failed in $WorkingDirectory."
        }
    } finally {
        Pop-Location
    }
}

function Ensure-NpmDependencies {
    param([string]$WorkingDirectory)

    if (Test-Path (Join-Path $WorkingDirectory "node_modules")) {
        return
    }

    Push-Location $WorkingDirectory
    try {
        & npm ci --prefer-offline
        if ($LASTEXITCODE -ne 0) {
            & npm install
            if ($LASTEXITCODE -ne 0) {
                throw "npm dependency installation failed in $WorkingDirectory."
            }
        }
    } finally {
        Pop-Location
    }
}

function Ensure-ElectronBinary {
    $electronBinary = Join-Path $DESKTOP_DIR "node_modules\electron\dist\electron.exe"
    if (Test-Path $electronBinary) {
        return
    }

    Write-Host "Downloading Electron development binary..."
    Push-Location $DESKTOP_DIR
    try {
        & npx --no-install install-electron --no
        if ($LASTEXITCODE -ne 0) {
            throw "Electron binary installation failed."
        }
    } finally {
        Pop-Location
    }

    if (-not (Test-Path $electronBinary)) {
        throw "Electron binary was not installed at $electronBinary."
    }
}

function Assert-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required to build the Electron debug runtime."
    }
}

Assert-Command "dotnet"
Assert-Command "node"
Assert-Command "npm"

Write-Host "Node:    $(node --version)"
Write-Host "npm:     $(npm --version)"
Write-Host "Building frontend..."
Ensure-NpmDependencies $FRONTEND_DIR
Invoke-Npm $FRONTEND_DIR @("run", "build")

Write-Host "Syncing frontend build to backend wwwroot..."
if (Test-Path $BACKEND_WWWROOT) {
    Remove-Item -Recurse -Force $BACKEND_WWWROOT
}
New-Item -ItemType Directory -Force -Path $BACKEND_WWWROOT | Out-Null
Copy-Item -Path (Join-Path $FRONTEND_DIR "dist\*") -Destination $BACKEND_WWWROOT -Recurse -Force

Write-Host "Publishing Debug backend for $Runtime..."
if (Test-Path $PUBLISH_DIR) {
    Remove-Item -Recurse -Force $PUBLISH_DIR
}
New-Item -ItemType Directory -Force -Path $PUBLISH_DIR | Out-Null

$dotnetArgs = @(
    "publish", (Join-Path $BACKEND_DIR "RequestLoom.Api.csproj"),
    "-c", "Debug",
    "-r", $Runtime,
    "--self-contained", "false",
    "-o", $PUBLISH_DIR,
    "--nologo"
)

Push-Location $BACKEND_DIR
try {
    & dotnet @dotnetArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Debug backend publish failed."
    }
} finally {
    Pop-Location
}

Write-Host "Staging backend beside Electron..."
if (Test-Path $DESKTOP_RUNTIME_BACKEND_DIR) {
    Remove-Item -Recurse -Force $DESKTOP_RUNTIME_BACKEND_DIR
}
New-Item -ItemType Directory -Force -Path $DESKTOP_RUNTIME_BACKEND_DIR | Out-Null
Copy-Item -Path (Join-Path $PUBLISH_DIR "*") -Destination $DESKTOP_RUNTIME_BACKEND_DIR -Recurse -Force
Remove-Item -Force (Join-Path $DESKTOP_RUNTIME_BACKEND_DIR "desktop-backend.log") -ErrorAction SilentlyContinue

Ensure-NpmDependencies $DESKTOP_DIR
Ensure-ElectronBinary

Write-Host "Electron debug runtime ready."
