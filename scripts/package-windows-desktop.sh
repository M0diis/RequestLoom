#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/output"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      [[ $# -ge 2 ]] || { echo "ERROR: --output-dir requires a path." >&2; exit 1; }
      OUTPUT_DIR="$2"
      shift 2
      ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [--output-dir <path>]

Build the portable Windows x64 Tauri application from WSL by calling the native
PowerShell packager. Rust/MSVC, WebView2, Node 22, and .NET 10 must be installed
on Windows.
EOF
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if ! command -v powershell.exe >/dev/null 2>&1 || ! command -v wslpath >/dev/null 2>&1; then
  echo "ERROR: this script requires WSL. Run package-windows-desktop.ps1 in Windows PowerShell." >&2
  exit 1
fi

WINDOWS_SCRIPT="$(wslpath -w "$SCRIPT_DIR/package-windows-desktop.ps1")"
if [[ "$OUTPUT_DIR" == /* ]]; then
  WINDOWS_OUTPUT_DIR="$(wslpath -w "$OUTPUT_DIR")"
else
  WINDOWS_OUTPUT_DIR="$(wslpath -w "$PWD/$OUTPUT_DIR")"
fi

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WINDOWS_SCRIPT" -OutputDir "$WINDOWS_OUTPUT_DIR"
