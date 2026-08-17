#!/usr/bin/env pwsh
<#
.SYNOPSIS
  RequestLoom Windows desktop packager (native PowerShell).
.DESCRIPTION
  Builds the frontend, publishes the .NET backend for Windows, packages
  everything into an Electron desktop app, and copies it to an output folder
  with convenience .bat launchers.
.PARAMETER OutputDir
  Destination folder for the packaged app.
.PARAMETER Runtime
  Windows RID: win-x64, win-arm64, win-x86. Default: win-x64.
.PARAMETER AppUrl
  URL the app binds to. Default: http://127.0.0.1:5056.
.PARAMETER ElectronZipDir
  Local directory containing Electron zip(s) for offline packaging.
.PARAMETER FrameworkDependent
  Publish framework-dependent (requires .NET on target machine).
.PARAMETER SingleFile
  Publish as single-file executable.
.PARAMETER Help
  Show this help.
.EXAMPLE
  .\scripts\package-windows-desktop.ps1
  .\scripts\package-windows-desktop.ps1 -Runtime win-arm64
  .\scripts\package-windows-desktop.ps1 -SingleFile
#>
[CmdletBinding()]
param(
    [string]$OutputDir = "",
    [ValidateSet("win-x64", "win-arm64", "win-x86")]
    [string]$Runtime = "win-x64",
    [string]$AppUrl = "http://127.0.0.1:5056",
    [string]$ElectronZipDir = "",
    [switch]$FrameworkDependent,
    [switch]$SingleFile,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
    Get-Help -Name $PSCommandPath -Detailed
    exit 0
}

$ROOT_DIR = Split-Path -Parent $PSScriptRoot
$FRONTEND_DIR = Join-Path $ROOT_DIR "frontend"
$BACKEND_DIR = Join-Path $ROOT_DIR "backend"
$DESKTOP_DIR = Join-Path $ROOT_DIR "desktop"

if (-not $OutputDir) {
    $OutputDir = Join-Path $ROOT_DIR "output"
}

$PUBLISH_DIR = Join-Path $ROOT_DIR ".publish-windows-backend"
$DESKTOP_RUNTIME_BACKEND_DIR = Join-Path $DESKTOP_DIR "runtime\backend"

$ELECTRON_APP_NAME = "RequestLoom-Desktop"
$ELECTRON_DIST_DIR = Join-Path $DESKTOP_DIR "dist"
$SELF_CONTAINED = if ($FrameworkDependent) { "false" } else { "true" }

$ELECTRON_ARCH = switch ($Runtime) {
    "win-x64"   { "x64" }
    "win-arm64" { "arm64" }
    "win-x86"   { "ia32" }
}

# --- Validation ---
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    Write-Error "Output dir cannot be empty."
    exit 1
}

if (-not (Test-Path $FRONTEND_DIR) -or -not (Test-Path $BACKEND_DIR) -or -not (Test-Path $DESKTOP_DIR)) {
    Write-Error "Expected frontend/, backend/, desktop/ directories under $ROOT_DIR"
    exit 1
}

if ($ElectronZipDir -and -not (Test-Path $ElectronZipDir)) {
    Write-Error "ElectronZipDir does not exist: $ElectronZipDir"
    exit 1
}

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

try { $dotnetSdkVersion = dotnet --version 2>&1 } catch { $dotnetSdkVersion = "" }
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($dotnetSdkVersion)) {
    Write-Error "dotnet is not available. Install .NET SDK from https://dotnet.microsoft.com/en-us/download"
    exit 1
}
Write-Host "dotnet:  $dotnetSdkVersion"

try { $npmVersion = npm --version 2>&1 } catch { $npmVersion = "" }
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($npmVersion)) {
    Write-Error "npm is not available. Install Node.js from https://nodejs.org"
    exit 1
}
Write-Host "npm:     $npmVersion"

# Proxy wiring
if ($env:HTTP_PROXY -or $env:HTTPS_PROXY) {
    $env:ELECTRON_GET_USE_PROXY = if ($env:ELECTRON_GET_USE_PROXY) { $env:ELECTRON_GET_USE_PROXY } else { "1" }
    $env:NODE_TLS_REJECT_UNAUTHORIZED = if ($env:NODE_TLS_REJECT_UNAUTHORIZED) { $env:NODE_TLS_REJECT_UNAUTHORIZED } else { "0" }
    if (-not $env:ELECTRON_DOWNLOAD_REJECT_UNAUTHORIZED) {
        $env:ELECTRON_DOWNLOAD_REJECT_UNAUTHORIZED = "false"
    }
    if (-not $env:ELECTRON_DOWNLOAD_DISABLE_CHECKSUMS) {
        $env:ELECTRON_DOWNLOAD_DISABLE_CHECKSUMS = "true"
    }
}

Write-Host "=========================================="
Write-Host "  RequestLoom - Windows Desktop Package"
Write-Host "=========================================="
Write-Host ""
Write-Host "Runtime:        $Runtime"
Write-Host "Self-contained: $SELF_CONTAINED"
Write-Host "Single-file:    $($SingleFile.IsPresent)"
Write-Host "App URL:        $AppUrl"
Write-Host "Electron app:   $ELECTRON_APP_NAME"
Write-Host "Electron arch:  $ELECTRON_ARCH"
Write-Host "Electron ZIP:   $(if ($ElectronZipDir) { $ElectronZipDir } else { '<download>' })"
Write-Host "Output dir:     $OutputDir"
Write-Host ""

# 1. Build frontend
Write-Host "[1/6] Building frontend..."
Push-Location $FRONTEND_DIR
try {
    npm ci --prefer-offline 2>$null
    if ($LASTEXITCODE -ne 0) { npm install }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }
} finally { Pop-Location }

# 2. Sync to wwwroot
Write-Host "[2/6] Syncing frontend build to backend wwwroot..."
$wwwroot = Join-Path $BACKEND_DIR "wwwroot"
if (Test-Path $wwwroot) { Remove-Item -Recurse -Force $wwwroot }
Copy-Item -Recurse (Join-Path $FRONTEND_DIR "dist") $wwwroot

# 3. Publish backend
Write-Host "[3/6] Publishing backend for Windows..."
if (Test-Path $PUBLISH_DIR) { Remove-Item -Recurse -Force $PUBLISH_DIR }
New-Item -ItemType Directory -Force -Path $PUBLISH_DIR | Out-Null

$dotnetArgs = @(
    "publish", "$BACKEND_DIR\RequestLoom.Api.csproj",
    "-c", "Release",
    "-r", $Runtime,
    "--self-contained", $SELF_CONTAINED,
    "-o", $PUBLISH_DIR
)

if ($SingleFile) {
    $dotnetArgs += "-p:PublishSingleFile=true"
    $dotnetArgs += "-p:IncludeNativeLibrariesForSelfExtract=true"
}

Push-Location $BACKEND_DIR
try {
    & dotnet $dotnetArgs
    if ($LASTEXITCODE -ne 0) { throw "Backend publish failed." }
} finally { Pop-Location }

# 4. Stage backend runtime for desktop shell
Write-Host "[4/6] Staging backend runtime for desktop shell..."
if (Test-Path $DESKTOP_RUNTIME_BACKEND_DIR) { Remove-Item -Recurse -Force $DESKTOP_RUNTIME_BACKEND_DIR }
New-Item -ItemType Directory -Force -Path $DESKTOP_RUNTIME_BACKEND_DIR | Out-Null
Copy-Item -Recurse "$PUBLISH_DIR\*" $DESKTOP_RUNTIME_BACKEND_DIR -Force
Remove-Item -Force (Join-Path $DESKTOP_RUNTIME_BACKEND_DIR "desktop-backend.log") -ErrorAction SilentlyContinue

# 5. Package Electron desktop app
Write-Host "[5/6] Packaging Electron desktop app for Windows..."
if (Test-Path $ELECTRON_DIST_DIR) { Remove-Item -Recurse -Force $ELECTRON_DIST_DIR }

Push-Location $DESKTOP_DIR
try {
    npm ci --prefer-offline 2>$null
    if ($LASTEXITCODE -ne 0) { npm install }

    $env:ELECTRON_ARCH = $ELECTRON_ARCH
    $env:ELECTRON_APP_NAME = $ELECTRON_APP_NAME
    if ($ElectronZipDir) { $env:ELECTRON_ZIP_DIR = $ElectronZipDir }

    npm run package:win
    if ($LASTEXITCODE -ne 0) { throw "Electron packaging failed." }
} finally { Pop-Location }

$PACKAGED_DESKTOP_DIR = Join-Path $ELECTRON_DIST_DIR "${ELECTRON_APP_NAME}-win32-${ELECTRON_ARCH}"
if (-not (Test-Path $PACKAGED_DESKTOP_DIR)) {
    Write-Error "Packaged desktop output not found at $PACKAGED_DESKTOP_DIR"
    exit 1
}

# 6. Copy to output folder
Write-Host "[6/6] Copying desktop app bundle to output folder..."
if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null }
Get-ChildItem -Path $OutputDir -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
Copy-Item -Recurse "$PACKAGED_DESKTOP_DIR\*" $OutputDir -Force

$RUN_BAT = Join-Path $OutputDir "Run-RequestLoom-Desktop.bat"
@"
@echo off
setlocal
cd /d "%~dp0"

set "APP_EXE=$ELECTRON_APP_NAME.exe"
set "REQUESTLOOM_APP_URL=$AppUrl"
set "REQUESTLOOM_APP_URL=%REQUESTLOOM_APP_URL%"

if not exist "%APP_EXE%" (
  echo ERROR: %APP_EXE% not found in %cd%
  pause
  exit /b 1
)

start "" "%APP_EXE%"
endlocal
"@ | Out-File -FilePath $RUN_BAT -Encoding ASCII

$STOP_BAT = Join-Path $OutputDir "Stop-RequestLoom-Desktop.bat"
@"
@echo off
taskkill /IM "$ELECTRON_APP_NAME.exe" /F >nul 2>&1
taskkill /IM "RequestLoom.Api.exe" /F >nul 2>&1
exit /b 0
"@ | Out-File -FilePath $STOP_BAT -Encoding ASCII

Write-Host "Run launcher:  $RUN_BAT"
Write-Host "Stop launcher: $STOP_BAT"
Write-Host ""
Write-Host "Done."
