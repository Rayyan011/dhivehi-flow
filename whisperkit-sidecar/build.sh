#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Building WhisperKit sidecar for Apple Silicon..."
swift build -c release --arch arm64

# Copy binary to Tauri resources
BINARY=".build/release/WhisperKitSidecar"
DEST="../src-tauri/resources/whisperkit-sidecar"

if [ ! -f "$BINARY" ]; then
    echo "ERROR: Build output not found at $BINARY"
    exit 1
fi

mkdir -p "../src-tauri/resources"
cp "$BINARY" "$DEST"

# Ad-hoc codesign for macOS
codesign --sign - --force "$DEST"

echo "WhisperKit sidecar built and copied to $DEST"
ls -lh "$DEST"
