// popup.js — Chollo Padel Tiendas

// Mostrar tiendas configuradas
const tiendasEl = document.getElementById('tiendas-lista')
if (tiendasEl && typeof TIENDAS !== 'undefined') {
  tiendasEl.innerHTML = TIENDAS.map(t => `<span>${t.nombre}</span>`).join('')
} else {
  // CONFIG no disponible directamente en popup → mostrar lista fija
  tiendasEl.innerHTML =
    '<span>Padel Coronado</span><span>Padel Style</span><span>Padel Tienda</span>'
}

// Cargar estado
function cargarEstado() {
  chrome.runtime.sendMessage({ action: 'get-status' }, data => {
    if (chrome.runtime.lastError) return

    const statusEl  = document.getElementById('status')
    const lastRunEl = document.getElementById('lastRun')
    const resultEl  = document.getElementById('lastResult')
    const btnRun    = document.getElementById('btn-run')

    const s = data?.status || 'unknown'
    statusEl.textContent = s === 'ok' ? 'OK ✅' : s === 'running' ? 'Ejecutando…' : s === 'error' ? 'Error ❌' : '—'
    statusEl.className = 'status ' + (s === 'ok' ? 'ok' : s === 'running' ? 'running' : s === 'error' ? 'error' : '')

    if (data?.lastRun) {
      const d = new Date(data.lastRun)
      lastRunEl.textContent = d.toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
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
    btnRun.textContent = s === 'running' ? '⏳ Ejecutando…' : '▶ Ejecutar ahora'
  })
}

cargarEstado()
setInterval(cargarEstado, 2000)

// Botón ejecutar ahora
document.getElementById('btn-run').addEventListener('click', () => {
  document.getElementById('btn-run').disabled = true
  document.getElementById('btn-run').textContent = '⏳ Ejecutando…'
  chrome.runtime.sendMessage({ action: 'run-now' })
})
