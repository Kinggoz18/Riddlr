#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PUBLIC=0
SKIP_BUILD=0
FORCE_BUILD=0
DETACH=1
INSTALL_DOCKER=0

# Keep in sync with SETUP_CODE_TTL_MINUTES in packages/domain/src/setup-access.ts
SETUP_CODE_TTL_MINUTES=15

usage() {
  cat <<EOF
Start Riddlr and print how to finish setup.

  ./scripts/riddlr-up.sh
  ./scripts/riddlr-up.sh --public

Default: the dashboard is only at http://127.0.0.1:8080 on the machine that
runs Docker. On a remote server, run the printed SSH command on the machine
with the browser, then open that same address there.

The script checks that Docker, Compose, and curl are available. Give Docker
at least 10 GB of disk. If Docker is missing or not running, it can install
or start it (Linux Engine, Docker Desktop via Homebrew on a Mac, or Docker
Desktop via winget on Windows — see scripts/riddlr-up.ps1). That still needs
confirmation, or --install-docker.

It pulls published images when they exist, otherwise it builds from the clone.
Pre-built images still require Docker.

--public          let other devices open the dashboard without SSH. Setup then
                  asks for the setup code this command prints. The code expires
                  after ${SETUP_CODE_TTL_MINUTES} minutes if nobody enters it;
                  print a new one from the machine that runs Docker. Finish
                  setup before sharing the URL.
--install-docker  install or start Docker without prompting (needs sudo on
                  Linux; Homebrew cask on macOS). Windows: scripts/riddlr-up.ps1
                  -InstallDocker
--build           rebuild images from the clone (skip pull)
--skip-build      do not pull or rebuild
--foreground      follow container logs
EOF
}

confirm() {
  local question="$1"
  if [ "$INSTALL_DOCKER" -eq 1 ]; then
    return 0
  fi
  if [ ! -t 0 ]; then
    return 1
  fi
  printf "%s [y/N] " "$question" >&2
  local answer=""
  read -r answer || true
  case "$answer" in
    y | Y | yes | YES) return 0 ;;
    *) return 1 ;;
  esac
}

wait_for_docker() {
  local seconds="${1:-90}"
  local deadline=$((SECONDS + seconds))
  echo "Waiting for Docker to become ready..."
  while [ "$SECONDS" -lt "$deadline" ]; do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

try_start_docker() {
  local os
  os="$(uname -s)"
  case "$os" in
    Darwin)
      if [ -d "/Applications/Docker.app" ]; then
        echo "Starting Docker Desktop..."
        open -a Docker
        wait_for_docker 120
        return
      fi
      return 1
      ;;
    Linux)
      if command -v systemctl >/dev/null 2>&1; then
        echo "Starting the Docker service (may ask for sudo)..."
        sudo systemctl start docker
        wait_for_docker 30
        return
      fi
      return 1
      ;;
    MINGW*|MSYS*|CYGWIN*)
      for exe in \
        "/c/Program Files/Docker/Docker/Docker Desktop.exe" \
        "/c/Program Files (x86)/Docker/Docker/Docker Desktop.exe"; do
        if [ -f "$exe" ]; then
          echo "Starting Docker Desktop..."
          "$exe" &
          wait_for_docker 180
          return
        fi
      done
      echo "Start Docker Desktop from the Start menu, or use PowerShell:" >&2
      echo "  powershell -ExecutionPolicy Bypass -File scripts/riddlr-up.ps1" >&2
      return 1
      ;;
    *)
      return 1
      ;;
  esac
}

install_docker() {
  local os
  os="$(uname -s)"
  case "$os" in
    Darwin)
      if ! command -v brew >/dev/null 2>&1; then
        echo "Homebrew is not installed, so Riddlr cannot install Docker Desktop from here." >&2
        echo "Install Docker Desktop, start it, then run this again." >&2
        echo "https://docs.docker.com/get-started/get-docker/" >&2
        return 1
      fi
      echo "Installing Docker Desktop with Homebrew (brew install --cask docker)..."
      brew install --cask docker
      echo "Starting Docker Desktop. Finish any first-run prompt it shows."
      open -a Docker
      wait_for_docker 120
      return
      ;;
    Linux)
      if ! command -v curl >/dev/null 2>&1; then
        echo "curl is required to install Docker Engine." >&2
        return 1
      fi
      echo "Installing Docker Engine with the official installer (https://get.docker.com)."
      echo "This uses sudo."
      curl -fsSL https://get.docker.com | sudo sh
      if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl enable --now docker
      fi
      if command -v usermod >/dev/null 2>&1 && [ -n "${USER:-}" ]; then
        sudo usermod -aG docker "$USER" || true
      fi
      wait_for_docker 30 || true
      if ! docker info >/dev/null 2>&1; then
        echo "Docker Engine is installed but this shell cannot talk to it yet." >&2
        echo "Log out and back in (or run: newgrp docker), then run this again." >&2
        return 1
      fi
      return 0
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "Git Bash cannot install Docker Desktop. Use PowerShell:" >&2
      echo "  powershell -ExecutionPolicy Bypass -File scripts/riddlr-up.ps1 -InstallDocker" >&2
      echo "https://docs.docker.com/desktop/setup/install/windows-install/" >&2
      return 1
      ;;
    *)
      echo "This script cannot install Docker on $(uname -s)." >&2
      echo "https://docs.docker.com/get-started/get-docker/" >&2
      return 1
      ;;
  esac
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    return 0
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is not installed." >&2
    if confirm "Install Docker now?"; then
      install_docker
    else
      echo "Install Docker Desktop (Mac or Windows) or Docker Engine (Linux), then run this again." >&2
      echo "Or re-run with --install-docker." >&2
      echo "https://docs.docker.com/get-started/get-docker/" >&2
      exit 1
    fi
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed but not running." >&2
    if confirm "Start Docker now?"; then
      try_start_docker || true
    fi
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is still not installed." >&2
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed but not running. Start Docker, then run this again." >&2
    exit 1
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --public) PUBLIC=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --build) FORCE_BUILD=1 ;;
    --install-docker) INSTALL_DOCKER=1 ;;
    --foreground) DETACH=0 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [ "$PUBLIC" -eq 1 ]; then
  export RIDDLR_SETUP_ACCESS=public
  export RIDDLR_HTTP_PUBLISH="${RIDDLR_HTTP_PUBLISH:-0.0.0.0:8080}"
else
  export RIDDLR_SETUP_ACCESS="${RIDDLR_SETUP_ACCESS:-loopback}"
  export RIDDLR_HTTP_PUBLISH="${RIDDLR_HTTP_PUBLISH:-127.0.0.1:8080}"
fi

if [ "$RIDDLR_SETUP_ACCESS" != "public" ]; then
  case "$RIDDLR_HTTP_PUBLISH" in
    127.0.0.1:*|localhost:*|\[::1\]:*) ;;
    *)
      echo "Refusing to expose the dashboard on the network without a setup code." >&2
      echo "Pass --public." >&2
      exit 1
      ;;
  esac
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to wait until Riddlr is ready (and to install Docker Engine on Linux)." >&2
  echo "Install curl, then run this again." >&2
  exit 1
fi

ensure_docker

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose is required (the \`docker compose\` plugin). Install it, then run this again." >&2
  exit 1
fi

BUILD_ARGS=(up)
if [ "$DETACH" -eq 1 ]; then
  BUILD_ARGS+=(-d)
fi

if [ "$FORCE_BUILD" -eq 1 ]; then
  BUILD_ARGS+=(--build)
elif [ "$SKIP_BUILD" -eq 0 ]; then
  if docker compose pull api worker web; then
    echo "Using published images."
  else
    echo "Published images are not available; building from the clone."
    BUILD_ARGS+=(--build)
  fi
fi

docker compose "${BUILD_ARGS[@]}"

ORIGIN="${RIDDLR_PUBLIC_URL:-http://127.0.0.1:8080}"
echo "Waiting for Riddlr at ${ORIGIN} ..."
deadline=$((SECONDS + 180))
until curl -fsS "${ORIGIN}/api/v1/setup/status" >/dev/null 2>&1; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "Riddlr did not become ready in time. Check: docker compose ps" >&2
    exit 1
  fi
  sleep 2
done

echo
echo "Riddlr is up."
if [ "$PUBLIC" -eq 1 ]; then
  if CODE="$(docker compose exec -T api node apps/server/dist/cmd/setup-code.js 2>/dev/null)"; then
    echo "Setup code (enter it in the browser, then continue setup):"
    echo "  ${CODE}"
    echo "This code expires after ${SETUP_CODE_TTL_MINUTES} minutes if nobody enters it. Print a new one with:"
    echo "  docker compose exec -T api node apps/server/dist/cmd/setup-code.js"
  else
    echo "Setup is already finished, already in progress, or the setup code is no longer available."
  fi
  echo "Open ${ORIGIN} and complete the four setup steps."
else
  echo "Open in a browser on this machine: ${ORIGIN}"
  USER_NAME="$(whoami 2>/dev/null || echo USER)"
  HOST_NAME="$(hostname 2>/dev/null || echo HOST)"
  echo "If Docker is on a remote server, on the machine with the browser run:"
  echo "  ssh -N -L 8080:127.0.0.1:8080 ${USER_NAME}@${HOST_NAME}"
  echo "Then open http://127.0.0.1:8080 there."
  echo "Setup can also be finished in a terminal on the machine that runs Docker:"
  echo "  docker compose exec -it api node apps/server/dist/cmd/onboard.js"
fi
echo
