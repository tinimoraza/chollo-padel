# run-grupo-playwright.ps1 — Grupo Playwright: allforpadel, padeliberico, romasport,
#                                               tiendapadel5, padelcoronado, tiendapadelpoint
# Cada grupo usa su propio log para evitar colisiones de escritura simultánea.
$LogFile = "C:\chollo-padel\pipeline-local-pw.log"

$WORKDIR = "C:\chollo-padel\chollo-padel-fase2-v2\chollo-padel-v2"
Set-Location $WORKDIR

$envFile = "$WORKDIR\.env.local"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^([^#=\s][^=]*)=(.*)$") {
            [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
        }
    }
}

$tiendas = @("allforpadel","padeliberico","romasport","tiendapadel5","padelcoronado","tiendapadelpoint","originalpadel")

foreach ($t in $tiendas) {
    $ts = Get-Date -Format "HH:mm:ss"
    "[PW] $ts >> $t" | Out-File -FilePath $LogFile -Append -Encoding utf8
    try {
        npx tsx scripts/pipeline-tiendas.ts $t --no-post 2>&1 | Out-File -FilePath $LogFile -Append -Encoding utf8
    } catch {
        "[PW] ERROR $t : $_" | Out-File -FilePath $LogFile -Append -Encoding utf8
    }
}

"[PW] $(Get-Date -Format 'HH:mm:ss') DONE" | Out-File -FilePath $LogFile -Append -Encoding utf8
