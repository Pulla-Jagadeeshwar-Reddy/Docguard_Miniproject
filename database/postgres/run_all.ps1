[CmdletBinding()]
param(
  [switch]$Reset,
  [switch]$Test,
  [switch]$TestOnly
)

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
$database = $settings['POSTGRES_DB']
if (-not $adminUser -or -not $database) {
  throw '.env must define POSTGRES_USER and POSTGRES_DB for migrations.'
}

function Invoke-SqlFile([string]$filePath, [switch]$NoTransaction) {
  $file = Get-Item -LiteralPath $filePath
  $containerFile = "/tmp/docuguard-$($file.Name)"
  Write-Host "Applying $($file.Name)"
  & docker compose cp $file.FullName "postgres:$containerFile" | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Could not copy $($file.Name) into PostgreSQL." }
  $psqlArgs = @('compose', 'exec', '-T', 'postgres', 'psql', '-U', $adminUser,
    '-d', $database, '-v', 'ON_ERROR_STOP=1')
  if (-not $NoTransaction) { $psqlArgs += '-1' }
  $psqlArgs += @('-f', $containerFile)
  & docker @psqlArgs
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL failed while applying $($file.Name)." }
}

if ($Reset -and $TestOnly) {
  throw 'Use -Reset to rebuild, or -TestOnly to run tests against the current schema.'
}
if ($Reset) {
  Invoke-SqlFile (Join-Path $PSScriptRoot '99_drop.sql')
}

if (-not $TestOnly) {
  $migrationFiles = Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.sql' -File |
    Where-Object { $_.Name -match '^0[1-7][a-z]?_' } |
    Sort-Object -Property Name
  if (-not $migrationFiles) {
    throw 'No numbered migration files were found.'
  }
  foreach ($file in $migrationFiles) {
    Invoke-SqlFile $file.FullName
  }
}

if ($Test -or $TestOnly) {
  $testDir = Join-Path $PSScriptRoot 'tests'
  $testFiles = Get-ChildItem -LiteralPath $testDir -Filter '*.sql' -File | Sort-Object Name
  foreach ($file in $testFiles) {
    Invoke-SqlFile $file.FullName -NoTransaction
  }
}

Write-Host 'PostgreSQL scripts completed.'
