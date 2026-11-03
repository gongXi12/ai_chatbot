$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$dockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'

function Test-DockerReady {
  & docker info *> $null
  return $LASTEXITCODE -eq 0
}

if (-not (Test-DockerReady)) {
  if (Test-Path -LiteralPath $dockerDesktop) {
    if (-not (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue)) {
      Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    }
  }
  $deadline = (Get-Date).AddMinutes(10)
  while ((Get-Date) -lt $deadline -and -not (Test-DockerReady)) {
    Start-Sleep -Seconds 5
  }
  if (-not (Test-DockerReady)) { throw 'Docker Desktop did not become ready within 10 minutes.' }
}

Push-Location $workspace
try {
  & docker compose up -d postgres
  if ($LASTEXITCODE -ne 0) { throw 'Failed to start PostgreSQL.' }
  $deadline = (Get-Date).AddMinutes(5)
  do {
    $health = & docker inspect wechat-companion-postgres-1 --format '{{.State.Health.Status}}' 2>$null
    if ($health -eq 'healthy') { break }
    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $deadline)
  if ($health -ne 'healthy') { throw 'PostgreSQL did not become healthy within 5 minutes.' }
  Start-ScheduledTask -TaskName 'WeChat Companion Service'
} finally {
  Pop-Location
}