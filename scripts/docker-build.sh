#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-requestloom}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

cd "$ROOT_DIR"

echo "Building Docker image: ${IMAGE_NAME}:${IMAGE_TAG} ..."
docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" .

echo ""
echo "Done. Run with:"
echo "  docker run -d -p 8080:8080 -v requestloom-data:/data --name requestloom ${IMAGE_NAME}:${IMAGE_TAG}"
echo ""
echo "Or use docker-compose:"
echo "  docker compose up -d"
