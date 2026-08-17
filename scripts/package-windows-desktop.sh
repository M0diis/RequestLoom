#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
DESKTOP_DIR="$ROOT_DIR/desktop"

DEFAULT_OUTPUT_DIR="$ROOT_DIR/output"
OUTPUT_DIR="$DEFAULT_OUTPUT_DIR"
RUNTIME="win-x64"
SELF_CONTAINED="true"
SINGLE_FILE="false"
APP_URL="http://127.0.0.1:5056"

PUBLISH_DIR="$ROOT_DIR/.publish-windows-backend"
DESKTOP_RUNTIME_BACKEND_DIR="$DESKTOP_DIR/runtime/backend"

ELECTRON_APP_NAME="RequestLoom-Desktop"
ELECTRON_DIST_DIR="$DESKTOP_DIR/dist"
ELECTRON_ARCH="x64"
ELECTRON_ZIP_DIR=""

export PATH="${DOTNET_ROOT:-$HOME/.dotnet}:$PATH"
export DOTNET_ROOT="${DOTNET_ROOT:-$HOME/.dotnet}"
export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT="${DOTNET_SYSTEM_GLOBALIZATION_INVARIANT:-1}"

# Force electron-packager temp dir onto the Windows filesystem when running
# under WSL, since Windows binaries like rcedit.exe can't access WSL paths.
if command -v wslpath >/dev/null 2>&1; then
  if [[ -n "${TMPDIR:-}" && "$TMPDIR" == /mnt/* ]]; then
    ELECTRON_TMPDIR="$TMPDIR"
  else
    ELECTRON_TMPDIR="$ROOT_DIR/.electron-tmp"
  fi
  export ELECTRON_TMPDIR
fi

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Build RequestLoom as a native Windows desktop app bundle (Electron + embedded backend).

Options:
  --output-dir <path>          Destination folder in WSL path format.
                               Default: $DEFAULT_OUTPUT_DIR
  --runtime <rid>              Windows runtime identifier (win-x64, win-arm64, win-x86).
                               Default: win-x64
  --app-url <url>              URL the app will bind to. Default: $APP_URL
  --electron-zip-dir <path>    Local directory containing Electron zip(s) for offline packaging.
  --framework-dependent        Publish framework-dependent (requires .NET on target).
  --single-file                Publish as single-file executable.
  -h, --help                   Show this help.

Examples:
  ./scripts/package-windows-desktop.sh
  ./scripts/package-windows-desktop.sh --runtime win-arm64
  ./scripts/package-windows-desktop.sh --electron-zip-dir "/mnt/c/Temp/electron-zips"
  ./scripts/package-windows-desktop.sh --output-dir "/mnt/c/Users/me/Desktop/requestloom"
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      OUTPUT_DIR="${2:-}"
      shift 2
      ;;
    --runtime)
      RUNTIME="${2:-}"
      shift 2
      ;;
    --app-url)
      APP_URL="${2:-}"
      shift 2
      ;;
    --electron-zip-dir)
      ELECTRON_ZIP_DIR="${2:-}"
      shift 2
      ;;
    --framework-dependent)
      SELF_CONTAINED="false"
      shift
      ;;
    --single-file)
      SINGLE_FILE="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$OUTPUT_DIR" ]]; then
  echo "ERROR: output dir cannot be empty" >&2
  exit 1
fi

if [[ ! -d "$FRONTEND_DIR" || ! -d "$BACKEND_DIR" || ! -d "$DESKTOP_DIR" ]]; then
  echo "ERROR: expected frontend/backend/desktop directories under $ROOT_DIR" >&2
  exit 1
fi

if [[ -n "$ELECTRON_ZIP_DIR" && ! -d "$ELECTRON_ZIP_DIR" ]]; then
  echo "ERROR: --electron-zip-dir does not exist: $ELECTRON_ZIP_DIR" >&2
  exit 1
fi

case "$RUNTIME" in
  win-x64)   ELECTRON_ARCH="x64" ;;
  win-arm64) ELECTRON_ARCH="arm64" ;;
  win-x86)   ELECTRON_ARCH="ia32" ;;
  *)
    echo "ERROR: unsupported runtime '$RUNTIME'. Use one of: win-x64, win-arm64, win-x86" >&2
    exit 1
    ;;
esac

if ! command -v dotnet >/dev/null 2>&1; then
  echo "ERROR: dotnet is not available." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is not available." >&2
  exit 1
fi

# Proxy wiring for Electron download
if [[ -n "${HTTP_PROXY:-}${http_proxy:-}${HTTPS_PROXY:-}${https_proxy:-}" ]]; then
  export HTTP_PROXY="${HTTP_PROXY:-${http_proxy:-}}"
  export HTTPS_PROXY="${HTTPS_PROXY:-${https_proxy:-${HTTP_PROXY:-}}}"
  export ELECTRON_GET_USE_PROXY="${ELECTRON_GET_USE_PROXY:-1}"
  export ELECTRON_DOWNLOAD_REJECT_UNAUTHORIZED="${ELECTRON_DOWNLOAD_REJECT_UNAUTHORIZED:-false}"
  export ELECTRON_DOWNLOAD_DISABLE_CHECKSUMS="${ELECTRON_DOWNLOAD_DISABLE_CHECKSUMS:-true}"
fi

echo "=========================================="
echo "  RequestLoom - Windows Desktop Package"
echo "=========================================="
echo ""
echo "Runtime:       $RUNTIME"
echo "Self-contained:$SELF_CONTAINED"
echo "Single-file:   $SINGLE_FILE"
echo "App URL:       $APP_URL"
echo "Electron app:  $ELECTRON_APP_NAME"
echo "Electron arch: $ELECTRON_ARCH"
echo "Electron ZIP:  ${ELECTRON_ZIP_DIR:-<download>}"
echo "Output dir:    $OUTPUT_DIR"
echo ""

echo "[1/6] Building frontend..."
cd "$FRONTEND_DIR"
npm ci --prefer-offline 2>/dev/null || npm install
npm run build

echo "[2/6] Syncing frontend build to backend wwwroot..."
rm -rf "$BACKEND_DIR/wwwroot"
cp -r "$FRONTEND_DIR/dist" "$BACKEND_DIR/wwwroot"

echo "[3/6] Publishing backend for Windows..."
rm -rf "$PUBLISH_DIR"
mkdir -p "$PUBLISH_DIR"

DOTNET_ARGS=(
  publish "$BACKEND_DIR/RequestLoom.Api.csproj"
  -c Release
  -r "$RUNTIME"
  --self-contained "$SELF_CONTAINED"
  -o "$PUBLISH_DIR"
)

if [[ "$SINGLE_FILE" == "true" ]]; then
  DOTNET_ARGS+=(
    -p:PublishSingleFile=true
    -p:IncludeNativeLibrariesForSelfExtract=true
  )
fi

cd "$BACKEND_DIR"
dotnet "${DOTNET_ARGS[@]}"

echo "[4/6] Staging backend runtime for desktop shell..."
rm -rf "$DESKTOP_RUNTIME_BACKEND_DIR"
mkdir -p "$DESKTOP_RUNTIME_BACKEND_DIR"
cp -a "$PUBLISH_DIR"/. "$DESKTOP_RUNTIME_BACKEND_DIR"/
rm -f "$DESKTOP_RUNTIME_BACKEND_DIR/desktop-backend.log"

echo "[5/6] Packaging Electron desktop app for Windows..."
rm -rf "$ELECTRON_DIST_DIR"
cd "$DESKTOP_DIR"
npm ci --prefer-offline 2>/dev/null || npm install
ELECTRON_ARCH="$ELECTRON_ARCH" \
ELECTRON_APP_NAME="$ELECTRON_APP_NAME" \
ELECTRON_DOWNLOAD_REJECT_UNAUTHORIZED="${ELECTRON_DOWNLOAD_REJECT_UNAUTHORIZED:-false}" \
ELECTRON_DOWNLOAD_DISABLE_CHECKSUMS="${ELECTRON_DOWNLOAD_DISABLE_CHECKSUMS:-false}" \
ELECTRON_ZIP_DIR="$ELECTRON_ZIP_DIR" \
NODE_TLS_REJECT_UNAUTHORIZED="${NODE_TLS_REJECT_UNAUTHORIZED:-0}" \
npm run package:win

PACKAGED_DESKTOP_DIR="$ELECTRON_DIST_DIR/${ELECTRON_APP_NAME}-win32-${ELECTRON_ARCH}"
if [[ ! -d "$PACKAGED_DESKTOP_DIR" ]]; then
  echo "ERROR: packaged desktop output not found at $PACKAGED_DESKTOP_DIR" >&2
  exit 1
fi

echo "[6/6] Copying desktop app bundle to output folder..."
mkdir -p "$OUTPUT_DIR"
find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a "$PACKAGED_DESKTOP_DIR"/. "$OUTPUT_DIR"/

cat > "$OUTPUT_DIR/Run-RequestLoom-Desktop.bat" <<EOF
@echo off
setlocal
cd /d "%~dp0"

set "APP_EXE=$ELECTRON_APP_NAME.exe"
set "REQUESTLOOM_APP_URL=$APP_URL"
set "REQUESTLOOM_APP_URL=%REQUESTLOOM_APP_URL%"

if not exist "%APP_EXE%" (
  echo ERROR: %APP_EXE% not found in %cd%
  pause
  exit /b 1
)

start "" "%APP_EXE%"
endlocal
EOF

cat > "$OUTPUT_DIR/Stop-RequestLoom-Desktop.bat" <<EOF
@echo off
taskkill /IM "$ELECTRON_APP_NAME.exe" /F >nul 2>&1
taskkill /IM "RequestLoom.Api.exe" /F >nul 2>&1
exit /b 0
EOF

echo "Run launcher:  $OUTPUT_DIR/Run-RequestLoom-Desktop.bat"
echo "Stop launcher: $OUTPUT_DIR/Stop-RequestLoom-Desktop.bat"

if command -v wslpath >/dev/null 2>&1; then
  echo ""
  echo "Windows folder: $(wslpath -w "$OUTPUT_DIR")"
  echo "Windows exe:    $(wslpath -w "$OUTPUT_DIR/$ELECTRON_APP_NAME.exe")"
fi

echo ""
echo "Done."
