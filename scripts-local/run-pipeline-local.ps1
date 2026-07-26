# run-pipeline-local.ps1 — Pipeline maestro local
# Emula los 4 jobs paralelos de pipeline-tiendas-temp.yml
# Lanzar manualmente o via Task Scheduler (cada 2h)

$WORKDIR  = "C:\chollo-padel\chollo-padel-fase2-v2\chollo-padel-v2"
$SCRIPTS  = "C:\chollo-padel\scripts-local"
$LOG      = "C:\chollo-padel\pipeline-local.log"

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

$pA = Start-Process "powershell.exe" -ArgumentList ($args_common + @("-File", "$SCRIPTS\run-grupo-a.ps1", "-LogFile", $LOG)) -PassThru -WindowStyle Hidden
$pB = Start-Process "powershell.exe" -ArgumentList ($args_common + @("-File", "$SCRIPTS\run-grupo-b.ps1", "-LogFile", $LOG)) -PassThru -WindowStyle Hidden
$pC = Start-Process "powershell.exe" -ArgumentList ($args_common + @("-File", "$SCRIPTS\run-grupo-c.ps1", "-LogFile", $LOG)) -PassThru -WindowStyle Hidden
$pW = Start-Process "powershell.exe" -ArgumentList ($args_common + @("-File", "$SCRIPTS\run-grupo-playwright.ps1", "-LogFile", $LOG)) -PassThru -WindowStyle Hidden

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

Log ">> notify-chollos-telegram"
npx tsx scripts/notify-chollos-telegram.ts 2>&1 | Out-File -FilePath $LOG -Append -Encoding utf8

Log "======================================================"
Log "PIPELINE LOCAL END"
Log "======================================================"
