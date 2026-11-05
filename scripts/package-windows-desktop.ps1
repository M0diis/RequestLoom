#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Build the portable RequestLoom Tauri application for Windows x64.
.PARAMETER OutputDir
  Destination directory for the desktop application and ZIP archive.
#>
[CmdletBinding()]
param(
    [string]$OutputDir = "",
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$ROOT_DIR = Split-Path -Parent $PSScriptRoot
$FRONTEND_DIR = Join-Path $ROOT_DIR "frontend"
$BACKEND_DIR = Join-Path $ROOT_DIR "backend"
$TAURI_DIR = Join-Path $ROOT_DIR "desktop\src-tauri"
$STAGED_APP = Join-Path $ROOT_DIR "desktop\dist\RequestLoom-Desktop-windows-x64"
$BACKEND_DIR_OUT = Join-Path $STAGED_APP "runtime\backend"

if ($Help) {
    Get-Help -Name $PSCommandPath -Detailed
    exit 0
}

if (-not $OutputDir) { $OutputDir = Join-Path $ROOT_DIR "output" }
foreach ($tool in @("node", "npm", "dotnet", "cargo")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool is required. Install Node.js 22+, .NET 10, and the stable Rust toolchain."
    }
}
& cargo tauri --version *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Install the Tauri command-line tool with: cargo install tauri-cli --locked"
    throw "The Tauri CLI is required (cargo tauri)."
}

Write-Host "Building the RequestLoom frontend..."
Push-Location $FRONTEND_DIR
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "Frontend dependencies failed to install." }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }
} finally { Pop-Location }

Write-Host "Staging frontend and publishing the self-contained backend..."
$wwwroot = Join-Path $BACKEND_DIR "wwwroot"
if (Test-Path $wwwroot) { Remove-Item -Recurse -Force $wwwroot }
New-Item -ItemType Directory -Force -Path $wwwroot | Out-Null
Copy-Item -Path (Join-Path $FRONTEND_DIR "dist\*") -Destination $wwwroot -Recurse -Force
if (Test-Path $STAGED_APP) { Remove-Item -Recurse -Force $STAGED_APP }
New-Item -ItemType Directory -Force -Path $BACKEND_DIR_OUT | Out-Null
Push-Location $BACKEND_DIR
try {
    dotnet publish RequestLoom.Api.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o $BACKEND_DIR_OUT
    if ($LASTEXITCODE -ne 0) { throw "Self-contained .NET backend publish failed." }
} finally { Pop-Location }

Write-Host "Building the Tauri host..."
Push-Location $TAURI_DIR
try {
    cargo tauri build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "Tauri release build failed." }
} finally { Pop-Location }

$appBinary = Join-Path $TAURI_DIR "target\release\requestloom-desktop.exe"
if (-not (Test-Path $appBinary)) { throw "Tauri app binary missing: $appBinary" }
Copy-Item $appBinary (Join-Path $STAGED_APP "RequestLoom-Desktop.exe")

@'
RequestLoom Desktop

Run RequestLoom-Desktop.exe. The Windows WebView2 Evergreen Runtime is required.
Request and workspace data are stored in your per-user RequestLoom data folder.
See https://v2.tauri.app/start/prerequisites/#windows for WebView2 setup.
'@ | Set-Content -Encoding utf8 (Join-Path $STAGED_APP "README.txt")

if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null }
$portableDir = Join-Path $OutputDir "RequestLoom-Desktop-windows-x64"
if (Test-Path $portableDir) { Remove-Item -Recurse -Force $portableDir }
Copy-Item -Recurse $STAGED_APP $portableDir
$archive = Join-Path $OutputDir "requestloom-desktop-win-x64.zip"
if (Test-Path $archive) { Remove-Item -Force $archive }
Compress-Archive -Path $portableDir -DestinationPath $archive
Write-Host "Portable app: $portableDir"
Write-Host "ZIP archive:  $archive"
