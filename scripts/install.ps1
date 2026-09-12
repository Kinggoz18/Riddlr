#Requires -Version 5.1
<#
.SYNOPSIS
  Clone Riddlr (if needed) and start it on Windows.

.DESCRIPTION
  Does not replace Docker. Same flags as scripts/riddlr-up.ps1.
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
$repoUrl = if ($env:RIDDLR_REPO_URL) { $env:RIDDLR_REPO_URL } else { "https://github.com/Kinggoz18/Riddlr.git" }
$dest = if ($env:RIDDLR_DIR) { $env:RIDDLR_DIR } else { Join-Path $HOME "riddlr" }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error "git is required to clone Riddlr. Install Git for Windows, then run this again."
}

if (Test-Path (Join-Path $dest ".git")) {
  Write-Host "Using existing clone at $dest"
} elseif (Test-Path $dest) {
  Write-Error "$dest exists and is not a git clone. Choose another RIDDLR_DIR."
} else {
  Write-Host "Cloning $repoUrl into $dest"
  & git clone --depth 1 $repoUrl $dest
  if ($LASTEXITCODE -ne 0) {
    Write-Error "git clone failed."
  }
}

$up = Join-Path $dest "scripts\riddlr-up.ps1"
$forward = @{}
foreach ($name in @("Public", "InstallDocker", "Build", "SkipBuild", "Foreground")) {
  if ($PSBoundParameters.ContainsKey($name) -and $PSBoundParameters[$name]) {
    $forward[$name] = $true
  }
}
& $up @forward
