// ============================================================
// CHOLLO PADEL TIENDAS — Background Service Worker v1.0
// ============================================================
// Scrapeá tiendas WooCommerce con fetch({ credentials: 'include' })
// → Chrome envía sus cookies reales → Cloudflare no detecta bot.
// Matching por alias (producto_aliases de Supabase).
// Resultados → price_snapshots + price_history_log.
// Sin match → palas_candidatas.

importScripts('config.js')

// ── Estado en memoria ────────────────────────────────────────
let isRunning = false
// Mapa de aliases por tienda: sourceId → Map(titulo_lower → pala_id)
const aliasCache = {}
let aliasCacheLoaded = false

// ── Supabase helpers ─────────────────────────────────────────

const SB = {
  headers: {
    'apikey':        CONFIG.SUPABASE_KEY,
    'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
    'Content-Type':  'application/json',
  },

  async get(path) {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${path}`, {
      headers: this.headers,
    })
    if (!r.ok) throw new Error(`Supabase GET ${path} → ${r.status}`)
    return r.json()
  },

  async upsert(table, rows, conflictCols = '') {
    const prefer = conflictCols
      ? `resolution=merge-duplicates,return=minimal`
      : `return=minimal`
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...this.headers, Prefer: prefer },
      body: JSON.stringify(rows),
    })
    if (!r.ok) {
      const txt = await r.text()
      throw new Error(`Supabase upsert ${table} → ${r.status}: ${txt}`)
    }
  },

  async insert(table, rows) {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...this.headers, Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
    })
    if (!r.ok) {
      const txt = await r.text()
      throw new Error(`Supabase insert ${table} → ${r.status}: ${txt}`)
    }
  },
}

// ── Cargar aliases de Supabase ────────────────────────────────
// Carga producto_aliases para todas las tiendas configuradas.
// Se llama al arrancar y cada vez que se lance un ciclo.

async function cargarAliases() {
  const sourceIds = TIENDAS.map(t => t.source_id).join(',')
  const rows = await SB.get(
    `producto_aliases?select=raw_title,pala_id,source_id&source_id=in.(${sourceIds})`
  )
  for (const t of TIENDAS) {
    aliasCache[t.source_id] = new Map()
  }
  for (const row of rows) {
    const m = aliasCache[row.source_id]
    if (m) m.set((row.raw_title || '').toLowerCase(), row.pala_id)
  }
  aliasCacheLoaded = true
  let total = 0
  for (const t of TIENDAS) {
    const n = aliasCache[t.source_id]?.size ?? 0
    total += n
    console.log(`[tiendas-ext] Aliases cargados: ${t.source_key} → ${n}`)
  }
  console.log(`[tiendas-ext] Total aliases en memoria: ${total}`)
}

// ── WooCommerce Store API ─────────────────────────────────────
// Precios: strings de céntimos ("15995" = 159.95€), currency_minor_unit=2

function centsToEuros(centsStr, minorUnit = 2) {
  if (!centsStr) return NaN
  const n = parseInt(centsStr, 10)
  return isNaN(n) ? NaN : n / Math.pow(10, minorUnit)
}

async function scrapeWooCommerce(tienda) {
  const productos = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages) {
    const url =
      `${tienda.base_url}/wp-json/wc/store/v1/products` +
      `?category=${tienda.category}&per_page=${tienda.per_page}&page=${page}`

    console.log(`[${tienda.source_key}] Página ${page}/${totalPages}: ${url}`)

    let r
    try {
      r = await fetch(url, {
        credentials: 'include',   // ← La magia: Chrome envía sus cookies → pasa Cloudflare
        headers: { Accept: 'application/json' },
      })
    } catch (e) {
      console.error(`[${tienda.source_key}] Fetch error p${page}: ${e.message}`)
      break
    }

    if (!r.ok) {
      console.error(`[${tienda.source_key}] HTTP ${r.status} en p${page}`)
      break
    }

    // El header x-wp-totalpages dice cuántas páginas hay
    const tp = parseInt(r.headers.get('x-wp-totalpages') || '1', 10)
    if (!isNaN(tp) && tp > totalPages) totalPages = tp

    let data
    try {
      data = await r.json()
    } catch {
      console.error(`[${tienda.source_key}] JSON inválido en p${page}`)
      break
    }

    if (!Array.isArray(data) || data.length === 0) break

    for (const p of data) {
      const minorUnit    = p.prices?.currency_minor_unit ?? 2
      const salePrice    = centsToEuros(p.prices?.sale_price,    minorUnit)
      const regularPrice = centsToEuros(p.prices?.regular_price, minorUnit)
      const price        = (!isNaN(salePrice) && salePrice > 0) ? salePrice : regularPrice
      if (isNaN(price) || price < tienda.price_min) continue

      const precio_original = (!isNaN(regularPrice) && regularPrice > price) ? regularPrice : null
      const image = p.images?.[0]?.src || p.images?.[0]?.thumbnail || null

      productos.push({
        title:           p.name,
        price,
        precio_original: precio_original ?? null,
        url:             p.permalink,
        image:           image || null,
        sku:             p.sku || null,
      })
    }

    console.log(`[${tienda.source_key}]  → ${data.length} productos en pág ${page}/${totalPages} (acum: ${productos.length})`)
    page++

    if (page <= totalPages) {
      await sleep(CONFIG.DELAY_BETWEEN_PAGES_MS)
    }
  }

  return productos
}

// ── Procesar y guardar en Supabase ────────────────────────────

async function procesarTienda(tienda, productos) {
  const aliases   = aliasCache[tienda.source_id] ?? new Map()
  const scraped_at = new Date().toISOString()
  const dia_scraped = scraped_at.slice(0, 10)

  let matched = 0, sinMatch = 0, filtrados = 0

  const snapshotsMatch  = []
  const historyMatch    = []
  const candidatasSinMatch = []
  const seen = new Set()

  for (const p of productos) {
    if (!p.url || !p.title || seen.has(p.url)) { filtrados++; continue }
    if (!esPala(p.title)) { filtrados++; continue }
    seen.add(p.url)

    const titleLower = p.title.toLowerCase()
    const pala_id    = aliases.get(titleLower)

    if (pala_id) {
      // ── Match por alias ──────────────────────────────────
      const snap = {
        pala_id,
        source_id:       tienda.source_id,
        precio:          p.price,
        precio_original: p.precio_original,
        url_producto:    p.url,
        disponible:      true,
        sku:             p.sku,
        scraped_at,
        match_confidence: 'alias',
        imagen_url:      p.image,
      }
      snapshotsMatch.push(snap)
      historyMatch.push({ ...snap, dia_scraped })
      matched++
    } else {
      // ── Sin match → palas_candidatas ─────────────────────
      candidatasSinMatch.push({
        titulo:           p.title,
        titulo_normalizado: p.title.toLowerCase(),
        fuentes:          [tienda.source_key],
        precio_min:       p.price,
        precio_max:       p.price,
        urls:             [p.url],
        veces_visto:      1,
        estado:           'pendiente',
      })
      sinMatch++
    }
  }

  // Upsert price_snapshots en lotes de 200
  for (let i = 0; i < snapshotsMatch.length; i += 200) {
    await SB.upsert(
      'price_snapshots',
      snapshotsMatch.slice(i, i + 200),
      'pala_id,source_id'
    )
  }

  // Insert price_history_log en lotes de 200
  for (let i = 0; i < historyMatch.length; i += 200) {
    try {
      await SB.insert('price_history_log', historyMatch.slice(i, i + 200))
    } catch (e) {
      // Ignorar duplicados (misma pala+source+dia)
      console.warn(`[${tienda.source_key}] history_log ya existía para hoy`)
    }
  }

  // Upsert palas_candidatas (dedup por titulo_normalizado+fuente)
  for (let i = 0; i < candidatasSinMatch.length; i += 200) {
    try {
      await SB.upsert('palas_candidatas', candidatasSinMatch.slice(i, i + 200))
    } catch (e) {
      console.warn(`[${tienda.source_key}] candidatas upsert warning:`, e.message)
    }
  }

  console.log(
    `[${tienda.source_key}] ✅ ${matched} matches | ⚠️ ${sinMatch} sin match | 🚫 ${filtrados} filtrados`
  )
  return { matched, sinMatch, filtrados, total: matched + sinMatch }
}

// ── Ciclo principal ───────────────────────────────────────────

async function runScraper() {
  if (isRunning) {
    console.log('[tiendas-ext] Ya hay un scrape en curso — saltando')
    return
  }
  isRunning = true
  const inicio = Date.now()

  await chrome.storage.local.set({ status: 'running', lastStart: new Date().toISOString() })

  try {
    // Recargar aliases al inicio de cada ciclo
    await cargarAliases()

    let totalMatched = 0, totalSinMatch = 0, totalProductos = 0

    for (const tienda of TIENDAS) {
      console.log(`\n[tiendas-ext] ── Scrapeando ${tienda.nombre} ──`)
      try {
        const productos = await scrapeWooCommerce(tienda)
        if (productos.length === 0) {
          console.warn(`[${tienda.source_key}] 0 productos — posible bloqueo o tienda vacía`)
          continue
        }
        const res = await procesarTienda(tienda, productos)
        totalMatched    += res.matched
        totalSinMatch   += res.sinMatch
        totalProductos  += res.total
      } catch (e) {
        console.error(`[${tienda.source_key}] Error:`, e.message)
      }

      await sleep(CONFIG.DELAY_BETWEEN_STORES_MS)
    }

    const durSeg = Math.round((Date.now() - inicio) / 1000)
    const resumen = `${totalProductos} productos | ${totalMatched} matches | ${totalSinMatch} sin match | ${durSeg}s`
    console.log(`\n[tiendas-ext] ✅ Ciclo completado: ${resumen}`)

    await chrome.storage.local.set({
      status:     'ok',
      lastRun:    new Date().toISOString(),
      lastResult: resumen,
      lastMatched: totalMatched,
      lastTotal:   totalProductos,
    })

  } catch (e) {
    console.error('[tiendas-ext] Error general:', e.message)
    await chrome.storage.local.set({ status: 'error', lastError: e.message })
  }

  isRunning = false
}

// ── Alarma periódica ──────────────────────────────────────────

chrome.alarms.create('scrape-tiendas', {
  delayInMinutes:  1,              // Primera ejecución al minuto de instalar
  periodInMinutes: CONFIG.INTERVAL_HOURS * 60,
})

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'scrape-tiendas') runScraper()
})

// ── Mensajes desde popup ──────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'run-now') {
    runScraper().then(() => sendResponse({ ok: true }))
    return true
  }
  if (msg.action === 'get-status') {
    chrome.storage.local.get(
      ['status', 'lastRun', 'lastResult', 'lastMatched', 'lastTotal'],
      data => sendResponse(data)
    )
    return true
  }
})

// ── Helpers ───────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

console.log(`[tiendas-ext] Service worker arrancado — ${TIENDAS.length} tiendas configuradas`)
