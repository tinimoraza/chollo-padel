# run-pipeline-local.ps1 — Pipeline maestro local
# Emula los 4 jobs paralelos de pipeline-tiendas-temp.yml
# Lanzar manualmente o via Task Scheduler (cada 2h)

$WORKDIR   = "C:\chollo-padel\chollo-padel-fase2-v2\chollo-padel-v2"
$SCRIPTS   = "C:\chollo-padel\scripts-local"
$LOG       = "C:\chollo-padel\pipeline-local.log"
$LOG_A     = "C:\chollo-padel\pipeline-local-a.log"
$LOG_B     = "C:\chollo-padel\pipeline-local-b.log"
$LOG_C     = "C:\chollo-padel\pipeline-local-c.log"
$LOG_PW    = "C:\chollo-padel\pipeline-local-pw.log"

function Log {
    param($msg)
    $line = "$(Get-Date -Format 'dd/MM HH:mm:ss')  $msg"
    $line | Out-File -FilePath $LOG -Append -Encoding utf8
    Write-Host $line
}

# Rotar log si supera 5 MB
if ((Test-Path $LOG) -and (Get-Item $LOG).Length -gt 5MB) {
    Move-Item $LOG "$LOG.bak" -Force
}

Log "======================================================"
Log "PIPELINE LOCAL START"
Log "======================================================"

# ── Lanzar los 4 grupos en paralelo ───────────────────────────────────────────
# Cada grupo corre en su propia ventana PowerShell oculta.
# Start-Process -PassThru devuelve el proceso para poder esperar.

$args_common = @("-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden")

Log "Lanzando grupos A, B, C y Playwright en paralelo..."

# Cada grupo escribe a su propio log (sin colisiones de escritura simultánea).
# El maestro los fusiona al final.
"" | Out-File $LOG_A -Encoding utf8   # truncar logs anteriores
"" | Out-File $LOG_B -Encoding utf8
"" | Out-File $LOG_C -Encoding utf8
"" | Out-File $LOG_PW -Encoding utf8

$pA = Start-Process "powershell.exe" -ArgumentList ($args_common + @("-File", "$SCRIPTS\run-grupo-a.ps1")) -PassThru -WindowStyle Hidden
$pB = Start-Process "powershell.exe" -ArgumentList ($args_common + @("-File", "$SCRIPTS\run-grupo-b.ps1")) -PassThru -WindowStyle Hidden
$pC = Start-Process "powershell.exe" -ArgumentList ($args_common + @("-File", "$SCRIPTS\run-grupo-c.ps1")) -PassThru -WindowStyle Hidden
$pW = Start-Process "powershell.exe" -ArgumentList ($args_common + @("-File", "$SCRIPTS\run-grupo-playwright.ps1")) -PassThru -WindowStyle Hidden

# Esperar a que terminen todos (máximo 90 min = 5400 seg)
$timeout = 5400
$procs   = @($pA, $pB, $pC, $pW)
$elapsed = 0
$interval = 10

while ($elapsed -lt $timeout) {
    Start-Sleep -Seconds $interval
    $elapsed += $interval
    $pending = $procs | Where-Object { -not $_.HasExited }
    if ($pending.Count -eq 0) { break }
}

# Forzar cierre si alguno sigue vivo (timeout)
$procs | Where-Object { -not $_.HasExited } | ForEach-Object {
    Log "⚠️  Timeout: matando proceso $($_.Id)"
    $_.Kill()
}

Log "Todos los grupos completados."

# ── Fusionar sub-logs en el log principal ──────────────────────────────────────
Log "--- GRUPO A ---"
if (Test-Path $LOG_A) { Get-Content $LOG_A | Out-File $LOG -Append -Encoding utf8 }
Log "--- GRUPO B ---"
if (Test-Path $LOG_B) { Get-Content $LOG_B | Out-File $LOG -Append -Encoding utf8 }
Log "--- GRUPO C ---"
if (Test-Path $LOG_C) { Get-Content $LOG_C | Out-File $LOG -Append -Encoding utf8 }
Log "--- GRUPO PLAYWRIGHT ---"
if (Test-Path $LOG_PW) { Get-Content $LOG_PW | Out-File $LOG -Append -Encoding utf8 }

# ── Post-pipeline ──────────────────────────────────────────────────────────────
Set-Location $WORKDIR

$envFile = "$WORKDIR\.env.local"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^([^#=\s][^=]*)=(.*)$") {
            [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
        }
    }
}

Log ">> post-pipeline (recalcular precios + match)"
npx tsx scripts/post-pipeline.ts 2>&1 | Out-File -FilePath $LOG -Append -Encoding utf8

Log ">> match segunda mano (wallapop_cache: wallapop + vinted)"
npx tsx scripts/match-segunda-mano.ts 2>&1 | Out-File -FilePath $LOG -Append -Encoding utf8

Log ">> notify-chollos-telegram"
npx tsx scripts/notify-chollos-telegram.ts 2>&1 | Out-File -FilePath $LOG -Append -Encoding utf8

Log "======================================================"
Log "PIPELINE LOCAL END"
Log "======================================================"
