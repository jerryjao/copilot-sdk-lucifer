param(
  [string]$Tag = "willh/telegram-copilot-bot",
  [string]$CopilotCliVersion = "latest",
  [string]$Dockerfile = "Dockerfile",
  [string]$Context = ".",
  [switch]$NoCache
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$null = Get-Command docker -ErrorAction Stop

$args = @(
  "build",
  "--file", $Dockerfile,
  "--tag", $Tag
)

if ($CopilotCliVersion) {
  $args += @("--build-arg", "COPILOT_CLI_VERSION=$CopilotCliVersion")
}

if ($NoCache) {
  $args += "--no-cache"
}

$args += $Context

Write-Host "Building Docker image: $Tag"
& docker @args
