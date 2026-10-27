[CmdletBinding()]
param(
  [switch]$Reset,
  [switch]$Test,
  [switch]$TestOnly,
  [switch]$AuthOnly,
  [switch]$DocumentsOnly
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
$runtimePassword = $settings['PG_PASSWORD']
if (-not $adminUser -or -not $database) {
  throw '.env must define POSTGRES_USER and POSTGRES_DB for migrations.'
}
if (-not $runtimePassword) { throw '.env must define PG_PASSWORD for the runtime database role.' }

function Invoke-SqlFile([string]$filePath, [switch]$NoTransaction) {
  $file = Get-Item -LiteralPath $filePath
  $containerFile = "/tmp/docuguard-$($file.Name)"
  Write-Host "Applying $($file.Name)"
  & docker compose cp $file.FullName "postgres:$containerFile" | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Could not copy $($file.Name) into PostgreSQL." }
  $psqlArgs = @('compose', 'exec', '-T', 'postgres', 'psql', '-U', $adminUser,
    '-d', $database, '-v', 'ON_ERROR_STOP=1')
  if ($file.Name -eq '08_auth_runtime.sql') {
    $psqlArgs += @('-v', "runtime_password=$runtimePassword")
  }
  if (-not $NoTransaction -and $file.Name -ne '08_auth_runtime.sql') { $psqlArgs += '-1' }
  $psqlArgs += @('-f', $containerFile)
  & docker @psqlArgs
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL failed while applying $($file.Name)." }
}

if (($Reset -and $TestOnly) -or ($AuthOnly -and ($Reset -or $TestOnly -or $Test -or $DocumentsOnly)) -or
    ($DocumentsOnly -and ($Reset -or $TestOnly -or $Test))) {
  throw 'AuthOnly and DocumentsOnly cannot be combined with reset, test, or each other.'
}
if ($Reset) {
  Invoke-SqlFile (Join-Path $PSScriptRoot '99_drop.sql')
}

if ($AuthOnly) {
  Invoke-SqlFile (Join-Path $PSScriptRoot '08_auth_runtime.sql') -NoTransaction
} elseif ($DocumentsOnly) {
  Invoke-SqlFile (Join-Path $PSScriptRoot '09_documents.sql')
} elseif (-not $TestOnly) {
  $migrationFiles = Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.sql' -File |
    Where-Object { $_.Name -match '^0[1-9][a-z]?_' } |
    Sort-Object -Property Name
  if (-not $migrationFiles) {
    throw 'No numbered migration files were found.'
  }
  foreach ($file in $migrationFiles) {
    if ($file.Name -eq '08_auth_runtime.sql') {
      Invoke-SqlFile $file.FullName -NoTransaction
    } else {
      Invoke-SqlFile $file.FullName
    }
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
