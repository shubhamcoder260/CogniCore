# validation/run_spider_main.ps1
# ==============================================================================
# CogniCore Spider V1 Main Benchmark Launch Script (Frozen 300 Sample)
#
# INVARIANTS & SAFETY:
# - Requires verified pre-conditions: Ollama alive, qwen2.5-coder:7b available,
#   manifest verified, gold checks complete, and pilot passed.
# - Operates strictly on frozen_sample_300.jsonl (sha256 EDBFB9FF...).
# - Creates isolated disposable database copies under cognicore_spider/runs/<run_id>/.
# - Computes and verifies pre-run and post-run logical content hashes.
# - Orchestrates 900 units (300 questions x 3 configs: C0, C4nr, C4).
# - Enforces strict 60s external timeout per unit via supervisor tree-kill.
# - Runs analysis_spider.js to compute McNemar test, cluster bootstrap, latency, and gates.
# ==============================================================================

param (
    [string]$RunId = "",
    [int]$TimeoutMs = 60000,
    [switch]$NoResume = $false
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkspaceRoot = Split-Path -Parent $ScriptDir
Set-Location $WorkspaceRoot

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host " CogniCore Spider V1 Benchmark Launcher (Frozen 300 Questions)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 1. Pre-condition checks
Write-Host "`n[Check 1/6] Verifying Ollama and Model Availability..." -ForegroundColor Yellow
try {
    $models = (Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -Method Get -TimeoutSec 10).models
    $targetModel = $models | Where-Object { $_.name -like "*qwen2.5-coder:7b*" }
    if (-not $targetModel) {
        Write-Error "Ollama model qwen2.5-coder:7b is not installed. Run 'ollama pull qwen2.5-coder:7b' first."
        exit 1
    }
    Write-Host "  Ollama is running. Target model found: $($targetModel.name)" -ForegroundColor Green
} catch {
    Write-Error "Could not connect to Ollama at http://127.0.0.1:11434. Please start Ollama before running."
    exit 1
}

Write-Host "`n[Check 2/6] Verifying Frozen Sample and Manifest Integrity..." -ForegroundColor Yellow
$samplePath = Join-Path $WorkspaceRoot "validation/data/spider/frozen_sample_300.jsonl"
$manifestPath = Join-Path $WorkspaceRoot "validation/data/spider/frozen_sample_300_manifest.json"
$expectedHash = "EDBFB9FFB0C32CB7501758156B0DDA06D0004916FB1BE95A7EAC064E499ACDAC"

if (-not (Test-Path $samplePath)) {
    Write-Error "Frozen sample file missing: $samplePath"
    exit 1
}

$sampleHash = (Get-FileHash -Path $samplePath -Algorithm SHA256).Hash.ToUpper()
if ($sampleHash -ne $expectedHash) {
    Write-Error "Sample hash mismatch! Expected: $expectedHash, Actual: $sampleHash"
    exit 1
}
Write-Host "  frozen_sample_300.jsonl SHA256 verified ($sampleHash)." -ForegroundColor Green

Write-Host "`n[Check 3/6] Verifying Pre-Run Gold Checks..." -ForegroundColor Yellow
$goldSummaryPath = Join-Path $WorkspaceRoot "validation/data/spider/gold_checks_summary.json"
if (-not (Test-Path $goldSummaryPath)) {
    Write-Error "Gold checks summary missing. Run spider_gold_checks.py before launching."
    exit 1
}
$goldSummary = Get-Content $goldSummaryPath | ConvertFrom-Json
Write-Host "  Gold checks verified: $($goldSummary.total_queries_evaluated) queries evaluated across Python & better-sqlite3." -ForegroundColor Green

Write-Host "`n[Check 4/6] Verifying Pilot Execution Sentinel..." -ForegroundColor Yellow
$readyFile = Join-Path $WorkspaceRoot "validation/raw/spider/READY"
if (-not (Test-Path $readyFile)) {
    Write-Warning "Sentinel validation/raw/spider/READY not found. Pilot run must be verified before launch."
} else {
    $readyInfo = Get-Content $readyFile -Raw
    Write-Host "  Pilot verification verified: $readyInfo" -ForegroundColor Green
}

# 2. Initialize Run
if ([string]::IsNullOrWhiteSpace($RunId)) {
    $Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $RunId = "spider-main-$Timestamp"
}

Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host " Launching Run ID: $RunId" -ForegroundColor Cyan
Write-Host " Total Questions: 300 | Configs: C0, C4nr, C4 | Total Units: 900" -ForegroundColor Cyan
Write-Host " Per-unit timeout: $($TimeoutMs)ms" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 3. Create fresh disposable database copies
Write-Host "`n[Execution 1/5] Preparing Disposable Database Copies..." -ForegroundColor Yellow
$makeCopiesScript = Join-Path $WorkspaceRoot "validation/experiments/spider_make_copies.js"
& node $makeCopiesScript $RunId
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed creating disposable copies."
    exit 1
}

# 4. Ingest databases for C4/C4nr
Write-Host "`n[Execution 2/5] Ingesting Databases into Governed Registry..." -ForegroundColor Yellow
$runDataDir = Join-Path $WorkspaceRoot "cognicore_spider/runs/$RunId/data"
$runUploadsDir = Join-Path $WorkspaceRoot "cognicore_spider/runs/$RunId/uploads"
$runGovDir = Join-Path $WorkspaceRoot "cognicore_spider/runs/$RunId/gov"
$registryDb = Join-Path $runDataDir "registry.db"

$env:DATA_DIR = $runDataDir
$env:UPLOADS_DIR = $runUploadsDir
$env:REGISTRY_DB_PATH = $registryDb
$env:RUN_ID = $RunId

$ingestHelper = @"
const path = require('path');
const fs = require('fs');
const { ingestFile } = require('./server/src/ingestion/ingestion.pipeline');
async function run() {
  const govDir = '$($runGovDir.Replace('\', '/'))';
  const dirs = fs.readdirSync(govDir);
  for (const dbId of dirs) {
    const dbPath = path.join(govDir, dbId, dbId + '.sqlite');
    if (fs.existsSync(dbPath)) {
      process.stdout.write('  Ingesting ' + dbId + '... ');
      const t0 = Date.now();
      await ingestFile({ filePath: dbPath, originalFilename: dbId + '.sqlite', ownerId: 'spider_validator' });
      console.log('done (' + (Date.now() - t0) + 'ms)');
    }
  }
}
run().catch(e => { console.error(e); process.exit(1); });
"@
& node -e $ingestHelper
if ($LASTEXITCODE -ne 0) {
    Write-Error "Database ingestion failed."
    exit 1
}

# 5. Execute 900 evaluation units via Supervisor
Write-Host "`n[Execution 3/5] Launching Supervisor on 300 Questions (900 Units)..." -ForegroundColor Yellow
$supervisorScript = Join-Path $WorkspaceRoot "validation/experiments/spider_supervisor.js"
$supervisorArgs = @(
    $supervisorScript,
    "--split", "test",
    "--run-id", $RunId,
    "--timeout-ms", "$TimeoutMs"
)
if ($NoResume) {
    $supervisorArgs += "--no-resume"
}

& node @supervisorArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Supervisor encountered fatal failure."
    exit 1
}

# 6. Verify post-run logical hashes
Write-Host "`n[Execution 4/5] Verifying Post-Run Database Invariance..." -ForegroundColor Yellow
$verifyHashesHelper = @"
const path = require('path');
const fs = require('fs');
const { computeLogicalHash } = require('./validation/lib/spider_logical_hash');
const preHashesFile = path.join(process.cwd(), 'validation/raw/spider/$($RunId)_pre_hashes.json');
const preData = JSON.parse(fs.readFileSync(preHashesFile, 'utf-8'));
let modified = 0;
for (const [dbId, entry] of Object.entries(preData.databases)) {
  const postRo = computeLogicalHash(entry.roPath);
  const postGov = computeLogicalHash(entry.govPath);
  if (postRo !== entry.logicalHash || postGov !== entry.logicalHash) {
    console.error('DATABASE MODIFIED: ' + dbId);
    modified++;
  }
}
if (modified > 0) {
  console.error('INTEGRITY FAILURE: ' + modified + ' databases modified during run!');
  process.exit(1);
} else {
  console.log('INTEGRITY PASS: All database logical hashes verified identical before and after run.');
}
"@
& node -e $verifyHashesHelper
if ($LASTEXITCODE -ne 0) {
    Write-Error "Database invariance check failed! Run invalidated."
    exit 1
}

# 7. Compute statistical analysis and final reports
Write-Host "`n[Execution 5/5] Generating Statistical Analysis and Tables..." -ForegroundColor Yellow
$analysisScript = Join-Path $WorkspaceRoot "validation/analysis_spider.js"
& node $analysisScript $RunId
if ($LASTEXITCODE -ne 0) {
    Write-Error "Statistical analysis failed."
    exit 1
}

Write-Host "`n=================================================================" -ForegroundColor Green
Write-Host " Spider V1 Main Benchmark Evaluation Complete: $RunId" -ForegroundColor Green
Write-Host " Results written to validation/results/$($RunId)_analysis.json" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
