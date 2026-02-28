#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Openterface KM Server — one-liner launcher
#
# Fetch and run trigger_build.py with no local clone needed:
#
#   curl -sSL https://raw.githubusercontent.com/TechxArtisanStudio/Openterface_KM_Server/main/run.sh | bash
#
# Pass extra args after a '--':
#   curl -sSL ...run.sh | bash -s -- --duration 30
#
# Override credentials via env vars:
#   GITHUB_TOKEN=ghp_xxx GITHUB_REPO=owner/repo curl -sSL ...run.sh | bash
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_URL="https://raw.githubusercontent.com/TechxArtisanStudio/Openterface_KM_Server/main/trigger_build.py"

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

# ── Download trigger_build.py to a temp file ────────────────────────────────
TMP="$(mktemp /tmp/trigger_build_XXXXXX.py)"
trap 'rm -f "$TMP"' EXIT

echo "Downloading trigger_build.py …"
if [ "$DOWNLOADER" = "curl" ]; then
  curl -sSL "$SCRIPT_URL" -o "$TMP"
else
  wget -qO "$TMP" "$SCRIPT_URL"
fi

# ── Run it, forwarding all arguments ────────────────────────────────────────
python3 "$TMP" "$@"
