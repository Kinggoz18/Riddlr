#Requires -Version 5.1
<#
.SYNOPSIS
  Start Riddlr on Windows and print how to finish setup.

.DESCRIPTION
  Same three setup paths as scripts/riddlr-up.sh. Docker Desktop is still
  required. This script can install it with winget (or Chocolatey) after you
  confirm, or with -InstallDocker.
#>
[CmdletBinding()]
param(
  [switch]$Public,
  [switch]$InstallDocker,
  [switch]$Build,
  [switch]$SkipBuild,
  [switch]$Foreground
)

$ErrorActionPreference = "Stop"
# Keep in sync with SETUP_CODE_TTL_MINUTES in packages/domain/src/setup-access.ts
$SetupCodeTtlMinutes = 15
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "docker-compose.yml"))) {
  throw "Run this from a Riddlr clone (docker-compose.yml not found)."
}
Set-Location $Root

function Confirm-Yes {
  param([string]$Question)
  if ($InstallDocker) {
    return $true
  }
  if ([Console]::IsInputRedirected) {
    return $false
  }
  $answer = Read-Host "$Question [y/N]"
  return $answer -match '^[yY]'
}

function Test-DockerRunning {
  & docker info 2>$null | Out-Null
  return $LASTEXITCODE -eq 0
}

function Wait-Docker {
  param([int]$Seconds = 120)
  Write-Host "Waiting for Docker to become ready..."
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-DockerRunning) {
      return $true
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Get-DockerDesktopPath {
  @(
    "${env:ProgramFiles}\Docker\Docker\Docker Desktop.exe",
    "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
    "$env:LOCALAPPDATA\Docker\Docker Desktop.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Start-DockerDesktop {
  $exe = Get-DockerDesktopPath
  if (-not $exe) {
    return $false
  }
  Write-Host "Starting Docker Desktop..."
  Start-Process $exe | Out-Null
  return Wait-Docker -Seconds 180
}

function Update-SessionPath {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
  $dockerBin = Join-Path ${env:ProgramFiles} "Docker\Docker\resources\bin"
  if (Test-Path $dockerBin) {
    $env:Path = "$dockerBin;$env:Path"
  }
}

function Install-DockerDesktop {
  Write-Host "Installing Docker Desktop. Finish any first-run window it shows."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    & winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
      throw "winget could not install Docker Desktop."
    }
  } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
    & choco install docker-desktop -y
    if ($LASTEXITCODE -ne 0) {
      throw "Chocolatey could not install Docker Desktop."
    }
  } else {
    Write-Host "Neither winget nor Chocolatey is available."
    Write-Host "Install Docker Desktop, start it, then run this again."
    Write-Host "https://docs.docker.com/desktop/setup/install/windows-install/"
    return $false
  }
  Update-SessionPath
  Start-Sleep -Seconds 3
  return Start-DockerDesktop
}

function Ensure-Docker {
  Update-SessionPath
  $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
  if ($dockerCmd -and (Test-DockerRunning)) {
    return
  }

  if (-not $dockerCmd) {
    Write-Host "Docker is not installed."
    if (Confirm-Yes "Install Docker Desktop now?") {
      if (-not (Install-DockerDesktop)) {
        exit 1
      }
    } else {
      Write-Host "Install Docker Desktop, start it, then run this again."
      Write-Host "Or re-run with -InstallDocker."
      Write-Host "https://docs.docker.com/desktop/setup/install/windows-install/"
      exit 1
    }
  }

  if (-not (Test-DockerRunning)) {
    Write-Host "Docker is installed but not running."
    if (Confirm-Yes "Start Docker Desktop now?") {
      [void](Start-DockerDesktop)
    }
  }

  Update-SessionPath
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is still not installed. Finish Docker Desktop setup (or reboot), then run this again."
  }
  if (-not (Test-DockerRunning)) {
    throw "Docker is installed but not running. Start Docker Desktop, then run this again."
  }
}

if ($Public -or $env:RIDDLR_SETUP_ACCESS -eq "public") {
  $env:RIDDLR_SETUP_ACCESS = "public"
  if (-not $env:RIDDLR_HTTP_PUBLISH) {
    $env:RIDDLR_HTTP_PUBLISH = "0.0.0.0:8080"
  }
} else {
  if (-not $env:RIDDLR_SETUP_ACCESS) {
    $env:RIDDLR_SETUP_ACCESS = "loopback"
  }
  if (-not $env:RIDDLR_HTTP_PUBLISH) {
    $env:RIDDLR_HTTP_PUBLISH = "127.0.0.1:8080"
  }
}

if ($env:RIDDLR_SETUP_ACCESS -ne "public") {
  $publish = "$($env:RIDDLR_HTTP_PUBLISH)".ToLowerInvariant()
  if ($publish -notmatch '^(127\.0\.0\.1:|localhost:|\[::1\]:)') {
    throw "Refusing to expose the dashboard on the network without a setup code. Pass -Public."
  }
}

Ensure-Docker

& docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose is required (the 'docker compose' plugin). Install Docker Desktop, then run this again."
}

$up = @("up")
if (-not $Foreground) {
  $up += "-d"
}
if ($Build) {
  $up += "--build"
} elseif (-not $SkipBuild) {
  & docker compose pull api worker web
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Published images are not available; building from the clone."
    $up += "--build"
  } else {
    Write-Host "Using published images."
  }
}

& docker compose @up
if ($LASTEXITCODE -ne 0) {
  throw "docker compose up failed."
}

$origin = if ($env:RIDDLR_PUBLIC_URL) { $env:RIDDLR_PUBLIC_URL } else { "http://127.0.0.1:8080" }
Write-Host "Waiting for Riddlr at $origin ..."
$deadline = (Get-Date).AddSeconds(180)
$ready = $false
while ((Get-Date) -lt $deadline) {
  try {
    $null = Invoke-WebRequest -UseBasicParsing -Uri "$origin/api/v1/setup/status" -TimeoutSec 5
    $ready = $true
    break
  } catch {
    Start-Sleep -Seconds 2
  }
}
if (-not $ready) {
  throw "Riddlr did not become ready in time. Check: docker compose ps"
}

Write-Host ""
Write-Host "Riddlr is up."
if ($env:RIDDLR_SETUP_ACCESS -eq "public") {
  $code = & docker compose exec -T api node apps/server/dist/cmd/setup-code.js 2>$null
  if ($LASTEXITCODE -eq 0 -and $code) {
    Write-Host "Setup code (enter it in the browser, then continue setup):"
    Write-Host "  $code"
    Write-Host "This code expires after $SetupCodeTtlMinutes minutes if nobody enters it. Print a new one with:"
    Write-Host "  docker compose exec -T api node apps/server/dist/cmd/setup-code.js"
  } else {
    Write-Host "Setup is already finished, already in progress, or the setup code is no longer available."
  }
  Write-Host "Open $origin and complete the four setup steps."
} else {
  Write-Host "Open in a browser on this machine: $origin"
  $userName = if ($env:USERNAME) { $env:USERNAME } else { "USER" }
  $hostName = $env:COMPUTERNAME
  Write-Host "If Docker is on a remote server, on the machine with the browser run:"
  Write-Host "  ssh -N -L 8080:127.0.0.1:8080 ${userName}@${hostName}"
  Write-Host "Then open http://127.0.0.1:8080 there."
  Write-Host "Setup can also be finished in a terminal on the machine that runs Docker:"
  Write-Host "  docker compose exec -it api node apps/server/dist/cmd/onboard.js"
}
Write-Host ""
