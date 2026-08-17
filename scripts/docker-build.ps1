#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$ROOT_DIR = Split-Path -Parent $SCRIPT_DIR
$IMAGE_NAME = if ($env:IMAGE_NAME) { $env:IMAGE_NAME } else { "requestloom" }
$IMAGE_TAG = if ($env:IMAGE_TAG) { $env:IMAGE_TAG } else { "latest" }

Set-Location $ROOT_DIR

Write-Host "Building Docker image: ${IMAGE_NAME}:${IMAGE_TAG} ..."
docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" .

Write-Host ""
Write-Host "Done. Run with:"
Write-Host "  docker run -d -p 8080:8080 -v requestloom-data:/data --name requestloom ${IMAGE_NAME}:${IMAGE_TAG}"
Write-Host ""
Write-Host "Or use docker-compose:"
Write-Host "  docker compose up -d"
