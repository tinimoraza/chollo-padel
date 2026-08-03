# run-grupo-a.ps1 — Grupo A: padelnuestro, time2padel, padelproshop, padelspain,
#                            padeltienda, tennispoint, padelvice, stockpadel, starvie
# Cada grupo usa su propio log para evitar colisiones de escritura simultánea.
$LogFile = "C:\chollo-padel\pipeline-local-a.log"

$WORKDIR = "C:\chollo-padel\chollo-padel-fase2-v2\chollo-padel-v2"
Set-Location $WORKDIR

# Cargar variables de entorno desde .env.local
$envFile = "$WORKDIR\.env.local"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^([^#=\s][^=]*)=(.*)$") {
            [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
        }
    }
}

$tiendas = @("padelnuestro","time2padel","padelproshop","padelspain","padeltienda","tennispoint","padelvice","stockpadel","starvie")

foreach ($t in $tiendas) {
    $ts = Get-Date -Format "HH:mm:ss"
    "[A] $ts >> $t" | Out-File -FilePath $LogFile -Append -Encoding utf8
    try {
        npx --yes tsx scripts/pipeline-tiendas.ts $t --no-post 2>&1 | Out-File -FilePath $LogFile -Append -Encoding utf8
    } catch {
        "[A] ERROR $t : $_" | Out-File -FilePath $LogFile -Append -Encoding utf8
    }
}

"[A] $(Get-Date -Format 'HH:mm:ss') DONE" | Out-File -FilePath $LogFile -Append -Encoding utf8
