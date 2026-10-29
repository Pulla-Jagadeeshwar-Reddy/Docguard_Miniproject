[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$envPath = Join-Path $repoRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
  throw 'Missing .env. Copy .env.example to .env first.'
}

$settings = @{}
Get-Content -LiteralPath $envPath | ForEach-Object {
  if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.*?)\s*$') {
    $settings[$matches[1]] = $matches[2].Trim('"').Trim("'")
  }
}
$adminUser = $settings['POSTGRES_USER']
$runtimePassword = $settings['PG_PASSWORD']
if (-not $adminUser -or -not $runtimePassword -or -not $settings['MONGO_URI'] -or
    -not $settings['MONGO_ROOT_USERNAME'] -or -not $settings['MONGO_ROOT_PASSWORD']) {
  throw '.env must define POSTGRES_USER, PG_PASSWORD, MONGO_URI, MONGO_ROOT_USERNAME, and MONGO_ROOT_PASSWORD.'
}

$database = "docuguard_validation_$([guid]::NewGuid().ToString('N').Substring(0, 10))"
$mongoDatabase = "docuguard_validation_$([guid]::NewGuid().ToString('N').Substring(0, 10))"
$previousPgDatabase = $env:PG_DATABASE
$previousMongoDatabase = $env:MONGO_DB
$previousMongoUri = $env:MONGO_URI
$databaseCreated = $false

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE`: $Command $($Arguments -join ' ')"
  }
}

try {
  Push-Location $repoRoot
  Invoke-Checked 'docker' @('compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', $adminUser)
  Invoke-Checked 'docker' @('compose', 'exec', '-T', 'mongo', 'mongosh', '--username', $settings['MONGO_ROOT_USERNAME'], '--password', $settings['MONGO_ROOT_PASSWORD'], '--authenticationDatabase', 'admin', '--quiet', '--eval', 'db.adminCommand({ ping: 1 }).ok')

  Invoke-Checked 'docker' @('compose', 'exec', '-T', 'postgres', 'createdb', '-U', $adminUser, $database)
  $databaseCreated = $true

  $env:PG_DATABASE = $database
  $env:MONGO_DB = $mongoDatabase
  $env:MONGO_URI = $settings['MONGO_URI']

  # The random database is disposable. The user's configured project database is never reset.
  Invoke-Checked 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'run_all.ps1'), '-Reset', '-Test', '-DatabaseName', $database)

  # Index setup creates empty collection namespaces; this works before any seed documents exist.
  Invoke-Checked 'npm.cmd' @('run', 'db:mongo:indexes')
  Invoke-Checked 'npm.cmd' @('run', 'db:mongo:seed')
  Invoke-Checked 'npm.cmd' @('run', 'db:embeddings')
  Invoke-Checked 'npm.cmd' @('run', 'model:check')
  Invoke-Checked 'npm.cmd' @('run', 'test', '--workspace', 'backend')
  Invoke-Checked 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'run_all.ps1'), '-TestOnly', '-DatabaseName', $database)

  Write-Host 'Isolated integration validation passed. Temporary PostgreSQL and MongoDB databases will be removed.'
} finally {
  if ($databaseCreated) {
    & docker compose exec -T postgres dropdb --if-exists -U $adminUser $database
    if ($LASTEXITCODE -ne 0) { Write-Warning "Could not remove temporary PostgreSQL database $database." }
  }
  if ($env:MONGO_URI -and $env:MONGO_DB -eq $mongoDatabase) {
    & docker compose exec -T mongo mongosh --username $settings['MONGO_ROOT_USERNAME'] `
      --password $settings['MONGO_ROOT_PASSWORD'] --authenticationDatabase admin `
      --quiet $mongoDatabase --eval 'db.dropDatabase()'
    if ($LASTEXITCODE -ne 0) { Write-Warning "Could not remove temporary MongoDB database $mongoDatabase." }
  }
  if ($null -eq $previousPgDatabase) { Remove-Item Env:PG_DATABASE -ErrorAction SilentlyContinue }
  else { $env:PG_DATABASE = $previousPgDatabase }
  if ($null -eq $previousMongoDatabase) { Remove-Item Env:MONGO_DB -ErrorAction SilentlyContinue }
  else { $env:MONGO_DB = $previousMongoDatabase }
  if ($null -eq $previousMongoUri) { Remove-Item Env:MONGO_URI -ErrorAction SilentlyContinue }
  else { $env:MONGO_URI = $previousMongoUri }
  Pop-Location
}
