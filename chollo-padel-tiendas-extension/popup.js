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

    // Mostrar backoffs activos con botón para limpiar
    const backoffs = data?.backoffs || {}
    let backoffEl = document.getElementById('backoff-section')
    if (!backoffEl) {
      backoffEl = document.createElement('div')
      backoffEl.id = 'backoff-section'
      backoffEl.style.cssText = 'margin-top:8px; font-size:11px; color:#c0392b'
      document.body.appendChild(backoffEl)
    }
    const entries = Object.entries(backoffs)
    if (entries.length === 0) {
      backoffEl.innerHTML = ''
    } else {
      backoffEl.innerHTML = entries.map(([key, until]) => {
        const horas = Math.ceil((until - Date.now()) / 3600000)
        return `<div>⏸ <b>${key}</b> en backoff (~${horas}h) <button data-key="${key}" style="font-size:10px;cursor:pointer;margin-left:4px">Limpiar</button></div>`
      }).join('')
      backoffEl.querySelectorAll('button[data-key]').forEach(btn => {
        btn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ action: 'clear-backoff', source_key: btn.dataset.key }, () => {
            cargarEstado()
          })
        })
      })
    }
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

// Botón copiar último log
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
      // Fallback: mostrar en el result-box para copiar manualmente
      document.getElementById('lastResult').textContent = texto.substring(0, 200) + '…'
      btn.textContent = '⚠️ Copia manual (ver abajo)'
      setTimeout(() => { btn.textContent = '📋 Copiar último log' }, 3000)
    })
  })
})
