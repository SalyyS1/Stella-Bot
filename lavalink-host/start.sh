#!/usr/bin/env bash
set -euo pipefail

VERSION="${LAVALINK_VERSION:-4.2.2}"
JAR_FILE="${LAVALINK_JAR_FILE:-Lavalink.jar}"
DOWNLOAD_URL="https://github.com/lavalink-devs/Lavalink/releases/download/${VERSION}/Lavalink.jar"

if [ -z "${LAVALINK_SERVER_PASSWORD:-}" ]; then
  echo "LAVALINK_SERVER_PASSWORD is required. Refusing to start with an empty or default password." >&2
  exit 1
fi

if [ ! -f "$JAR_FILE" ]; then
  echo "Downloading Lavalink ${VERSION}..."
  curl -L --fail --retry 3 --retry-delay 3 -o "$JAR_FILE" "$DOWNLOAD_URL"
fi

echo "Starting Lavalink on port ${SERVER_PORT:-2333}..."
exec java ${JAVA_OPTS:--Xmx768m} -jar "$JAR_FILE"
