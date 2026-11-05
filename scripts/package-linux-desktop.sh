#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
TAURI_DIR="$ROOT_DIR/desktop/src-tauri"
STAGED_APP="$ROOT_DIR/desktop/dist/RequestLoom-Desktop-linux-x64"
OUTPUT_DIR="$ROOT_DIR/output"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir) OUTPUT_DIR="${2:?--output-dir requires a path}"; shift 2 ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [--output-dir <path>]

Build the portable RequestLoom Linux x64 Tauri application.
Requires Node 22, .NET 10, Rust, and WebKitGTK 4.1 build dependencies.
EOF
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$OUTPUT_DIR" || "$OUTPUT_DIR" == "/" ]]; then
  echo "ERROR: --output-dir must be a non-root directory." >&2
  exit 1
fi
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd -P)"
if [[ "$OUTPUT_DIR" == "/" ]]; then
  echo "ERROR: --output-dir must not resolve to the filesystem root." >&2
  exit 1
fi

for tool in npm dotnet cargo; do
  command -v "$tool" >/dev/null || { echo "ERROR: $tool is required." >&2; exit 1; }
done

cd "$FRONTEND_DIR"
npm ci
npm run build
rm -rf "$BACKEND_DIR/wwwroot"
mkdir -p "$BACKEND_DIR/wwwroot"
cp -a dist/. "$BACKEND_DIR/wwwroot/"

rm -rf "$STAGED_APP"
mkdir -p "$STAGED_APP/runtime/backend"
cd "$BACKEND_DIR"
dotnet publish RequestLoom.Api.csproj -c Release -r linux-x64 --self-contained true \
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true \
  -o "$STAGED_APP/runtime/backend"

cd "$TAURI_DIR"
cargo tauri build --no-bundle
cp target/release/requestloom-desktop "$STAGED_APP/RequestLoom-Desktop"
chmod +x "$STAGED_APP/RequestLoom-Desktop" "$STAGED_APP/runtime/backend/RequestLoom.Api"
cat > "$STAGED_APP/README.txt" <<'EOF'
RequestLoom Desktop

Run ./RequestLoom-Desktop. WebKitGTK 4.1 and the Linux runtime libraries are required.
Request and workspace data are stored in your per-user RequestLoom data folder.
EOF

mkdir -p "$OUTPUT_DIR"
rm -rf "$OUTPUT_DIR/RequestLoom-Desktop-linux-x64"
cp -a "$STAGED_APP" "$OUTPUT_DIR/RequestLoom-Desktop-linux-x64"
rm -f "$OUTPUT_DIR/requestloom-desktop-linux-x64.tar.gz"
tar -czf "$OUTPUT_DIR/requestloom-desktop-linux-x64.tar.gz" -C "$OUTPUT_DIR" RequestLoom-Desktop-linux-x64
echo "Portable app: $OUTPUT_DIR/RequestLoom-Desktop-linux-x64"
echo "tar.gz archive: $OUTPUT_DIR/requestloom-desktop-linux-x64.tar.gz"
