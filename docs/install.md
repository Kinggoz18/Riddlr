# Install

Riddlr runs in Docker. After it starts, complete setup in a browser (four
steps). There is no fifth setup step.

Pre-built images skip building from source. They still need Docker.

## What you need

- Docker with Compose, running
- About **10 GB** of free disk for Docker

On macOS and Linux, `./scripts/riddlr-up.sh` checks this. If Docker is missing
or stopped, it asks to install or start it (Linux Engine via get.docker.com,
or Docker Desktop via Homebrew on a Mac). Pass `--install-docker` to skip
the prompt. Docker Desktop on macOS and Windows shows its own first-run
window; that window is not part of the Riddlr script. Until it is finished
(and sometimes until the machine is restarted), `docker` will not work. On
Linux you may need to log out once so your user can talk to Docker. Windows
uses `scripts/riddlr-up.ps1` the same way.

Use that start script, not a bare `docker compose up`. The script waits until
Riddlr is ready, refuses to expose the dashboard on the network without a
setup code, and prints the SSH command or setup code you need.

## macOS and Linux

```bash
git clone https://github.com/Kinggoz18/Riddlr.git
cd Riddlr
./scripts/riddlr-up.sh
```

Open http://127.0.0.1:8080 in a browser on the same machine and complete setup.
See [onboarding.md](onboarding.md).

If published images exist, the script pulls them. Otherwise it builds from
the clone.

Without cloning first, this downloads `scripts/install.sh` from GitHub `main`,
then that script clones the repository into `~/riddlr` and starts Riddlr:

```bash
curl -fsSL https://raw.githubusercontent.com/Kinggoz18/Riddlr/main/scripts/install.sh | bash
```

Docker is still required. Pass flags after `--`:

```bash
curl -fsSL https://raw.githubusercontent.com/Kinggoz18/Riddlr/main/scripts/install.sh | bash -s -- --public
```

## Windows

```powershell
git clone https://github.com/Kinggoz18/Riddlr.git
cd Riddlr
powershell -ExecutionPolicy Bypass -File .\scripts\riddlr-up.ps1
```

Open http://127.0.0.1:8080 in a browser on the same machine. If Docker Desktop
is missing, the script asks to install it with winget (or Chocolatey). Pass
`-InstallDocker` to skip the prompt. Finish Docker Desktop's first-run window
if it appears, then run the script again if `docker` is still missing. That
window, and a possible reboot, are not automated. The Windows helper is new
and has not been verified on a Windows PC; expect install and start to fail
until Docker Desktop is fully running. `-Public` exposes the dashboard on
the network (see below).

Without cloning first, this downloads `scripts/install.ps1` from GitHub
`main`, which then clones the repository and starts Riddlr:

```powershell
irm https://raw.githubusercontent.com/Kinggoz18/Riddlr/main/scripts/install.ps1 -OutFile $env:TEMP\riddlr-install.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\riddlr-install.ps1
```

Pass `-Public` or `-InstallDocker` on that last command. Docker is still
required.

## Riddlr on a remote server

Start Riddlr on the server the same way. The dashboard stays at
http://127.0.0.1:8080 on the server, not on the public internet.

On the machine with the browser, run the SSH command the start script prints,
then open http://127.0.0.1:8080 there and complete the same four steps.

## Other devices without SSH

Only if phones or other PCs must open the URL directly:

```bash
./scripts/riddlr-up.sh --public
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\riddlr-up.ps1 -Public
```

The command prints a setup code. The first browser screen asks for that code,
then the usual four steps. The code expires after **15 minutes** if nobody
enters it. Print a new one:

```bash
docker compose exec -T api node apps/server/dist/cmd/setup-code.js
```

After Finish, the code stops working. If you lose it before Finish, wipe the
instance (`pnpm compose:reset`) and start again.

Do not leave setup unfinished on a URL other people can open.

## Setup from a terminal

On the machine that already runs Docker, after Riddlr is up:

```bash
docker compose exec -it api node apps/server/dist/cmd/onboard.js
```

For scripts (Ansible and similar):

```bash
docker compose exec -T api node apps/server/dist/cmd/onboard.js \
  --non-interactive \
  --email you@example.com \
  --password-env RIDDLR_ADMIN_PASSWORD \
  --skip-totp \
  --skip-llm
```

Set `RIDDLR_ADMIN_PASSWORD` in that environment. Non-interactive setup skips
authenticator; enable it later in Settings. If the start command printed a
setup code, pass `--setup-code` as well.

If the administrator forgot the password and email is not configured, print a
one-hour reset URL on the host:

```bash
docker compose exec -T api node apps/server/dist/cmd/reset-password.js
```

## Pre-built images

The start script pulls `ghcr.io/kinggoz18/riddlr-server:latest` and
`riddlr-web:latest` (`linux/amd64` and `linux/arm64`). If that pull fails, it
builds from the clone. A `v*` git tag, or a manual run of the `images`
workflow, publishes new tags. Set `RIDDLR_SERVER_IMAGE` and
`RIDDLR_WEB_IMAGE` to pin a version.

## Native development

See [development.md](development.md). Setup is still the four-step wizard.
`pnpm dev` talks to the API on the same machine, so the setup-code screen does
not appear there. Use Compose `--public` to try that gate.
