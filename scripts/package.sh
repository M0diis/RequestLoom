#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

export PATH="${DOTNET_ROOT:-$HOME/.dotnet}:$PATH"
export DOTNET_ROOT="${DOTNET_ROOT:-$HOME/.dotnet}"
export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1

FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
OUTPUT_DIR="$ROOT_DIR/dist"

echo "=========================================="
echo "  RequestLoom - Package"
echo "=========================================="
echo ""

echo "[1/3] Building frontend..."
cd "$FRONTEND_DIR"
npm ci --prefer-offline 2>/dev/null || npm install
npm run build

echo "[2/3] Copying to backend wwwroot..."
rm -rf "$BACKEND_DIR/wwwroot"
cp -r "$FRONTEND_DIR/dist" "$BACKEND_DIR/wwwroot"

echo "[3/3] Publishing backend..."
cd "$BACKEND_DIR"
rm -rf "$OUTPUT_DIR"
dotnet publish -c Release -o "$OUTPUT_DIR"

echo ""
echo "=========================================="
echo "  Build complete!"
echo "=========================================="
echo ""
echo "  Output:  $OUTPUT_DIR"
echo "  Run:     dotnet $OUTPUT_DIR/RequestLoom.Api.dll"
echo ""
echo "  For a self-contained single-file binary:"
echo "    cd backend && dotnet publish -c Release -r linux-x64 --self-contained -p:PublishSingleFile=true -o ../dist-single"
echo ""
