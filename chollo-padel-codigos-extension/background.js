// ============================================================
// CHOLLO PADEL CÓDIGOS — Background Service Worker v1.0
// ============================================================
// Extensión independiente (2026-08-14) dedicada SOLO a mantener fresca la
// tabla codigos_descuento_manual de Supabase. No scrapea catálogo, no
// matchea productos, no toca price_snapshots — eso lo sigue haciendo
// chollo-padel-tiendas-extension (para sus 5 tiendas) y pipeline-tiendas.ts
// (para el resto, vía GitHub Actions / pipeline local). Esta extensión solo
// visita home/rebajas de cada tienda y guarda el código que encuentre (o
// desactiva el que ya no vea) en codigos_descuento_manual.

importScripts('config.js', 'discount-utils.js')

let isRunning = false
// Códigos activos por source_id, en memoria — solo para no reescribir en BD
// si no ha cambiado nada respecto al ciclo anterior.
const codigosCache = {}

// ── Supabase helpers ─────────────────────────────────────────

const SB = {
  headers: {
    'apikey':        CONFIG.SUPABASE_KEY,
    'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
    'Content-Type':  'application/json',
  },

  async get(path) {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${path}`, { headers: this.headers })
    if (!r.ok) throw new Error(`Supabase GET ${path} → ${r.status}`)
    return r.json()
  },

  async upsert(table, rows, conflictCols = '') {
    const qs = conflictCols ? `?on_conflict=${encodeURIComponent(conflictCols)}` : ''
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${table}${qs}`, {
      method: 'POST',
      headers: { ...this.headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    })
    if (!r.ok) throw new Error(`Supabase upsert ${table} → ${r.status}: ${await r.text()}`)
  },

  async patch(tableWithFilter, body) {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${tableWithFilter}`, {
      method: 'PATCH',
      headers: { ...this.headers, Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`Supabase PATCH ${tableWithFilter} → ${r.status}: ${await r.text()}`)
  },
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function getCookieHeader(domain) {
  return new Promise(resolve => {
    chrome.cookies.getAll({ domain }, cookies => {
      if (!cookies || cookies.length === 0) { resolve(null); return }
      resolve(cookies.map(c => `${c.name}=${c.value}`).join('; '))
    })
  })
}

function guardarLog(lineas) {
  try {
    const ts = new Date().toISOString().slice(0, 19)
    const entrada = { ts, texto: lineas.join('\n') }
    chrome.storage.local.get(['logs'], result => {
      const logs = Array.isArray(result.logs) ? result.logs : []
      logs.unshift(entrada)
      if (logs.length > 5) logs.length = 5
      chrome.storage.local.set({ logs })
    })
  } catch (e) {
    console.warn('[codigos-ext] guardarLog error:', e.message)
  }
}

// ── Obtener HTML de una tienda ──────────────────────────────────────────────
// Fase 1: fetch directo con las cookies reales de Chrome (credentials:
// 'include'). Fase 2 (solo needsTab, o si fase 1 falla): tab en background,
// sin foco, sin notificaciones — esto corre desatendido varias veces al día,
// así que si hay un CAPTCHA interactivo sin resolver simplemente se salta
// esta tienda este ciclo (se reintenta en el siguiente).
async function obtenerHtml(store, logLines) {
  const L = msg => { console.log(msg); logLines.push(`[LOG]  ${msg}`) }
  const hostname = new URL(store.url).hostname

  if (!store.needsTab) {
    try {
      const cookieHeader = await getCookieHeader(hostname)
      const headers = { Accept: 'text/html,application/xhtml+xml' }
      if (cookieHeader) headers['Cookie'] = cookieHeader
      const r = await fetch(store.url, { credentials: 'include', headers })
      if (r.ok) {
        const html = await r.text()
        if (html && html.length > 500) return html
      }
      L(`[${store.source_key}] fetch directo no válido (HTTP ${r.status}) — probando tab`)
    } catch (e) {
      L(`[${store.source_key}] fetch directo error: ${e.message} — probando tab`)
    }
  }

  let tabId
  try {
    const tab = await new Promise(r => chrome.tabs.create({ url: store.url, active: false }, r))
    tabId = tab.id
    const ready = await new Promise(resolve => {
      let done = false
      const timer = setTimeout(() => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(fn); resolve(false) } }, 25000)
      function fn(id, info) {
        if (id !== tabId || info.status !== 'complete') return
        if (!done) { done = true; clearTimeout(timer); chrome.tabs.onUpdated.removeListener(fn); resolve(true) }
      }
      chrome.tabs.onUpdated.addListener(fn)
    })
    if (!ready) { L(`[${store.source_key}] tab timeout`); return null }
    await sleep(800)
    const injected = await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      func: () => { try { return document.documentElement.outerHTML } catch (e) { return null } },
    })
    return injected?.[0]?.result || null
  } catch (e) {
    L(`[${store.source_key}] tab error: ${e.message}`)
    return null
  } finally {
    if (tabId) { try { chrome.tabs.remove(tabId, () => {}) } catch {} }
  }
}

// ── Sincronizar código detectado (o su ausencia) con Supabase ──────────────
//   - Detecta código  → upsert en codigos_descuento_manual (nota
//     'Auto-detectado por extensión de códigos') y actualiza codigosCache.
//   - No detecta nada → desactiva SOLO las entradas auto-detectadas (por esta
//     extensión o por el pipeline Node) — nunca toca las que Patricia haya
//     introducido a mano.
async function sincronizarCodigo(store, html, logLines) {
  const L = msg => { console.log(msg); logLines.push(`[LOG]  ${msg}`) }

  if (!html) {
    L(`[${store.source_key}] Sin HTML este ciclo — código sin verificar`)
    return false
  }

  let detectado
  try {
    detectado = detectarCodigoDescuento(html)
  } catch (e) {
    L(`[${store.source_key}] Error en detectarCodigoDescuento: ${e.message}`)
    return false
  }

  const actual = codigosCache[store.source_id]
  const actualTxt    = actual    ? `${actual.codigo} (-${actual.descuento_pct}%)`       : 'ninguno'
  const detectadoTxt = detectado ? `${detectado.codigo} (-${detectado.descuento_pct}%)` : 'ninguno'

  // ── Modo prueba: no escribe nada en BD, solo deja constancia en el log de
  // qué habría hecho. Ver CONFIG.DRY_RUN. Devuelve true si habría habido
  // cambio, para que el resumen del ciclo cuente detecciones reales (en modo
  // prueba codigosCache nunca cambia, así que no sirve para contar).
  if (CONFIG.DRY_RUN) {
    if (detectado) {
      if (actual && actual.codigo === detectado.codigo && actual.descuento_pct === detectado.descuento_pct) {
        L(`[${store.source_key}] ✓ detectado=${detectadoTxt} · BD=${actualTxt} · sin cambios`)
        return false
      } else {
        L(`[${store.source_key}] 🔍 DRY-RUN — detectado=${detectadoTxt} · BD=${actualTxt} · habría guardado/actualizado`)
        return true
      }
    } else if (actual) {
      L(`[${store.source_key}] 🔍 DRY-RUN — detectado=ninguno · BD=${actualTxt} · habría desactivado (si era auto-detectado)`)
      return true
    } else {
      L(`[${store.source_key}] ✓ detectado=ninguno · BD=ninguno · sin cambios`)
      return false
    }
  }

  // ── Modo real (CONFIG.DRY_RUN = false) ──────────────────────────────────
  if (detectado) {
    if (actual && actual.codigo === detectado.codigo && actual.descuento_pct === detectado.descuento_pct) {
      return // sin cambios
    }
    try {
      await SB.upsert('codigos_descuento_manual', [{
        source_id: store.source_id,
        codigo: detectado.codigo,
        descuento_pct: detectado.descuento_pct,
        activo: true,
        nota: 'Auto-detectado por extensión de códigos',
        updated_at: new Date().toISOString(),
      }], 'source_id')
      codigosCache[store.source_id] = { codigo: detectado.codigo, descuento_pct: detectado.descuento_pct }
      L(`[${store.source_key}] 🏷️ Código detectado y guardado: ${detectado.codigo} (-${detectado.descuento_pct}%)`)
    } catch (e) {
      L(`[${store.source_key}] Error guardando código: ${e.message}`)
    }
    return
  }

  if (!actual) return // nada activo, nada que desactivar

  try {
    const rows = await SB.get(
      `codigos_descuento_manual?select=id,codigo,nota&source_id=eq.${store.source_id}&activo=eq.true&nota=ilike.Auto-detectado*`
    )
    if (rows.length === 0) return // el activo es manual (Patricia) → no tocar
    for (const row of rows) {
      await SB.patch(`codigos_descuento_manual?id=eq.${row.id}`, {
        activo: false,
        updated_at: new Date().toISOString(),
      })
    }
    delete codigosCache[store.source_id]
    L(`[${store.source_key}] 🗑️ Código auto-detectado desactivado (ya no visible en la web): ${rows[0].codigo}`)
  } catch (e) {
    L(`[${store.source_key}] Error desactivando código caducado: ${e.message}`)
  }
}

// ── Cargar caché inicial (para no reescribir códigos que ya están al día) ──
async function cargarCodigosCache() {
  try {
    const sourceIds = CODIGOS_TIENDAS.map(t => t.source_id).join(',')
    const rows = await SB.get(
      `codigos_descuento_manual?select=source_id,codigo,descuento_pct&activo=eq.true&source_id=in.(${sourceIds})`
    )
    for (const row of rows) {
      codigosCache[row.source_id] = { codigo: row.codigo, descuento_pct: row.descuento_pct }
    }
  } catch (e) {
    console.warn('[codigos-ext] cargarCodigosCache error (no bloquea):', e.message)
  }
}

// ── Ciclo principal ──────────────────────────────────────────────────────
async function escanearCodigos() {
  if (isRunning) { console.log('[codigos-ext] Ya hay un escaneo en curso — saltando'); return }
  isRunning = true
  const inicio = Date.now()
  const logLines = []
  const ts0 = new Date().toISOString()
  logLines.push(`=== Escaneo de códigos iniciado: ${ts0} ===`)

  await chrome.storage.local.set({ status: 'running', lastStart: ts0 })

  try {
    await cargarCodigosCache()

    let cambios = 0
    for (const store of CODIGOS_TIENDAS) {
      try {
        const html = await obtenerHtml(store, logLines)
        const antes = codigosCache[store.source_id]
        const habriaCambio = await sincronizarCodigo(store, html, logLines)
        const despues = codigosCache[store.source_id]
        if (habriaCambio || JSON.stringify(antes) !== JSON.stringify(despues)) cambios++
      } catch (e) {
        logLines.push(`[ERR]  [${store.source_key}] ${e.message}`)
      }
      await sleep(CONFIG.DELAY_BETWEEN_STORES_MS)
    }

    const durSeg = Math.round((Date.now() - inicio) / 1000)
    const resumen = `${cambios} cambios de ${CODIGOS_TIENDAS.length} tiendas | ${durSeg}s`
    logLines.push(`=== Fin: ${resumen} ===`)

    await chrome.storage.local.set({
      status: 'ok', lastRun: new Date().toISOString(), lastResult: resumen,
    })
  } catch (e) {
    logLines.push(`[ERR]  Error general: ${e.message}`)
    await chrome.storage.local.set({ status: 'error', lastError: e.message })
  }

  guardarLog(logLines)
  isRunning = false
}

// ── Alarma periódica ──────────────────────────────────────────
chrome.alarms.create('scan-codigos', {
  delayInMinutes:  2,
  periodInMinutes: CONFIG.INTERVAL_HOURS * 60,
})

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'scan-codigos') escanearCodigos()
})

// ── Mensajes desde popup ────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'run-now') {
    escanearCodigos().then(() => sendResponse({ ok: true }))
    return true
  }
  if (msg.action === 'get-status') {
    chrome.storage.local.get(['status', 'lastRun', 'lastResult', 'lastError'], data => sendResponse(data))
    return true
  }
})

console.log(`[codigos-ext] Service worker arrancado — ${CODIGOS_TIENDAS.length} tiendas configuradas`)
