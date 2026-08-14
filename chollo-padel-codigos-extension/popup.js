// popup.js — Chollo Padel Códigos

function cargarEstado() {
  chrome.runtime.sendMessage({ action: 'get-status' }, data => {
    if (chrome.runtime.lastError) return

    const statusEl  = document.getElementById('status')
    const lastRunEl = document.getElementById('lastRun')
    const resultEl  = document.getElementById('lastResult')
    const btnRun    = document.getElementById('btn-run')

    const s = data?.status || 'unknown'
    statusEl.textContent = s === 'ok' ? 'OK ✅' : s === 'running' ? 'Escaneando…' : s === 'error' ? 'Error ❌' : '—'
    statusEl.className = 'status ' + (s === 'ok' ? 'ok' : s === 'running' ? 'running' : s === 'error' ? 'error' : '')

    if (data?.lastRun) {
      const d = new Date(data.lastRun)
      lastRunEl.textContent = d.toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    } else {
      lastRunEl.textContent = 'Nunca'
    }

    if (data?.lastResult) {
      resultEl.textContent = data.lastResult
    } else if (data?.lastError) {
      resultEl.textContent = '⚠️ ' + data.lastError
    } else {
      resultEl.textContent = '—'
    }

    btnRun.disabled = s === 'running'
    btnRun.textContent = s === 'running' ? '⏳ Escaneando…' : '▶ Escanear ahora'
  })
}

cargarEstado()
setInterval(cargarEstado, 2000)

document.getElementById('btn-run').addEventListener('click', () => {
  document.getElementById('btn-run').disabled = true
  document.getElementById('btn-run').textContent = '⏳ Escaneando…'
  chrome.runtime.sendMessage({ action: 'run-now' })
})

document.getElementById('btn-log').addEventListener('click', () => {
  const btn = document.getElementById('btn-log')
  chrome.storage.local.get(['logs'], result => {
    const logs = result.logs
    if (!logs || logs.length === 0) {
      btn.textContent = '⚠️ Sin logs aún'
      setTimeout(() => { btn.textContent = '📋 Copiar último log' }, 2000)
      return
    }
    const ultimo = logs[0]
    const texto = `=== Ciclo ${ultimo.ts} ===\n${ultimo.texto}`
    navigator.clipboard.writeText(texto).then(() => {
      btn.textContent = '✅ Copiado al portapapeles'
      setTimeout(() => { btn.textContent = '📋 Copiar último log' }, 2500)
    }).catch(() => {
      document.getElementById('lastResult').textContent = texto.substring(0, 200) + '…'
      btn.textContent = '⚠️ Copia manual (ver abajo)'
      setTimeout(() => { btn.textContent = '📋 Copiar último log' }, 3000)
    })
  })
})
