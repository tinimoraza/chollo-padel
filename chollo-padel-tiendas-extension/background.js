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
// Mapa de aliases por tienda: source_key → Map(titulo_lower → pala_id)
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
    const qs = conflictCols ? `?on_conflict=${encodeURIComponent(conflictCols)}` : ''
    const prefer = `resolution=merge-duplicates,return=minimal`
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${table}${qs}`, {
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
  const sourceKeys = TIENDAS.map(t => t.source_key).join(',')
  const rows = await SB.get(
    `producto_aliases?select=texto_original,pala_id,tienda&tienda=in.(${sourceKeys})&limit=5000`
  )
  for (const t of TIENDAS) {
    aliasCache[t.source_key] = new Map()
  }
  for (const row of rows) {
    const m = aliasCache[row.tienda]
    if (m) m.set((row.texto_original || '').toLowerCase(), row.pala_id)
  }
  aliasCacheLoaded = true
  let total = 0
  for (const t of TIENDAS) {
    const n = aliasCache[t.source_key]?.size ?? 0
    total += n
    console.log(`[tiendas-ext] Aliases cargados: ${t.source_key} → ${n}`)
  }
  console.log(`[tiendas-ext] Total aliases en memoria: ${total}`)
}

// ── OpenCart HTML scraper ─────────────────────────────────────
// tiendapadelpoint: scraping de HTML con DOMParser (disponible en SW Chrome MV3)

function parsePriceES(text) {
  if (!text) return NaN
  const clean = text.trim()
  // Formato ES: "1.299,95 €" → punto miles, coma decimal
  if (clean.includes(',')) {
    return parseFloat(clean.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''))
  }
  return parseFloat(clean.replace(/[^\d.]/g, ''))
}

function aplicarIVA(p) {
  // Heurística: si precio×1.21 da un número "retail" (centavos .90-.99, .00-.05, .50), aplicar IVA
  if (!p || isNaN(p) || p <= 0) return p
  const conIVA = Math.round(p * 121) / 100
  const cents = Math.round((conIVA % 1) * 100)
  const esRetail = cents >= 90 || cents <= 5 || cents === 50
  return esRetail ? conIVA : p
}

function stripTags(s) { return (s || '').replace(/<[^>]+>/g, '').trim() }

async function scrapeOpenCart(tienda, logLines = []) {
  const L = msg => { console.log(msg); logLines.push(`[LOG]  ${msg}`) }
  const productos = []
  const urlsVistas = new Set()   // dedup por URL a través de páginas
  let page = 1
  let totalPages = null
  let prevHtmlLength = 0

  const hostname = new URL(tienda.base_url).hostname
  const cookieHeader = await getCookieHeader(hostname)
  const fetchHeaders = { Accept: 'text/html,application/xhtml+xml' }
  if (cookieHeader) fetchHeaders['Cookie'] = cookieHeader

  while (true) {
    const url = page === 1 ? tienda.base_url : `${tienda.base_url}?page=${page}`
    console.log(`[${tienda.source_key}] Página ${page}${totalPages ? '/' + totalPages : ''}: ${url}`)

    let html
    try {
      const r = await fetch(url, { credentials: 'include', headers: fetchHeaders })
      if (!r.ok) { console.error(`[${tienda.source_key}] HTTP ${r.status} en p${page}`); break }
      html = await r.text()
    } catch (e) {
      console.error(`[${tienda.source_key}] Fetch error p${page}: ${e.message}`)
      break
    }

    // Parar si el HTML es idéntico al de la página anterior (paginación circular)
    if (html.length === prevHtmlLength) {
      L(`[${tienda.source_key}] HTML idéntico a pág anterior — fin paginación (pág ${page})`)
      break
    }
    prevHtmlLength = html.length

    // Detectar total páginas — busca en el bloque de paginación el mayor ?page=N
    if (totalPages === null) {
      const pagBlock = html.match(/class="[^"]*pagination[^"]*"[\s\S]{0,3000}/)
      const nums = pagBlock
        ? [...pagBlock[0].matchAll(/[?&]page=(\d+)/g)].map(m => parseInt(m[1])).filter(n => n > 0)
        : []
      totalPages = nums.length ? Math.max(...nums) : 36
      L(`[${tienda.source_key}] Total páginas: ${totalPages}`)
    }

    // Partir el HTML por bloques product-thumb (regex flexible — admite clases extra)
    const parts = html.split(/class="product-thumb[^"]*"/)
    let count = 0

    for (let i = 1; i < parts.length; i++) {
      // Tomar solo hasta el siguiente product-thumb para no mezclar datos
      const block = parts[i].split(/class="product-thumb[^"]*"/)[0]

      // Título y URL: buscar dentro de class="name"
      const nameBlock = block.match(/class="[^"]*\bname\b[^"]*"[\s\S]{0,500}?<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
      if (!nameBlock) continue
      const href  = nameBlock[1]
      // Dedup por URL (el HTML es acumulativo: cada página incluye las anteriores)
      if (urlsVistas.has(href)) continue
      urlsVistas.add(href)
      const title = stripTags(nameBlock[2])
      if (!title.toLowerCase().startsWith('pala ')) continue
      if (title.toLowerCase().includes('pickleball')) continue

      // Precios
      let price = NaN, original = NaN
      const priceNewM = block.match(/class="[^"]*price-new[^"]*"[^>]*>([\s\S]*?)<\//)
      const priceOldM = block.match(/class="[^"]*price-old[^"]*"[^>]*>([\s\S]*?)<\//)
      const priceM    = block.match(/class="[^"]*\bprice\b[^"]*"[^>]*>([\s\S]*?)<\//)

      if (priceNewM) {
        price    = parsePriceES(stripTags(priceNewM[1]))
        original = priceOldM ? parsePriceES(stripTags(priceOldM[1])) : NaN
      } else if (priceM) {
        const txt = stripTags(priceM[1])
        const ms  = [...txt.matchAll(/([\d.,]+)\s*€/g)]
          .map(m => parsePriceES(m[0])).filter(n => !isNaN(n) && n > 0)
        if (ms.length >= 2) { price = Math.min(...ms); original = Math.max(...ms) }
        else if (ms.length === 1) price = ms[0]
      }

      if (isNaN(price) || price < tienda.price_min) continue

      const finalPrice    = aplicarIVA(price)
      const finalOriginal = (!isNaN(original) && original > price) ? aplicarIVA(original) : null

      // Imagen
      const imgM  = block.match(/data-src="([^"]+)"|<img[^>]+src="([^"]+)"/)
      const rawImg = imgM ? (imgM[1] || imgM[2] || '') : ''
      const image  = rawImg && !rawImg.startsWith('data:') ? rawImg.split('?')[0] : null

      productos.push({ title, price: finalPrice, precio_original: finalOriginal, url: href, image, sku: null })
      count++
    }

    L(`[${tienda.source_key}]  → ${count} productos en pág ${page}/${totalPages} (acum: ${productos.length})`)

    if (page >= totalPages || parts.length <= 1) break
    page++
    await sleep(CONFIG.DELAY_BETWEEN_PAGES_MS)
  }

  return productos
}

// ── WooCommerce Store API ─────────────────────────────────────
// Precios: strings de céntimos ("15995" = 159.95€), currency_minor_unit=2

function centsToEuros(centsStr, minorUnit = 2) {
  if (!centsStr) return NaN
  const n = parseInt(centsStr, 10)
  return isNaN(n) ? NaN : n / Math.pow(10, minorUnit)
}

async function getCookieHeader(domain) {
  return new Promise(resolve => {
    chrome.cookies.getAll({ domain }, cookies => {
      if (!cookies || cookies.length === 0) { resolve(null); return }
      const header = cookies.map(c => `${c.name}=${c.value}`).join('; ')
      const hasCf = cookies.some(c => c.name === 'cf_clearance')
      console.log(`[cookies] ${domain}: ${cookies.length} cookies, cf_clearance=${hasCf}`)
      resolve(header)
    })
  })
}

async function scrapeWooCommerce(tienda, logLines = []) {
  const L = msg => { console.log(msg); logLines.push(`[LOG]  ${msg}`) }
  const productos = []
  let page = 1
  let totalPages = 1

  // Leer cookies de Chrome para este dominio (necesario para Cloudflare)
  const hostname = new URL(tienda.base_url).hostname
  const cookieHeader = await getCookieHeader(hostname)

  while (page <= totalPages) {
    const url =
      `${tienda.base_url}/wp-json/wc/store/v1/products` +
      `?category=${tienda.category}&per_page=${tienda.per_page}&page=${page}`

    L(`[${tienda.source_key}] Página ${page}/${totalPages}: ${url}`)

    const fetchHeaders = { Accept: 'application/json' }
    if (cookieHeader) fetchHeaders['Cookie'] = cookieHeader

    let r
    try {
      r = await fetch(url, {
        credentials: 'include',
        headers: fetchHeaders,
      })
    } catch (e) {
      const msg = `[${tienda.source_key}] Fetch error p${page}: ${e.message}`
      console.error(msg); logLines.push(`[ERR]  ${msg}`)
      break
    }

    if (!r.ok) {
      const msg = `[${tienda.source_key}] HTTP ${r.status} en p${page}`
      console.error(msg); logLines.push(`[ERR]  ${msg}`)
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

    L(`[${tienda.source_key}]  → ${data.length} productos en pág ${page}/${totalPages} (acum: ${productos.length})`)
    page++

    if (page <= totalPages) {
      await sleep(CONFIG.DELAY_BETWEEN_PAGES_MS)
    }
  }

  return productos
}

// ── Procesar y guardar en Supabase ────────────────────────────

async function procesarTienda(tienda, productos) {
  const aliases   = aliasCache[tienda.source_key] ?? new Map()
  const scraped_at = new Date().toISOString()
  const dia_scraped = scraped_at.slice(0, 10)

  let matched = 0, sinMatch = 0, filtrados = 0

  const snapshotsMatch  = []
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
        match_confidence: 1,
        imagen_url:      p.image,
      }
      snapshotsMatch.push(snap)
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

  // Dedup por pala_id: si dos productos distintos tienen el mismo alias,
  // quedarse con el de precio más bajo (o el primero si son iguales)
  const snapsByPalaId = new Map()
  for (const s of snapshotsMatch) {
    const prev = snapsByPalaId.get(s.pala_id)
    if (!prev || s.precio < prev.precio) snapsByPalaId.set(s.pala_id, s)
  }
  const snapsDedupados = Array.from(snapsByPalaId.values())
  if (snapsDedupados.length < snapshotsMatch.length) {
    console.log(`[${tienda.source_key}] Dedup: ${snapshotsMatch.length} → ${snapsDedupados.length} snaps (alias duplicados)`)
  }

  // Upsert price_snapshots en lotes de 200
  for (let i = 0; i < snapsDedupados.length; i += 200) {
    await SB.upsert(
      'price_snapshots',
      snapsDedupados.slice(i, i + 200),
      'pala_id,source_id'
    )
  }

  // Insert price_history_log — usar snapsDedupados para evitar duplicados
  // (historyMatch sin dedup causaba fallo silencioso en el batch si dos URLs→mismo pala_id)
  const historyRows = snapsDedupados.map(s => ({ ...s, dia_scraped }))
  for (let i = 0; i < historyRows.length; i += 200) {
    try {
      await SB.insert('price_history_log', historyRows.slice(i, i + 200))
    } catch (e) {
      // Duplicados (misma pala+source+dia) = ya se insertaron en un ciclo anterior hoy
      console.warn(`[${tienda.source_key}] history_log lote ${i/200 + 1}: ${e.message}`)
    }
  }

  // Upsert palas_candidatas por titulo_normalizado
  for (let i = 0; i < candidatasSinMatch.length; i += 200) {
    try {
      await SB.upsert('palas_candidatas', candidatasSinMatch.slice(i, i + 200), 'titulo_normalizado')
    } catch (e) {
      console.warn(`[${tienda.source_key}] candidatas upsert warning:`, e.message)
    }
  }

  console.log(
    `[${tienda.source_key}] ✅ ${matched} matches | ⚠️ ${sinMatch} sin match | 🚫 ${filtrados} filtrados`
  )
  // Resumen de sin-match por marca para diagnóstico
  let sinMatchResumen = null
  if (sinMatch > 0 && candidatasSinMatch.length > 0) {
    const porMarca = {}
    for (const c of candidatasSinMatch) {
      const words = c.titulo.toLowerCase().replace(/^pala\s+/, '').split(/\s+/)
      const marca = words[0] || '?'
      porMarca[marca] = (porMarca[marca] || 0) + 1
    }
    const marcasSorted = Object.entries(porMarca).sort((a, b) => b[1] - a[1])
    sinMatchResumen = marcasSorted.map(([m, n]) => `${m}(${n})`).join(', ')
  }

  return { matched, sinMatch, filtrados, total: matched + sinMatch, sinMatchResumen }
}

// ── Ciclo principal ───────────────────────────────────────────

async function runScraper() {
  if (isRunning) {
    console.log('[tiendas-ext] Ya hay un scrape en curso — saltando')
    return
  }
  isRunning = true
  const inicio    = Date.now()
  const logLines  = []
  const ts0       = new Date().toISOString()

  // Helper: loguea a consola Y al array de log en disco
  function log(msg)  { console.log(msg);  logLines.push(`[LOG]  ${msg}`) }
  function logE(msg) { console.error(msg); logLines.push(`[ERR]  ${msg}`) }

  logLines.push(`=== Ciclo iniciado: ${ts0} ===`)
  logLines.push(`Tiendas: ${TIENDAS.map(t => t.source_key).join(', ')}`)

  await chrome.storage.local.set({ status: 'running', lastStart: ts0 })

  try {
    await cargarAliases()
    for (const t of TIENDAS) {
      logLines.push(`\n--- Aliases ${t.source_key}: ${aliasCache[t.source_key]?.size ?? 0} ---`)
    }

    let totalMatched = 0, totalSinMatch = 0, totalProductos = 0

    for (const tienda of TIENDAS) {
      log(`\n── Scrapeando ${tienda.nombre} ──`)
      try {
        const productos = tienda.type === 'opencart'
          ? await scrapeOpenCart(tienda, logLines)
          : await scrapeWooCommerce(tienda, logLines)
        if (productos.length === 0) {
          logE(`[${tienda.source_key}] 0 productos — posible bloqueo o tienda vacía`)
          continue
        }
        const res = await procesarTienda(tienda, productos)
        log(`[${tienda.source_key}] ✅ ${res.matched} matches | ⚠️ ${res.sinMatch} sin match | 🚫 ${res.filtrados} filtrados`)
        if (res.sinMatchResumen) {
          log(`[${tienda.source_key}] Sin match por marca: ${res.sinMatchResumen}`)
        }
        totalMatched   += res.matched
        totalSinMatch  += res.sinMatch
        totalProductos += res.total
      } catch (e) {
        logE(`[${tienda.source_key}] Error: ${e.message}`)
      }

      await sleep(CONFIG.DELAY_BETWEEN_STORES_MS)
    }

    const durSeg = Math.round((Date.now() - inicio) / 1000)
    const resumen = `${totalProductos} productos | ${totalMatched} matches | ${totalSinMatch} sin match | ${durSeg}s`
    log(`\n✅ Ciclo completado: ${resumen}`)
    logLines.push(`=== Fin: ${new Date().toISOString()} ===`)

    await chrome.storage.local.set({
      status: 'ok', lastRun: new Date().toISOString(),
      lastResult: resumen, lastMatched: totalMatched, lastTotal: totalProductos,
    })

  } catch (e) {
    logE(`Error general: ${e.message}`)
    logLines.push(`=== Fin con error: ${new Date().toISOString()} ===`)
    await chrome.storage.local.set({ status: 'error', lastError: e.message })
  }

  guardarLog(logLines)
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

// ── Log en storage (sin diálogo de Chrome) ───────────────────
// Guarda los últimos 5 ciclos en chrome.storage.local.
// El popup los muestra y permite copiar al portapapeles.

function guardarLog(lineas) {
  try {
    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const entrada  = { ts, texto: lineas.join('\n') }
    chrome.storage.local.get(['logs'], result => {
      const logs = Array.isArray(result.logs) ? result.logs : []
      logs.unshift(entrada)
      if (logs.length > 5) logs.length = 5
      chrome.storage.local.set({ logs }, () => {
        console.log(`[tiendas-ext] Log guardado en storage (${lineas.length} líneas)`)
      })
    })
  } catch (e) {
    console.warn('[tiendas-ext] guardarLog error:', e.message)
  }
}

// ── Helpers ───────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

console.log(`[tiendas-ext] Service worker arrancado — ${TIENDAS.length} tiendas configuradas`)
