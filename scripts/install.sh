#!/usr/bin/env bash
set -euo pipefail

# Thin clone-then-start helper. Does not replace Docker. Pre-built images still
# need a container engine. Do not present this as a GHCR-only installer.

REPO_URL="${RIDDLR_REPO_URL:-https://github.com/Kinggoz18/Riddlr.git}"
DEST="${RIDDLR_DIR:-$HOME/riddlr}"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to clone Riddlr." >&2
  echo "Install git, then run this again." >&2
  exit 1
fi

if [ -d "$DEST/.git" ]; then
  echo "Using existing clone at ${DEST}"
else
  if [ -e "$DEST" ]; then
    echo "${DEST} exists and is not a git clone. Choose another RIDDLR_DIR." >&2
    exit 1
  fi
  echo "Cloning ${REPO_URL} into ${DEST}"
  git clone --depth 1 "$REPO_URL" "$DEST"
fi

exec "$DEST/scripts/riddlr-up.sh" "$@"
