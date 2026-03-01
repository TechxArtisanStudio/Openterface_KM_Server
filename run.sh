#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Openterface KM Server — run agent on target PC
#
# This script downloads and runs agent.py to connect a target PC to the tunnel.
# Usage (after tunnel is ready):
#
#   curl -sSL https://tunnel-url/run.sh | bash -s -- https://tunnel-url
#
# The script will automatically:
#   - Create an isolated Python virtual environment (~/.openterface_km_venv)
#   - Install required dependencies (websockets, pynput, mss, Pillow)
#   - Download agent.py from the tunnel
#   - Run it with the correct WebSocket URL (wss://)
#   - Pass through any additional arguments to agent.py
#
# Example with duration:
#   curl -sSL https://tunnel-url/run.sh | bash -s -- https://tunnel-url --duration 30
# ---------------------------------------------------------------------------
set -euo pipefail

# Tunnel URL: first arg (required), or env var, or localhost default
TUNNEL_URL="${1:-${TUNNEL_URL:-http://localhost:8000}}"

# Convert HTTPS to WSS for agent connection
WSS_URL="${TUNNEL_URL/https:/wss:}"
WSS_URL="${WSS_URL/http:/ws:}"

SCRIPT_URL="${TUNNEL_URL%/}/agent.py"

# ── Dependency checks ───────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 is required but was not found in PATH." >&2
  exit 1
fi

DOWNLOADER=""
if command -v curl &>/dev/null; then
  DOWNLOADER="curl"
elif command -v wget &>/dev/null; then
  DOWNLOADER="wget"
else
  echo "ERROR: curl or wget is required to download the script." >&2
  exit 1
fi

# ── Create virtual environment and install packages ──────────────────────────
VENV_DIR="${HOME}/.openterface_km_venv"
echo "Setting up Python environment in $VENV_DIR …"

if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR" || {
    echo "ERROR: Failed to create virtual environment." >&2
    exit 1
  }
fi

PYTHON="$VENV_DIR/bin/python3"
PIP="$VENV_DIR/bin/pip"

echo "Installing required Python packages …"
$PIP install -q websockets pynput mss Pillow 2>/dev/null || {
  echo "ERROR: Failed to install required packages." >&2
  exit 1
}

# ── Download agent.py to a temp file ────────────────────────────────────────
TMP="$(mktemp /tmp/agent_XXXXXX.py)"
trap 'rm -f "$TMP"' EXIT

echo "Downloading agent.py from $SCRIPT_URL …"
if [ "$DOWNLOADER" = "curl" ]; then
  curl -sSL "$SCRIPT_URL" -o "$TMP"
else
  wget -qO "$TMP" "$SCRIPT_URL"
fi

# ── Run agent with WSS URL and any additional args ──────────────────────────
shift || true  # remove the tunnel URL from args
$PYTHON "$TMP" "$WSS_URL" "$@"


