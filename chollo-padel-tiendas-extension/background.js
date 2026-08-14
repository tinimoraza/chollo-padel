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
// Catálogo en memoria para matching por atributos: Array<{id,marca,linea,modelo,variante,año}>
let catalogoAtributos = []
// Códigos de descuento activos por source_id: source_id → { codigo, descuento_pct }
const codigosCache = {}

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

  async patch(tableWithFilter, body) {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${tableWithFilter}`, {
      method: 'PATCH',
      headers: { ...this.headers, Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    })
    if (!r.ok) {
      const txt = await r.text()
      throw new Error(`Supabase PATCH ${tableWithFilter} → ${r.status}: ${txt}`)
    }
  },
}

// ── Cargar aliases de Supabase ────────────────────────────────
// Carga producto_aliases para todas las tiendas configuradas.
// Se llama al arrancar y cada vez que se lance un ciclo.

async function cargarAliases() {
  // Cargamos por tienda en queries separadas para evitar el límite implícito
  // de 1000 filas de Supabase (una sola query con IN() se truncaba a 1000).
  let total = 0
  for (const t of TIENDAS) {
    aliasCache[t.source_key] = new Map()
    try {
      const rows = await SB.get(
        `producto_aliases?select=texto_original,pala_id&tienda=eq.${t.source_key}&limit=2000`
      )
      for (const row of rows) {
        aliasCache[t.source_key].set((row.texto_original || '').toLowerCase(), row.pala_id)
      }
    } catch (e) {
      console.error(`[tiendas-ext] Error cargando aliases ${t.source_key}:`, e.message)
    }
    const n = aliasCache[t.source_key].size
    total += n
    console.log(`[tiendas-ext] Aliases cargados: ${t.source_key} → ${n}`)
  }
  aliasCacheLoaded = true
  console.log(`[tiendas-ext] Total aliases en memoria: ${total}`)
}

// Carga códigos de descuento activos desde codigos_descuento_manual
// para las tiendas de la extensión y los mantiene en codigosCache.
async function cargarCodigos() {
  const sourceIds = TIENDAS.map(t => t.source_id).join(',')
  try {
    const rows = await SB.get(
      `codigos_descuento_manual?select=source_id,codigo,descuento_pct&activo=eq.true&source_id=in.(${sourceIds})`
    )
    // Limpiar caché anterior
    for (const t of TIENDAS) delete codigosCache[t.source_id]
    for (const row of rows) {
      codigosCache[row.source_id] = { codigo: row.codigo, descuento_pct: row.descuento_pct }
    }
    const activos = Object.entries(codigosCache).map(([id, c]) => `source_id=${id}:${c.codigo}(${c.descuento_pct}%)`).join(', ')
    console.log(`[tiendas-ext] Códigos activos: ${activos || 'ninguno'}`)
  } catch (e) {
    console.warn('[tiendas-ext] cargarCodigos error (no bloquea):', e.message)
  }
}

// ── Recalcular price_reference ────────────────────────────────
// Puerto de post-pipeline.ts → recalcularPrecios().
// Misma lógica: media aritmética de precios del día más reciente en
// price_history_log (excluyendo PadelZoom source_id=2) para cada pala.
// Se llama al final de cada ciclo con los pala_ids que acaban de actualizarse.
//
// Eficiencia: 1 query batch (price_history_log), N upserts a price_reference
// en lotes de 200, y 1 solo PATCH a palas para actualizar precios_updated_at.
// precios_updated_at es el timestamp que activa el filtro de frescura de
// /api/chollos (snapAt <= refUpdatedAt + 3h) — sin actualizarlo, los nuevos
// snapshots de la extensión quedarían filtrados aunque el price_reference
// esté actualizado.

async function recalcularPriceReference(palaIds) {
  if (!palaIds || palaIds.length === 0) return 0
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  try {
    // Query en lotes de 100 para no superar el límite de URL de PostgREST (~8KB).
    // 676 pala_ids × 36 chars ≈ 25.000 chars → 414 si se manda todo de golpe.
    const CHUNK = 100
    const allRows = []
    for (let i = 0; i < palaIds.length; i += CHUNK) {
      const chunk = palaIds.slice(i, i + CHUNK)
      const rows = await SB.get(
        `price_history_log?select=pala_id,dia_scraped,precio,source_id` +
        `&pala_id=in.(${chunk.join(',')})` +
        `&source_id=neq.2` +
        `&disponible=eq.true` +
        `&dia_scraped=gte.${since}` +
        `&order=dia_scraped.desc` +
        `&limit=2000`
      )
      if (rows && rows.length) allRows.push(...rows)
    }
    const rows = allRows
    if (!rows || rows.length === 0) {
      console.log('[tiendas-ext] recalcularPriceReference: sin filas en price_history_log')
      return 0
    }

    // Agrupar por pala_id; rows ya viene ordenado por dia_scraped DESC
    const porPala = {}
    for (const row of rows) {
      if (!porPala[row.pala_id]) porPala[row.pala_id] = []
      porPala[row.pala_id].push(row)
    }

    const now = new Date().toISOString()
    const refRows = []

    for (const [palaId, filas] of Object.entries(porPala)) {
      // Precio más reciente por fuente (ventana 7 días desde la fecha más reciente).
      // Antes: solo los precios del ultimoDia — excluía fuentes que no corrieran ese día.
      // Ahora: si tiendapadelpoint corrió ayer (vía extensión) y el pipeline falló hoy,
      // su precio de ayer sigue contribuyendo a la media mientras esté dentro de 7 días.
      const ultimoDia = filas[0].dia_scraped // filas ya ordenado desc
      const cutoff = new Date(new Date(ultimoDia).getTime() - 7 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10)
      const porFuente = {}
      for (const r of filas) {
        if (r.dia_scraped < cutoff) break
        if (!porFuente[r.source_id]) porFuente[r.source_id] = Number(r.precio)
      }
      const precios = Object.values(porFuente)

      const media     = parseFloat((precios.reduce((a, b) => a + b, 0) / precios.length).toFixed(2))
      const minPrecio = Math.min(...precios)
      const maxPrecio = Math.max(...precios)

      refRows.push({
        pala_id:           palaId,
        precio_referencia: media,
        precio_minimo:     minPrecio,
        precio_maximo:     maxPrecio,
        fuentes_count:     precios.length,
        updated_at:        now,
      })
    }

    // Batch upsert price_reference
    for (let i = 0; i < refRows.length; i += 200) {
      await SB.upsert('price_reference', refRows.slice(i, i + 200), 'pala_id')
    }

    // Un solo PATCH actualiza precios_updated_at en palas (filtro de frescura /api/chollos)
    await SB.patch(`palas?id=in.(${palaIds.join(',')})`, { precios_updated_at: now })

    console.log(`[tiendas-ext] price_reference: ${refRows.length} palas actualizadas`)
    return refRows.length
  } catch (e) {
    console.warn('[tiendas-ext] recalcularPriceReference error (no bloquea):', e.message)
    return 0
  }
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

// ── Helper compartido: parsear un bloque HTML de página OpenCart ──────────────
// Devuelve los productos encontrados (nuevos, no ya en urlsVistas).
function _parseOpenCartHtml(html, urlsVistas, tienda) {
  const found = []
  const parts = html.split(/class="product-thumb[^"]*"/)
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i].split(/class="product-thumb[^"]*"/)[0]
    const nameBlock = block.match(/class="[^"]*\bname\b[^"]*"[\s\S]{0,500}?<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!nameBlock) continue
    const href = nameBlock[1]
    if (urlsVistas.has(href)) continue
    urlsVistas.add(href)
    const title = stripTags(nameBlock[2])
    // tienda.pala_prefix=true → títulos deben empezar por "Pala " (ej: tiendapadelpoint)
    // Sin pala_prefix → usar esPala() de config.js (filtra accesorios por EXCLUIR_TITULOS)
    if (tienda.pala_prefix) {
      if (!title.toLowerCase().startsWith('pala ')) continue
    } else {
      if (!esPala(title)) continue
    }
    if (title.toLowerCase().includes('pickleball')) continue
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
    const imgM  = block.match(/data-src="([^"]+)"|<img[^>]+src="([^"]+)"/)
    const rawImg = imgM ? (imgM[1] || imgM[2] || '') : ''
    const image  = rawImg && !rawImg.startsWith('data:') ? rawImg.split('?')[0] : null
    found.push({ title, price: finalPrice, precio_original: finalOriginal, url: href, image, sku: null })
  }
  return found
}

// ── Helper: detectar nº de páginas en HTML paginado de OpenCart ───────────────
function _detectOpenCartTotalPages(html, fallback = 36, pageStyle = 'query') {
  const pagBlock = html.match(/class="[^"]*pagination[^"]*"[\s\S]{0,3000}/)
  // query: ?page=N (tiendapadelpoint) | path: /page/N/ (originalpadel)
  const pattern = pageStyle === 'path' ? /\/page\/(\d+)\//g : /[?&]page=(\d+)/g
  const nums = pagBlock
    ? [...pagBlock[0].matchAll(pattern)].map(m => parseInt(m[1])).filter(n => n > 0)
    : []
  return nums.length ? Math.max(...nums) : fallback
}

async function scrapeOpenCart(tienda, logLines = []) {
  const L = msg => { console.log(msg); logLines.push(`[LOG]  ${msg}`) }
  const productos = []
  const urlsVistas = new Set()
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
    if (html.length === prevHtmlLength) {
      L(`[${tienda.source_key}] HTML idéntico a pág anterior — fin paginación (pág ${page})`)
      break
    }
    prevHtmlLength = html.length

    if (totalPages === null) {
      totalPages = _detectOpenCartTotalPages(html)
      L(`[${tienda.source_key}] Total páginas: ${totalPages}`)
    }

    const found = _parseOpenCartHtml(html, urlsVistas, tienda)
    productos.push(...found)
    L(`[${tienda.source_key}]  → ${found.length} productos en pág ${page}/${totalPages} (acum: ${productos.length})`)

    if (page >= totalPages || found.length === 0) break
    page++
    await sleep(CONFIG.DELAY_BETWEEN_PAGES_MS)
  }

  return productos
}

// ── OpenCart vía Tab (bypass 403 — la sesión del tab lleva las cookies) ───────
// Idéntico a scrapeOpenCart pero obtiene el HTML desde dentro de un tab Chrome,
// heredando las cookies de sesión que el servidor estableció al cargar la página.
// CF titles que indican JS challenge auto-resolvible (sin CAPTCHA)
const CF_AUTO_KW    = ['un momento', 'just a moment']
// CF titles que requieren interacción humana (CAPTCHA)
const CF_CAPTCHA_KW = ['attention required', 'bot verification', 'checking your', 'verificando']

async function scrapeOpenCartViaTab(tienda, logLines = []) {
  const L = msg => { console.log(msg); logLines.push(`[LOG]  ${msg}`) }

  // Esperar a que un tab esté en status=complete, con timeout
  function waitTabComplete(tabId, timeoutMs = 20000) {
    return new Promise(resolve => {
      let done = false
      const timer = setTimeout(() => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(fn); resolve(false) } }, timeoutMs)
      function fn(id, info) {
        if (id !== tabId || info.status !== 'complete') return
        if (!done) { done = true; clearTimeout(timer); chrome.tabs.onUpdated.removeListener(fn); resolve(true) }
      }
      chrome.tabs.onUpdated.addListener(fn)
    })
  }

  // Esperar a que el tab cargue y NO sea una página de challenge CF
  // CF invisible JS challenge: carga "Un momento…" → auto-redirige a la real en ~2-5s
  async function waitTabReady(tabId, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const ok = await waitTabComplete(tabId, Math.max(1000, deadline - Date.now()))
      if (!ok) return false
      const t = await new Promise(r => chrome.tabs.get(tabId, r)).catch(() => null)
      if (!t) return false
      const title = (t.title || '').toLowerCase()
      if (!CF_AUTO_KW.some(k => title.includes(k)) && !CF_CAPTCHA_KW.some(k => title.includes(k))) {
        L(`[${tienda.source_key}] Página real: "${t.title}"`)
        return true
      }
      if (CF_CAPTCHA_KW.some(k => title.includes(k))) {
        // Necesita interacción humana — salir del loop y manejar fuera
        L(`[${tienda.source_key}] CF CAPTCHA detectado`)
        return 'captcha'
      }
      // CF auto challenge — esperar la siguiente carga (CF redirigirá sola)
      L(`[${tienda.source_key}] CF invisible ("${t.title}") — esperando resolución automática...`)
      await new Promise(r => setTimeout(r, 3000)) // pausa antes de volver a escuchar
    }
    return false
  }

  // Abrir tab en background (sin robar el foco)
  L(`[${tienda.source_key}] Abriendo tab (bypass 403)...`)
  const tab = await new Promise(r => chrome.tabs.create({ url: tienda.base_url, active: false }, r))
  const tabId = tab.id

  const readyState = await waitTabReady(tabId, 90000)
  if (!readyState) {
    L(`[${tienda.source_key}] Tab timeout — abortando`)
    try { chrome.tabs.remove(tabId, () => {}) } catch {}
    return []
  }

  if (readyState === 'captcha') {
    // CF CAPTCHA manual
    const tabInfo2 = await new Promise(r => chrome.tabs.get(tabId, r))
    L(`[${tienda.source_key}] Activando tab para resolución manual CF`)
    chrome.tabs.update(tabId, { active: true })
    chrome.windows.update(tabInfo2.windowId, { focused: true })
    chrome.notifications.create('cf-tab-' + tienda.source_key, {
      type: 'basic', iconUrl: 'icon.png',
      title: '🔓 Chollo Padel — ' + tienda.nombre,
      message: 'Cloudflare CAPTCHA detectado. Haz clic en el checkbox "Verificar que eres humano". La pestaña se cerrará sola.',
      priority: 2,
    })
    const captchaReady = await waitTabReady(tabId, 120000)
    try { chrome.notifications.clear('cf-tab-' + tienda.source_key, () => {}) } catch {}
    if (!captchaReady || captchaReady === 'captcha') {
      try { chrome.tabs.remove(tabId, () => {}) } catch {}
      return []
    }
  }

  // Scrapear páginas navegando el tab (Sec-Fetch-Mode: navigate, no fetch/XHR)
  // El servidor bloquea fetch() pero permite navegación real del browser.
  const productos = []
  const urlsVistas = new Set()
  let page = 1
  let totalPages = null

  while (true) {
    // page_style 'path' → /page/N/ (originalpadel); 'query' → ?page=N (tiendapadelpoint)
    const url = page === 1
      ? tienda.base_url
      : tienda.page_style === 'path'
        ? `${tienda.base_url}page/${page}/`
        : `${tienda.base_url}?page=${page}`
    L(`[${tienda.source_key}] Tab nav pág ${page}${totalPages ? '/' + totalPages : ''}: ${url}`)

    // Obtener HTML:
    // - Pág 1: ya cargada en el tab → outerHTML
    // - Pág 2+: fetch desde dentro del tab (mismo origen, CF ya resuelto → sin 403)
    //   mucho más rápido que redirigir el tab entero (evita recargar 4-5 MB de assets)
    let html
    if (page === 1) {
      await sleep(500)
      try {
        L(`[${tienda.source_key}] executeScript pág 1...`)
        const injected = await chrome.scripting.executeScript({
          target: { tabId, allFrames: false },
          func: () => {
            try { return document.documentElement.outerHTML } catch (e) { return '__ERR__:' + e.message }
          },
        })
        html = injected?.[0]?.result
        L(`[${tienda.source_key}] HTML resultado: string(${html?.length ?? 0}) prev="${(html||'').slice(0,80).replace(/\n/g,' ')}"`)
        if (!html || html.startsWith('__ERR__')) { L(`[${tienda.source_key}] outerHTML inválido pág 1`); break }
      } catch (e) {
        L(`[${tienda.source_key}] executeScript pág 1 error: ${e?.message ?? String(e)}`)
        break
      }
    } else {
      // fetch desde dentro del tab — mismo origen con cookie cf_clearance ya resuelta
      // Si el servidor rate-limita (403), fallback a navegación real del tab
      let usedFetch = true
      try {
        L(`[${tienda.source_key}] fetch interno pág ${page}...`)
        const injected = await chrome.scripting.executeScript({
          target: { tabId },
          func: async (fetchUrl) => {
            try {
              const r = await fetch(fetchUrl, {
                credentials: 'include',
                headers: { Accept: 'text/html,application/xhtml+xml' },
              })
              if (!r.ok) return { error: `HTTP ${r.status}`, html: null }
              return { html: await r.text(), error: null }
            } catch (e) { return { error: e.message, html: null } }
          },
          args: [url],
        })
        const res = injected?.[0]?.result
        if (!res || res.error) {
          L(`[${tienda.source_key}] fetch interno pág ${page} error: ${res?.error} — reintentando con nav`)
          usedFetch = false
        } else {
          html = res.html
          L(`[${tienda.source_key}] fetch interno pág ${page}: string(${html?.length ?? 0})`)
        }
      } catch (e) {
        L(`[${tienda.source_key}] executeScript fetch pág ${page}: ${e?.message} — reintentando con nav`)
        usedFetch = false
      }

      // Fallback: navegar el tab si el fetch falló (CF rate-limit o 403)
      if (!usedFetch) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: (u) => { window.location.href = u },
            args: [url],
          })
        } catch (e) { L(`[${tienda.source_key}] Error nav fallback pág ${page}: ${e.message}`); break }
        const navReady = await waitTabComplete(tabId, 45000)
        if (!navReady) { L(`[${tienda.source_key}] Timeout nav fallback pág ${page}`); break }
        await sleep(500)
        try {
          const injected = await chrome.scripting.executeScript({
            target: { tabId, allFrames: false },
            func: () => document.documentElement.outerHTML,
          })
          html = injected?.[0]?.result
          if (!html) { L(`[${tienda.source_key}] outerHTML vacío nav fallback pág ${page}`); break }
          L(`[${tienda.source_key}] nav fallback pág ${page}: string(${html.length})`)
        } catch (e) { L(`[${tienda.source_key}] outerHTML nav fallback error pág ${page}: ${e.message}`); break }
      }
    }

    if (totalPages === null) {
      // Fallback alto: si no se detecta paginación, intentar hasta 36 páginas
      // (el dedup por URL + ausencia de product-thumb cortarán antes si no hay más)
      totalPages = _detectOpenCartTotalPages(html, 36, tienda.page_style || 'query')
      L(`[${tienda.source_key}] Total páginas: ${totalPages}`)
    }

    const prevCount = urlsVistas.size
    const found = _parseOpenCartHtml(html, urlsVistas, tienda)
    productos.push(...found)
    const noNewUrls = urlsVistas.size === prevCount  // todas las URLs ya vistas → fin
    const noProductThumb = !html.includes('product-thumb')
    L(`[${tienda.source_key}]  → ${found.length} productos en pág ${page}/${totalPages} (acum: ${productos.length})`)

    if (page >= totalPages || noNewUrls || noProductThumb) break
    page++
    await sleep(CONFIG.DELAY_BETWEEN_PAGES_MS)
  }

  try { chrome.tabs.remove(tabId, () => {}) } catch {}
  L(`[${tienda.source_key}] Tab cerrado. ${productos.length} productos obtenidos.`)
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

// Abre un tab en Chrome para que Cloudflare establezca cf_clearance, luego lo cierra.
// Espera hasta que el tab haya cargado o pase el timeout.
async function warmupCloudflareCookie(baseUrl, timeoutMs = 8000) {
  const domain = new URL(baseUrl).hostname
  console.log(`[cf-warmup] Abriendo tab para obtener cf_clearance: ${baseUrl}`)
  return new Promise(resolve => {
    chrome.tabs.create({ url: baseUrl, active: false }, tab => {
      const tabId = tab.id
      let done = false
      const timer = setTimeout(() => {
        if (done) return
        done = true
        chrome.tabs.remove(tabId, () => {})
        console.log(`[cf-warmup] Tab cerrado tras timeout (${timeoutMs}ms)`)
        resolve()
      }, timeoutMs)

      chrome.tabs.onUpdated.addListener(function listener(id, info) {
        if (id !== tabId) return
        if (info.status === 'complete') {
          if (done) return
          done = true
          clearTimeout(timer)
          chrome.tabs.onUpdated.removeListener(listener)
          // Pequeña pausa extra para que CF escriba la cookie
          setTimeout(() => {
            chrome.tabs.remove(tabId, () => {})
            console.log(`[cf-warmup] Tab cerrado tras carga completa`)
            resolve()
          }, 1500)
        }
      })
    })
  })
}

// ── Helper: fetch directo a WooCommerce Store API (sin tab) ──────────────────
// Se usa cuando ya hay cf_clearance válido en Chrome.
// credentials:'include' + host_permissions en manifest → Chrome envía
// cf_clearance automáticamente al dominio destino sin CORS.

async function _fetchWooCommerceDirecto(tienda, logLines = []) {
  const L = msg => { console.log(msg); logLines.push(`[LOG]  ${msg}`) }
  const hostname = new URL(tienda.base_url).hostname
  const cookieHeader = await getCookieHeader(hostname)
  const productos = []
  let page = 1, totalPages = 1

  while (page <= totalPages) {
    const url =
      `${tienda.base_url}/wp-json/wc/store/v1/products` +
      `?category=${tienda.category}&per_page=${tienda.per_page}&page=${page}`
    L(`[${tienda.source_key}] Directo pág ${page}/${totalPages}: ${url}`)

    const headers = { Accept: 'application/json' }
    if (cookieHeader) headers['Cookie'] = cookieHeader

    let r
    try {
      r = await fetch(url, { credentials: 'include', headers })
    } catch (e) {
      L(`[${tienda.source_key}] Directo error: ${e.message}`)
      return []   // CF bloqueó — señal para abrir tab
    }
    if (!r.ok) {
      L(`[${tienda.source_key}] Directo HTTP ${r.status} (CF challenge o error)`)
      return []   // Igual, señal para abrir tab
    }
    const tp = parseInt(r.headers.get('x-wp-totalpages') || '1', 10)
    if (!isNaN(tp) && tp > totalPages) totalPages = tp
    let data
    try { data = await r.json() } catch { return [] }
    // Sanity-check: CF devuelve HTML en vez de JSON cuando bloquea
    if (!Array.isArray(data)) {
      L(`[${tienda.source_key}] Directo: respuesta no es JSON (posible challenge CF)`)
      return []
    }
    if (data.length === 0) break

    for (const p of data) {
      const minorUnit    = p.prices?.currency_minor_unit ?? 2
      const salePrice    = centsToEuros(p.prices?.sale_price,    minorUnit)
      const regularPrice = centsToEuros(p.prices?.regular_price, minorUnit)
      const price        = (!isNaN(salePrice) && salePrice > 0) ? salePrice : regularPrice
      if (isNaN(price) || price < tienda.price_min) continue
      const precio_original = (!isNaN(regularPrice) && regularPrice > price) ? regularPrice : null
      productos.push({
        title: p.name, price, precio_original,
        url: p.permalink, image: p.images?.[0]?.src || null, sku: p.sku || null,
      })
    }
    L(`[${tienda.source_key}]  → ${data.length} en pág ${page}/${totalPages} (acum: ${productos.length})`)
    page++
    if (page <= totalPages) await sleep(CONFIG.DELAY_BETWEEN_PAGES_MS)
  }
  return productos
}

// ── WooCommerce vía tab injection (para sitios con CF Turnstile) ──────────────
//
// Flujo optimizado de 2 fases:
//
// FASE 1 — Fetch directo (automático, sin tab):
//   Si Chrome ya tiene cf_clearance válido para este dominio (de un clic previo
//   del usuario o de un challenge pasivo resuelto), el service worker lo envía
//   automáticamente con credentials:'include'. Funciona sin abrir nada.
//   → Cubre el 90%+ de los casos (cf_clearance dura ~30 días).
//
// FASE 2 — Tab activo (requiere clic del usuario la primera vez):
//   Solo si FASE 1 devuelve 0 productos (no hay cf_clearance o expiró).
//   Abre un tab visible → CF challenge pasivo se resuelve solo (segundos);
//   si es Turnstile interactivo, el usuario hace clic UNA vez, cf_clearance
//   queda en Chrome y la próxima ejecución volverá a FASE 1 (sin tab).
//   SIN TIMEOUT: espera hasta que CF resuelva o el usuario cierre el tab.

async function scrapeWooCommerceViaTab(tienda, logLines = []) {
  const L = msg => { console.log(msg); logLines.push(`[LOG]  ${msg}`) }

  // ── FASE 1: Fetch directo ─────────────────────────────────────────────────
  const hostname = new URL(tienda.base_url).hostname
  const cookieHeader = await getCookieHeader(hostname)
  const tieneCf = cookieHeader && cookieHeader.includes('cf_clearance')

  if (tieneCf) {
    L(`[${tienda.source_key}] cf_clearance en Chrome → intentando fetch directo (sin tab)...`)
    const directos = await _fetchWooCommerceDirecto(tienda, logLines)
    if (directos.length > 0) {
      L(`[${tienda.source_key}] ✅ Fetch directo: ${directos.length} productos (sin abrir tab)`)
      return directos
    }
    L(`[${tienda.source_key}] Fetch directo devolvió 0 (cf_clearance posiblemente expirado) → abriendo tab...`)
  } else {
    L(`[${tienda.source_key}] Sin cf_clearance → primera vez o expiró. Abriendo tab...`)
  }

  // ── FASE 2: Tab activo, sin timeout ──────────────────────────────────────
  L(`[${tienda.source_key}] Abriendo tab activo para Cloudflare...`)

  const tab = await new Promise(r =>
    chrome.tabs.create({ url: tienda.base_url + '/', active: true }, r)
  )
  if (!tab) { L(`[${tienda.source_key}] Error interno: chrome.tabs.create devolvió undefined — saltando sin backoff`); return null }
  const tabId = tab.id
  chrome.windows.update(tab.windowId, { focused: true })

  // Notificación persistente para que Patricia sepa qué hacer
  chrome.notifications.create('cf-tab-' + tienda.source_key, {
    type: 'basic', iconUrl: 'icon.png',
    title: '🔓 Chollo Padel — ' + tienda.nombre,
    message: 'Se abrió una pestaña de Cloudflare. Si ves un checkbox "Verificar que eres humano", haz clic. La pestaña se cerrará sola cuando esté lista. (Solo necesitas hacerlo una vez al mes.)',
    priority: 2,
  })

  const CHALLENGE_KW = ['bot verification', 'just a moment', 'attention required', 'checking your', 'verificando']

  // Sin timeout fijo: resuelve cuando CF pasa O cuando el usuario cierra el tab.
  // chrome.tabs.onUpdated → CF resolvió (página cargada, sin palabras de challenge)
  // chrome.tabs.onRemoved → usuario cerró el tab manualmente (sin resolver)
  const pageReady = await new Promise(resolve => {
    let resolved = false

    function cleanup() {
      if (!resolved) {
        resolved = true
        chrome.tabs.onUpdated.removeListener(onUpdated)
        chrome.tabs.onRemoved.removeListener(onRemoved)
      }
    }

    function onUpdated(id, info) {
      if (id !== tabId) return
      chrome.tabs.get(tabId, t => {
        if (chrome.runtime.lastError) { cleanup(); resolve(false); return }
        const title = (t.title || '').toLowerCase()
        const isChallenge = CHALLENGE_KW.some(k => title.includes(k))
        if (t.status === 'complete' && !isChallenge) {
          cleanup()
          L(`[${tienda.source_key}] ✅ CF resuelto — página lista: "${t.title}"`)
          resolve(true)
        }
        // Si sigue en challenge: esperar (sin timeout)
      })
    }

    function onRemoved(id) {
      if (id !== tabId) return
      cleanup()
      L(`[${tienda.source_key}] Tab cerrado por el usuario antes de resolver CF → backoff`)
      resolve(false)
    }

    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs.onRemoved.addListener(onRemoved)
  })

  try { chrome.notifications.clear('cf-tab-' + tienda.source_key, () => {}) } catch {}

  if (!pageReady) {
    try { chrome.tabs.remove(tabId, () => {}) } catch {}
    return []
  }

  // ── CF resuelto: scrapear via executeScript (same-origin, sin CORS) ──────
  // El tab ya tiene todas las cookies CF → fetch desde dentro del tab
  // equivale a lo que hace el usuario en su navegador real.
  const productos = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages) {
    const url =
      `${tienda.base_url}/wp-json/wc/store/v1/products` +
      `?category=${tienda.category}&per_page=${tienda.per_page}&page=${page}`

    L(`[${tienda.source_key}] Tab API pág ${page}/${totalPages}: ${url}`)

    let result
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (apiUrl) => {
          try {
            const r = await fetch(apiUrl, {
              headers: { Accept: 'application/json' },
              credentials: 'include',
            })
            if (!r.ok) return { error: `HTTP ${r.status}`, data: null, totalPages: 1 }
            const tp   = parseInt(r.headers.get('x-wp-totalpages') || '1', 10)
            const data = await r.json()
            return { data, totalPages: isNaN(tp) ? 1 : tp, error: null }
          } catch (e) {
            return { error: e.message, data: null, totalPages: 1 }
          }
        },
        args: [url],
      })
      result = injected?.[0]?.result
    } catch (e) {
      L(`[${tienda.source_key}] executeScript error pág ${page}: ${e.message}`)
      break
    }

    if (!result || result.error) {
      L(`[${tienda.source_key}] Error pág ${page}: ${result?.error || 'sin resultado'}`)
      break
    }

    if (page === 1) totalPages = result.totalPages || 1
    const data = result.data
    if (!Array.isArray(data) || data.length === 0) break

    for (const p of data) {
      const minorUnit    = p.prices?.currency_minor_unit ?? 2
      const salePrice    = centsToEuros(p.prices?.sale_price,    minorUnit)
      const regularPrice = centsToEuros(p.prices?.regular_price, minorUnit)
      const price        = (!isNaN(salePrice) && salePrice > 0) ? salePrice : regularPrice
      if (isNaN(price) || price < tienda.price_min) continue
      const precio_original = (!isNaN(regularPrice) && regularPrice > price) ? regularPrice : null
      productos.push({
        title: p.name, price, precio_original,
        url: p.permalink, image: p.images?.[0]?.src || null, sku: p.sku || null,
      })
    }

    L(`[${tienda.source_key}]  → ${data.length} productos pág ${page}/${totalPages} (acum: ${productos.length})`)
    page++
    if (page <= totalPages) await sleep(CONFIG.DELAY_BETWEEN_PAGES_MS)
  }

  try { chrome.tabs.remove(tabId, () => {}) } catch {}
  L(`[${tienda.source_key}] Tab cerrado. ${productos.length} productos obtenidos.`)
  return productos
}

async function scrapeWooCommerce(tienda, logLines = []) {
  const L = msg => { console.log(msg); logLines.push(`[LOG]  ${msg}`) }
  const productos = []
  let page = 1
  let totalPages = 1

  // Leer cookies de Chrome para este dominio (necesario para Cloudflare)
  const hostname = new URL(tienda.base_url).hostname
  let cookieHeader = await getCookieHeader(hostname)

  // Si no hay cf_clearance, abrimos un tab para que Cloudflare la establezca
  if (!cookieHeader || !cookieHeader.includes('cf_clearance')) {
    L(`[${tienda.source_key}] Sin cf_clearance — abriendo tab para warmup CF...`)
    await warmupCloudflareCookie(tienda.base_url)
    cookieHeader = await getCookieHeader(hostname)
    L(`[${tienda.source_key}] Tras warmup — cf_clearance=${cookieHeader?.includes('cf_clearance') ?? false}`)
  }

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

  let matched = 0, sinMatch = 0, filtrados = 0, attrMatched = 0

  const snapshotsMatch     = []
  const candidatasSinMatch = []
  const aliasesNuevos      = []
  const seen = new Set()

  for (const p of productos) {
    if (!p.url || !p.title || seen.has(p.url)) { filtrados++; continue }
    if (!esPala(p.title)) { filtrados++; continue }
    seen.add(p.url)

    const titleLower = p.title.toLowerCase()
    const pala_id    = aliases.get(titleLower)

    // Título limpio para extraerAtributos(): decodifica HTML entities y quita prefijo
    // "Pala " / "Pala de " que usan algunas tiendas WooCommerce (padeltienda, etc.)
    // Se usa SOLO para la extracción de atributos — el alias lookup usa titleLower original.
    const titleClean = p.title
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
      .replace(/&[a-z]+;/g, ' ')
      .replace(/^pala(?:\s+de)?\s+/i, '')
      .trim()

    if (pala_id) {
      // ── Match por alias ──────────────────────────────────
      const codigoTienda = codigosCache[tienda.source_id]
      const snap = {
        pala_id,
        source_id:        tienda.source_id,
        precio:           p.price,
        precio_original:  p.precio_original,
        url_producto:     p.url,
        disponible:       true,
        sku:              p.sku,
        scraped_at,
        match_confidence: 1,
        imagen_url:       p.image,
        codigo_descuento: codigoTienda?.codigo    ?? null,
        descuento_pct:    codigoTienda?.descuento_pct ?? null,
      }
      snapshotsMatch.push(snap)
      matched++
    } else {
      // ── Fallback: match por atributos ──────────────────────
      const attrs = extraerAtributos(titleClean)
      const candidatos = buscarEnCatalogo(attrs)
      if (candidatos.length === 1) {
        const pala_id = candidatos[0].id
        const codigoTiendaAttr = codigosCache[tienda.source_id]
        snapshotsMatch.push({
          pala_id,
          source_id:        tienda.source_id,
          precio:           p.price,
          precio_original:  p.precio_original,
          url_producto:     p.url,
          disponible:       true,
          sku:              p.sku,
          scraped_at,
          match_confidence: 0.9,
          imagen_url:       p.image,
          codigo_descuento: codigoTiendaAttr?.codigo    ?? null,
          descuento_pct:    codigoTiendaAttr?.descuento_pct ?? null,
        })
        // Actualizar alias cache local para dedup en este mismo ciclo
        aliasCache[tienda.source_key]?.set(titleLower, pala_id)
        aliasesNuevos.push({ texto_original: p.title, pala_id, tienda: tienda.source_key })
        matched++
        attrMatched++
      } else {
        // ── Sin match → palas_candidatas ─────────────────────
        candidatasSinMatch.push({
          titulo:             p.title,
          titulo_normalizado: p.title.toLowerCase(),
          fuentes:            [tienda.source_key],
          precio_min:         p.price,
          precio_max:         p.price,
          urls:               [p.url],
          veces_visto:        1,
          estado:             'pendiente',
        })
        sinMatch++
      }
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
  const palaIdsActualizados = Array.from(snapsByPalaId.keys())
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
  // dia_scraped es columna generada en BD (computed desde scraped_at) — no enviar
  // resolution=ignore-duplicates → ON CONFLICT DO NOTHING (silencia 409 en 2º ciclo del día)
  const historyRows = snapsDedupados
  let historyError = null
  for (let i = 0; i < historyRows.length; i += 200) {
    try {
      const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/price_history_log`, {
        method: 'POST',
        headers: { ...SB.headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(historyRows.slice(i, i + 200)),
      })
      if (!r.ok) {
        // 409 = unique constraint price_history_log_daily_uniq (pala_id,source_id,dia_scraped)
        // Significa que ya insertamos este día antes → silenciar, los datos ya están
        if (r.status !== 409) {
          const txt = await r.text()
          if (!historyError) historyError = `${r.status}: ${txt}`
        }
      }
    } catch (e) {
      if (!historyError) historyError = e.message
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

  // Guardar aliases nuevos descubiertos por matching de atributos
  if (aliasesNuevos.length > 0) {
    try {
      await SB.upsert('producto_aliases', aliasesNuevos, 'texto_original,tienda')
      console.log(`[${tienda.source_key}] ✨ ${aliasesNuevos.length} aliases nuevos guardados`)
    } catch (e) {
      console.warn(`[${tienda.source_key}] aliases nuevos warning:`, e.message)
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

  return { matched, sinMatch, filtrados, total: matched + sinMatch, sinMatchResumen, historyError, attrMatched, palaIds: palaIdsActualizados }
}

// ── Backoff helpers ───────────────────────────────────────────
// Cuando una tienda CF falla, la ponemos en backoff 24h para que la IP se enfríe.
// CF escala de challenge pasivo (automático) a Turnstile interactivo cuando detecta
// muchos reintentos fallidos. Con 24h de pausa, vuelve al challenge pasivo.

const BACKOFF_MS = 24 * 3600 * 1000

async function getBackoffUntil(sourceKey) {
  const data = await chrome.storage.local.get(`backoff_${sourceKey}`)
  return data[`backoff_${sourceKey}`] || 0
}

async function setBackoff(sourceKey) {
  const until = Date.now() + BACKOFF_MS
  await chrome.storage.local.set({ [`backoff_${sourceKey}`]: until })
  console.log(`[${sourceKey}] Backoff activado — próximo intento: ${new Date(until).toLocaleTimeString()}`)
}

async function clearBackoff(sourceKey) {
  await chrome.storage.local.remove(`backoff_${sourceKey}`)
  console.log(`[${sourceKey}] Backoff limpiado (scrape exitoso)`)
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
    await cargarCatalogo()
    await cargarCodigos()
    for (const t of TIENDAS) {
      logLines.push(`\n--- Aliases ${t.source_key}: ${aliasCache[t.source_key]?.size ?? 0} ---`)
    }

    let totalMatched = 0, totalSinMatch = 0, totalProductos = 0
    const todosLosPalaIds = new Set()

    for (const tienda of TIENDAS) {
      // Backoff: saltar tienda si falló hace menos de 24h (deja enfriar la IP ante CF)
      if (tienda.backoffOnFail) {
        const until = await getBackoffUntil(tienda.source_key)
        if (until > Date.now()) {
          const horas = Math.ceil((until - Date.now()) / 3600000)
          log(`[${tienda.source_key}] ⏸ Backoff activo (${horas}h restantes) — saltando`)
          continue
        }
      }

      log(`\n── Scrapeando ${tienda.nombre} ──`)
      try {
        const productos = tienda.type === 'opencart'
          ? await scrapeOpenCart(tienda, logLines)
          : tienda.type === 'opencart-tab'
            ? await scrapeOpenCartViaTab(tienda, logLines)
            : tienda.type === 'woocommerce-tab'
              ? await scrapeWooCommerceViaTab(tienda, logLines)
              : await scrapeWooCommerce(tienda, logLines)
        if (productos === null) {
          logE(`[${tienda.source_key}] Error interno Chrome (tab=null) — saltando sin activar backoff`)
          continue
        }
        if (productos.length === 0) {
          logE(`[${tienda.source_key}] 0 productos — posible bloqueo o tienda vacía`)
          if (tienda.backoffOnFail) await setBackoff(tienda.source_key)
          SB.insert('scrape_runs', {
            source_id: tienda.source_id,
            productos: 0, matches: 0, unicos: 0,
            sin_match: 0, filtrados: 0, attr_match: 0,
            error: '0 productos — posible bloqueo',
          }).catch(() => {})
          continue
        }
        if (tienda.backoffOnFail) await clearBackoff(tienda.source_key)
        const res = await procesarTienda(tienda, productos)
        log(`[${tienda.source_key}] ✅ ${res.matched} matches (${res.attrMatched} x attrs) | ⚠️ ${res.sinMatch} sin match | 🚫 ${res.filtrados} filtrados`)
        if (res.sinMatchResumen) {
          log(`[${tienda.source_key}] Sin match por marca: ${res.sinMatchResumen}`)
        }
        if (res.historyError) {
          log(`[${tienda.source_key}] ⚠️ price_history_log ERROR: ${res.historyError}`)
        }
        totalMatched   += res.matched
        totalSinMatch  += res.sinMatch
        totalProductos += res.total
        // Acumular pala_ids para recalcular price_reference al final
        if (res.palaIds) for (const id of res.palaIds) todosLosPalaIds.add(id)
        // Registrar métricas del ciclo en scrape_runs (visible en GestorCandidatas → Scrapers)
        SB.insert('scrape_runs', {
          source_id:  tienda.source_id,
          productos:  res.total + res.filtrados,
          matches:    res.matched,
          unicos:     res.palaIds?.length ?? 0,
          sin_match:  res.sinMatch,
          filtrados:  res.filtrados,
          attr_match: res.attrMatched,
        }).catch(e => console.warn(`[${tienda.source_key}] scrape_runs warning:`, e.message))
      } catch (e) {
        logE(`[${tienda.source_key}] Error: ${e.message}`)
        if (tienda.backoffOnFail) await setBackoff(tienda.source_key)
        // Registrar el error también en scrape_runs
        SB.insert('scrape_runs', {
          source_id: tienda.source_id,
          productos: 0, matches: 0, unicos: 0,
          sin_match: 0, filtrados: 0, attr_match: 0,
          error: e.message.slice(0, 200),
        }).catch(() => {})
      }

      await sleep(CONFIG.DELAY_BETWEEN_STORES_MS)
    }

    // Post-pipeline: recalcular price_reference para las palas tocadas en este ciclo
    // (equivalente a post-pipeline.ts Paso 3 — activa el filtro de frescura de /api/chollos)
    if (todosLosPalaIds.size > 0) {
      log(`\n🔄 Recalculando price_reference (${todosLosPalaIds.size} palas)...`)
      const actualizadas = await recalcularPriceReference(Array.from(todosLosPalaIds))
      log(`✅ price_reference: ${actualizadas} palas actualizadas`)
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
    // Incluir info de backoff activo en la respuesta
    const keys = ['status', 'lastRun', 'lastResult', 'lastMatched', 'lastTotal',
      ...TIENDAS.filter(t => t.backoffOnFail).map(t => `backoff_${t.source_key}`)]
    chrome.storage.local.get(keys, data => {
      const backoffs = {}
      for (const t of TIENDAS.filter(t => t.backoffOnFail)) {
        const until = data[`backoff_${t.source_key}`] || 0
        if (until > Date.now()) backoffs[t.source_key] = until
      }
      sendResponse({ ...data, backoffs })
    })
    return true
  }
  if (msg.action === 'clear-backoff') {
    const key = msg.source_key
    chrome.storage.local.remove(`backoff_${key}`, () => sendResponse({ ok: true }))
    return true
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// MOTOR DE MATCHING POR ATRIBUTOS
// Puerto fiel de extract-atributos.ts + modelo-matching.ts (Supabase pipeline)
// Misma lógica, sin dependencias externas — JS puro para Service Worker MV3.
// ─────────────────────────────────────────────────────────────────────────────

function attrNorm(texto) {
  return texto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Diccionario de marcas ─────────────────────────────────────
const ATTR_MARCAS = {
  'bullpadel':'Bullpadel','bull padel':'Bullpadel','bull-padel':'Bullpadel',
  'nox':'Nox','nox padel':'Nox','ea10':'Nox',
  'adidas':'Adidas','adidas padel':'Adidas','adipower':'Adidas',
  'head':'Head','head padel':'Head',
  'babolat':'Babolat',
  'wilson':'Wilson','wilson padel':'Wilson',
  'star vie':'StarVie','starvie':'StarVie',
  'siux':'Siux',
  'vibor-a':'Vibor-A','vibora':'Vibor-A','vibor a':'Vibor-A',
  'drop shot':'Drop Shot','dropshot':'Drop Shot',
  'black crown':'Black Crown','blackcrown':'Black Crown',
  'dunlop':'Dunlop','joma':'Joma','enebe':'Enebe','varlion':'Varlion',
  'royal padel':'Royal Padel','tecnifibre':'Tecnifibre','oxdog':'Oxdog',
  'kuikma':'Kuikma','akkeron':'Akkeron','puma':'Puma','alkemia':'Alkemia',
  'lok':'Lok','kombat':'Kombat','munich':'Munich','hirostar':'Hirostar',
  'cartri':'Cartri','softee':'Softee','xcalion':'Xcalion','vairo':'Vairo',
  'legend':'Legend','prince':'Prince','harlem':'Harlem',
  'j-hayber':'J-Hayber','j.hayber':'J-Hayber','j hayber':'J-Hayber','jhayber':'J-Hayber',
  'k-swiss':'K-Swiss','kswiss':'K-Swiss','k swiss':'K-Swiss',
  'mystica':'Mystica','slazenger':'Slazenger','asics':'Asics',
  'alacran':'Alacran','kelme':'Kelme','hbl':'HBL','goliat':'Goliat',
  'endless':'Endless','stiga':'Stiga','osaka':'Osaka',
  'indian maharadja':'Indian Maharadja','maharadja':'Indian Maharadja',
  'by vp':'By VP','tactical':'Tactical',
}

// ── Líneas por marca (curado: más específico primero) ─────────
// Ampliado dinámicamente con cargarCatalogo() al inicio de cada ciclo.
const ATTR_LINEAS = {
  'Bullpadel':['vertex','hack','spike','flow','neuron','indiga','ionic','wonder','pearl','elite','legend','ava','bp10','game','discover','icon','raider','k2','black dragon'],
  'Nox':['at10','ml10','x-one','x one','vk10','tl10','la10','ea10','x-zero','x zero','x-hero','x hero','x-pro','x pro','future','equation','nextgen','tempo','ventus','quantum','ultimate'],
  'Adidas':['metalbone','adipower multiweight','adipower carbon','adipower','drive','match','rx series','rx','cross it','crossit','arrow','essnova','neuvortx','ctrl team','velara','kardex','x treme','copa del mundo','world cup'],
  'Head':['delta','extreme','speed','radical','flash','spark','bolt','gravity','alpha','zephyr','instinct','tour','edge','vibe','vive','evo','one','concord','coello'],
  'Babolat':['technical viper','counter viper','air viper','viper','technical veron','air veron','veron','vertuo','xplo','dyna energy','stima vita','air origin','alioth','lamborghini'],
  'Wilson':['bela','defy','optix','ultra','carbon force','endure','blade'],
  'StarVie':['black titan','black mamba','triton','metheora','raptor','basalto','drax','kenta','aquila','brava','gea','titania','astrum','polaris','nyra','arkos','radar','kraken','exodus','vesta'],
  'Siux':['electra','fenix','pegasus','diablo','adrenaline','savage','trilogy','spyder','velox','beat','gea','astra','valkiria','fusion','invicta','astral'],
  'Vibor-A':['black mamba','king cobra','king kobra','yarara','mamba','titan','bamboo','boa','naya','vipera','lethal','taipan'],
  'Drop Shot':['explorer','axion','canyon','renegade','conqueror','quantum','bronco','blitz','cyber','flame','furia','prime','x-drive','x drive'],
  'Black Crown':['piton','hurricane','gladius','epic','iconic','special','patron','snake','wolf','rebel','win','shark','coyote','viva'],
  'Dunlop':['aero star','tristorm','rocket','blast','fury','elite','strike','megamax','galactica','titan','inferno','nemesis','fx','galaxy','impact','infinity','samurai','fusion'],
  'Joma':['valkiria','master','open','slam','hyper','blast','recon','gold','tournament','pro','rookie'],
  'Enebe':['suburban','spitfire','combat','response','mustang','supra','rsx','space','genius','massive','aerox','point','cross','astra','break','arrow','full','matrix','nitro','rs','venom'],
  'Varlion':['lethal','summum','carbon','baseline'],
  'Royal Padel':['aniversario','fury','hi-lander','hi lander','factor','whip','control','race','ace'],
  'Tecnifibre':['wall breaker','wall master','curva','bomba'],
  'Oxdog':['ultimate','hyper tour'],
  'Vairo':['black karbon','everlast','grapheno','genetic','columns','compact','across'],
  'Legend':['invictus','odyssey','revenant','shadow','stealth'],
  'Prince':['falcon','premier','quartz','rocket'],
  'Harlem':['pro helix','bionic','euphoria'],
  'J-Hayber':['warrior fit','warrior','attack'],
  'K-Swiss':['supreme'],
  'Mystica':['legacy'],
  'Slazenger':['epic pro','epic'],
  'Asics':['hybrid'],
  'Kombat':['vesubio','etna','galeras','teide','arenal','osorno','krakatoa','fuji','black','delta','hunter','swat','sas','troya','obus','xifos','magnum','geo','apache','navy'],
}

// ── Variantes y sus alias canónicos ──────────────────────────
const ATTR_VARIANTES = [
  'hrd+','hrd','ctrl','ctr','control','light','team','carbon',
  'comfort','confort','cmf','hybrid','hyb','attack','soft','air','pro',
  'elite','tour','ltd','limited','xtreme','xtrem','lite','power','pwr','speed','motion',
  'woman','women','mujer','junior','jr','hrd plus',
  'espana','alemania','argentina','belgica','colombia','francia',
  'inglaterra','italia','mexico','paises bajos','estados unidos','holanda','eeuu','multination',
  'spain','germany','belgium','france','england','italy','netherlands','usa',
  '18k','12k','carbon','alum','aluminium',
  'master final','world padel tour','wpt',
  'gold edition','black edition','limited edition',
]
const ATTR_VAR_ALIAS = {
  'mujer':'WOMAN','mujeres':'WOMAN','women':'WOMAN',
  'junior':'JUNIOR','jr':'JUNIOR',
  'hrd+':'HRD+','hrd plus':'HRD+','hrd':'HRD+',
  'ctrl':'CTRL','control':'CTRL','ctr':'CTRL',
  'cmf':'COMFORT','comfort':'COMFORT','confort':'COMFORT',
  'wpt':'WORLD PADEL TOUR','world padel tour':'WORLD PADEL TOUR',
  'espana':'España','alemania':'Alemania','argentina':'Argentina',
  'belgica':'Bélgica','colombia':'Colombia','francia':'Francia',
  'inglaterra':'Inglaterra','italia':'Italia','mexico':'Mexico',
  'paises bajos':'Netherlands','estados unidos':'USA','holanda':'Netherlands','eeuu':'USA','multination':'Multination',
  'spain':'España','germany':'Alemania','belgium':'Bélgica',
  'france':'Francia','england':'Inglaterra','italy':'Italia',
  'netherlands':'Netherlands','usa':'USA',
}

// ── Alias de líneas (variantes ortográficas → nombre canónico) ─
const ATTR_LINEAS_ALIAS = {
  'crossit':'Cross It','vive':'Vibe','astral':'Astra',
  'king kobra':'King Cobra','x treme':'Xtreme','ace':'Ace',
  'hi lander':'Hi-Lander','x zero':'X-Zero','x hero':'X-Hero',
  'x pro':'X-Pro','x drive':'Drive',
}

// ── Jugadores (orden largo→corto para match greedy) ───────────
const ATTR_JUGADORES = [
  'arturo coello','ale coello','alejandro coello','coello',
  'agustin tapia','agustín tapia','agustin','agustín','tapia',
  'ale galan','ale galán','alejandro galan','alejandro galán','galan','galán',
  'federico chingotto','fede chingotto','chingotto',
  'juan lebron','juan lebrón','j lebron','j lebrón','lebron',
  'leo augsburger','leandro augsburger','augsburger',
  'franco stupaczuk','stupaczuk','stupa',
  'miguel yanguas','mike yanguas','yanguas',
  'coki nieto','jorge nieto',
  'paquito navarro','francisco navarro',
  'jon sanz','j sanz',
  'martin di nenno','martín di nenno','di nenno',
  'francisco guerrero','guerrero',
  'jeronimo gonzalez','jerónimo gonzalez','momo gonzalez','momo gonzález',
  'lucas bergamini','bergamini',
  'edu alonso','eduardo alonso',
  'javier leal','javi leal',
  'lucas campagnolo','campagnolo',
  'javier garrido','juan tello','tello',
  'alex ruiz','alejandro ruiz',
  'javier garcia bernal','jairo bautista',
  'juanlu esbri','esbri',
  'javier barahona','barahona','alejandro arroyo',
  'leo aguirre','leonel aguirre',
  'alex chozas','chozas','david gala','gonzalo alfonso',
  'pol hernandez','guillermo collado','collado',
  'carlos gutierrez','jose jimenez casas','maxi arce',
  'inigo jofre','jofre','aimar goni',
  'pablo garcia belen','maxi sanchez blasco','victor ruiz benito',
  'gonzalo rubio','jose antonio diestro','diestro',
  'javier ruiz llorente',
  'tino libaak','valentino libaak','libaak',
  'pablo lijo','lijo','alvaro cepero','cepero',
  'franco dal bianco','dal bianco','enzo jensen','pablo cardona',
  'gemma triay','triay',
  'delfina brea','delfi brea','delfi',
  'bea gonzalez','bea gonzález','beatriz gonzalez',
  'paula josemaria','josemaria','josemaría',
  'ari sanchez','ariana sanchez',
  'claudia fernandez sanchez',
  'andrea ustero','ustero',
  'sofia araujo','araujo',
  'tamara icardo','icardo',
  'martita ortega','marta ortega',
  'claudia jensen',
  'alejandra salazar','ale salazar','salazar',
  'martina calvo','alejandra alonso de villa',
  'veronica virseda','virseda',
  'marina guinart','guinart',
  'beatriz caldera','carmen goenaga',
  'aranzazu osoro','osoro','victoria iglesias',
  'lucia sainz','lucía sainz',
  'mapi sanchez','mapi sánchez',
  'patricia llaguno','patty llaguno','llaguno',
  'martina fassio','fassio','raquel eugenio',
  'jessica castello','lorena rufo','jimena velasco',
  'marta barrera','carolina orsi',
  'giulia dal pozzo','virginia riera',
  'alix collombon','collombon','noa canovas',
  'araceli martinez arandia','agueda perez',
  'lucia martinez gomez','julieta bidahorria',
  'marta caparros','marta talavan','talavan',
  'marta borrero','lara arruabarrena','arruabarrena',
  'sofia saiz','jana montes','noemi aguilar',
  'melania merino','ana catarina nogueira','mafalda fernandes',
  'alex galán','carolina navarro',
  'fernando belasteguin','belasteguín','belasteguin',
  'fede','miguel lamperti','lamperti','moyano',
  'pablo lima','lima',
  'manu martin','juan martin diaz','juan martin',
]
const ATTR_JUGADORES_SORTED = [...ATTR_JUGADORES].sort((a, b) => b.length - a.length)

// Jugadoras conocidas → inferir variante=WOMAN
const ATTR_JUGADORAS_MUJER = new Set([
  'gemma triay','triay','delfina brea','delfi brea','delfi',
  'bea gonzalez','bea gonzalez','beatriz gonzalez',
  'paula josemaria','josemaria','josemaria',
  'ari sanchez','ariana sanchez',
  'claudia fernandez sanchez','claudia fernandez','claudia fernandez',
  'andrea ustero','ustero','sofia araujo','araujo',
  'tamara icardo','icardo','martita ortega','marta ortega',
  'claudia jensen','alejandra salazar','ale salazar','salazar',
  'martina calvo','alejandra alonso de villa',
  'veronica virseda','virseda','marina guinart','guinart',
  'beatriz caldera','carmen goenaga',
  'aranzazu osoro','osoro','victoria iglesias',
  'lucia sainz','lucia sainz',
  'mapi sanchez','mapi sanchez',
  'patricia llaguno','patty llaguno','llaguno',
  'martina fassio','fassio','raquel eugenio',
  'jessica castello','lorena rufo','jimena velasco',
  'marta barrera','carolina orsi','giulia dal pozzo',
  'virginia riera','alix collombon','collombon','noa canovas',
  'araceli martinez arandia','agueda perez',
  'lucia martinez gomez','julieta bidahorria',
  'marta caparros','marta talavan','talavan',
  'marta borrero','lara arruabarrena','arruabarrena',
  'sofia saiz','jana montes','noemi aguilar',
  'melania merino','ana catarina nogueira','mafalda fernandes',
  'carolina navarro',
])

// ── Funciones auxiliares del extractor ───────────────────────

function attrQuitarMarca(texto, marca) {
  const aliases = Object.entries(ATTR_MARCAS)
    .filter(([, v]) => v === marca)
    .map(([k]) => k)
    .sort((a, b) => b.length - a.length)
  for (const a of aliases) {
    const re = new RegExp('^' + a.replace(/[-]/g, '[-\\s]?') + '\\s*', 'i')
    texto = texto.replace(re, '')
  }
  return texto.trim()
}

function attrQuitarAño(texto) {
  return texto.replace(/\b(20[2-9]\d)\b/g, '').replace(/\s+/g, ' ').trim()
}

function attrQuitarJugadores(texto) {
  // Quitar acentos del texto base para comparar sin distinción de acentos
  let result = texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
  for (const j of ATTR_JUGADORES_SORTED) {
    const jSin = j.normalize('NFD').replace(/[̀-ͯ]/g, '')
    result = result.replace(new RegExp(jSin, 'gi'), '').replace(/\s+/g, ' ').trim()
  }
  return result.replace(/\s+/g, ' ').trim()
}

function attrDetectarJugador(texto) {
  const sinAcentos = texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
  for (const j of ATTR_JUGADORES_SORTED) {
    const jNorm = j.normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (new RegExp(jNorm, 'gi').test(sinAcentos)) {
      return j.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    }
  }
  return null
}

function attrJugadorEsMujer(titulo) {
  const sinAcentos = titulo.normalize('NFD').replace(/[̀-ͯ]/g, '')
  const jugadorasSorted = Array.from(ATTR_JUGADORAS_MUJER).sort((a, b) => b.length - a.length)
  for (const j of jugadorasSorted) {
    const jNorm = j.normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (new RegExp(jNorm, 'gi').test(sinAcentos)) return true
  }
  return false
}

function attrRegexSinAcentos(palabra) {
  const ACENTOS = { a:'[aàáâä]', e:'[eèéêë]', i:'[iìíîï]', o:'[oòóôö]', u:'[uùúûü]' }
  const patron = palabra.split('').map(c => ACENTOS[c.toLowerCase()] ?? c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')
  const limite = '[a-z0-9àáâäèéêëìíîïòóôöùúûü]'
  return new RegExp(`(?<!${limite})${patron}(?!${limite})`, 'gi')
}

// ── Extractor principal de atributos ─────────────────────────
// Puerto fiel de extract-atributos.ts::extraerAtributos()

function extraerAtributos(titulo) {
  // Preprocessing: strip noise
  titulo = titulo
    .replace(/^pala\s+de\s+p[aá]del/gi, '')
    .replace(/padel\s+racket/gi, '')
    .replace(/^pala/gi, '')
    .trim()
  titulo = titulo.replace(/carb-on/gi, 'carbon')
  titulo = titulo.replace(/\bgravitity\b/gi, 'gravity')
  titulo = titulo.replace(/[–—]/g, ' ')
  titulo = titulo.replace(/(\w)\+/g, '$1 PLUS')
  titulo = titulo.replace(/(?<=\S) \+(?=\s|$)/g, ' PLUS').replace(/(?<=\s)\+(?=\s|$)/g, 'PLUS')
  titulo = titulo.replace(/\b2\.([4-9])\b/g, (_m, d) => String(2020 + parseInt(d)))
  titulo = titulo.replace(/\bspecial\s+edition\b/gi, 'SE')
  titulo = titulo.replace(/\b\d{5,}\b/g, '').replace(/\s+/g, ' ').trim()

  let generacionOriginal = null
  if (!/\b20[2-9]\d\b/.test(titulo)) {
    titulo = titulo.replace(/\b3\.([1-4])\b/g, (_m, d) => {
      generacionOriginal = `3.${d}`
      return String(2021 + parseInt(d))
    })
  }

  const norm = attrNorm(titulo)

  // Año
  const añoMatch4 = titulo.match(/\b(20[2-9]\d)\b/)
  const añoMatch2 = !añoMatch4 ? titulo.match(/\b(2[0-9])\b(?=\s|$)/) : null
  const año = añoMatch4 ? parseInt(añoMatch4[1]) : (añoMatch2 ? 2000 + parseInt(añoMatch2[1]) : null)

  // Marca
  let marcaDetectada = null
  const marcaAliases = Object.entries(ATTR_MARCAS).sort((a, b) => b[0].length - a[0].length)
  for (const [alias, canonico] of marcaAliases) {
    if (norm.startsWith(alias) || norm.includes(' ' + alias + ' ') || norm.endsWith(' ' + alias)) {
      marcaDetectada = canonico
      break
    }
  }
  if (!marcaDetectada) return { marca: null, linea: null, modelo: null, variante: null, año, jugadorMencionado: null }

  // Limpiar: quitar marca, año, jugadores
  let resto = attrQuitarMarca(titulo, marcaDetectada)
  resto = attrQuitarAño(resto)
  if (añoMatch2) {
    const añoCorto = añoMatch2[1]
    resto = resto.replace(new RegExp(`\\b${añoCorto}\\b`, 'g'), '').replace(/\s+/g, ' ').trim()
  }
  const restoAntesDeJugadores = resto
  resto = attrQuitarJugadores(resto)
  resto = resto.replace(/\bby\b/gi, '').replace(/\s+/g, ' ').trim()
  const restoNorm = attrNorm(resto)

  // Línea
  let lineaDetectada = null
  let lineaAliasMatched = null
  const lineas = ATTR_LINEAS[marcaDetectada] || []
  for (const linea of lineas) {
    const pat = linea.replace(/[-+]/g, '[-+]?').replace(/\s+/g, '[-\\s]+')
    const re = new RegExp('(?<![a-z])' + pat + '(?![a-z])', 'i')
    if (re.test(restoNorm) || re.test(norm)) {
      lineaAliasMatched = linea
      lineaDetectada = ATTR_LINEAS_ALIAS[linea]
        ?? linea.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      break
    }
  }
  if (!lineaDetectada) {
    const palabras = restoNorm.split(' ').filter(w => w.length > 1)
    lineaDetectada = palabras[0] ? palabras[0].charAt(0).toUpperCase() + palabras[0].slice(1) : null
  }
  if (!lineaDetectada) {
    lineaDetectada = attrDetectarJugador(restoAntesDeJugadores)
  }

  // Quitar línea del resto
  let sinLinea = resto
  if (lineaDetectada) {
    const textoAQuitar = lineaAliasMatched
      ? lineaAliasMatched.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      : lineaDetectada
    const lineaRe = new RegExp(
      textoAQuitar.replace(/[-+]/g, '[-+]?').replace(/\s+/g, '[-\\s]+'), 'gi'
    )
    sinLinea = sinLinea.replace(lineaRe, '').replace(/\s+/g, ' ').trim()
    const lineaToks = attrNorm(textoAQuitar).split(/\s+/).filter(t => t.length >= 3)
    for (const tok of lineaToks) {
      sinLinea = sinLinea.replace(new RegExp('\\b' + tok + '\\b', 'gi'), '').replace(/\s+/g, ' ').trim()
    }
  }

  // Variante (más específica primero)
  let varianteDetectada = null
  const sinLineaNorm = attrNorm(sinLinea)
  const variantesSorted = [...ATTR_VARIANTES].sort((a, b) => b.length - a.length)
  for (const v of variantesSorted) {
    const vNorm = attrNorm(v)
    if (sinLineaNorm.includes(vNorm)) {
      varianteDetectada = ATTR_VAR_ALIAS[v] ?? ATTR_VAR_ALIAS[vNorm] ?? v.toUpperCase()
      sinLinea = sinLinea.replace(attrRegexSinAcentos(v), '').replace(/\s+/g, ' ').trim()
      break
    }
  }
  if (!varianteDetectada && attrJugadorEsMujer(titulo)) varianteDetectada = 'WOMAN'
  if (!varianteDetectada && /\bw\b/i.test(sinLinea)) {
    varianteDetectada = 'WOMAN'
    sinLinea = sinLinea.replace(/\bw\b/gi, '').replace(/\s+/g, ' ').trim()
  }

  // Quitar frases de marketing
  for (const re of [
    /pala\s+de\s+p[aá]del/gi, /superficie\s+completa/gi,
    /m[aá]s\s+raquetera,?\s*m[aá]s\s+tubo\s+de\s+pelotas/gi,
    /raqueta\s+de\s+segunda\s+mano/gi,
  ]) {
    sinLinea = sinLinea.replace(re, '').replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim()
  }

  // Modelo — lo que queda
  let modeloDetectado = sinLinea.trim() || null
  if (!modeloDetectado && generacionOriginal) modeloDetectado = generacionOriginal

  // Jugador mencionado (pista de retry — nunca se usa como modelo para fila nueva)
  let jugadorMencionado = null
  const jDetectado = attrDetectarJugador(restoAntesDeJugadores)
  if (jDetectado && jDetectado !== lineaDetectada) jugadorMencionado = jDetectado

  if (modeloDetectado) {
    modeloDetectado = modeloDetectado
      .replace(/\b(pala|padel|de|la|el|by|raqueta|edition|edicion|series|nfa)\b/gi, '')
      .replace(/\(\s*\)/g, '')
      .replace(/^[\s+\-/|]+|[\s+\-/|]+$/g, '')
      .replace(/\s+[\+\-\/\|]\s+/g, ' ')
      .replace(/(\d(?:\.\d+)?)[+\-](?=\s|$)/g, '$1')
      .replace(/(^|\s)[+\-](?=\s|$)/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim()
    if (!modeloDetectado) modeloDetectado = null
  }

  return { marca: marcaDetectada, linea: lineaDetectada, modelo: modeloDetectado, variante: varianteDetectada, año, jugadorMencionado }
}

// ── Motor de matching contra catálogo en memoria ──────────────
// Puerto fiel de modelo-matching.ts::buscarPorAtributos()

const _LINEA_EQ = { 'jr':'Junior','copa del mundo':'World Cup','world cup':'World Cup','crossit':'Cross It' }
function attrNormLinea(l) {
  if (!l) return null
  return _LINEA_EQ[l.toLowerCase().trim()] ?? l
}

const _VAR_EQ = {
  'control':'ctrl','ctrl':'ctrl','ctr':'ctrl',
  'hybrid':'hybrid','hyb':'hybrid','power':'power','pwr':'power',
  'xtrem':'xtrem','xtreme':'xtrem','cmf':'comfort','confort':'comfort',
  'wpt':'world padel tour','world padel tour':'world padel tour',
  'paises bajos':'netherlands','estados unidos':'usa',
}
function attrNormVariante(v) {
  if (!v) return null
  const n = v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  return _VAR_EQ[n] ?? n
}

const _RUIDO = new Set(['pala','de','padel','raqueta','edition','edicion','series','nfa','superficie','completa','mas','tubo','pelotas','segunda','mano'])
const _COLORES = new Set(['black','white','red','green','yellow','blue','grey','orange','pink','silver','gold','purple','brown'])
const _DISCRIMINANTES = new Set(['ctrl','control','team','hybrid','air','carbon','light','plus','elite','power','soft','iron','speed','hard','free','betis','miami','se','gen','cloud','geo','premier','energy','luxury','black','ls','prisma','pansy','world','lite'])
const _JR = { 'jr':'junior' }
const _TOK_ALIAS = {
  'mtw':'multiweight',
  'w':'woman','mujer':'woman','women':'woman',
  'negra':'black','negro':'black','blanca':'white','blanco':'white',
  'roja':'red','rojo':'red','verde':'green',
  'amarilla':'yellow','amarillo':'yellow','azul':'blue',
  'gris':'grey','naranja':'orange','rosa':'pink',
  'plata':'silver','plateado':'silver','plateada':'silver',
  'oro':'gold','dorado':'gold','dorada':'gold',
  'morado':'purple','morada':'purple','lila':'purple','violeta':'purple',
  'marron':'brown','bk':'black','bl':'blue','rd':'red','wh':'white','yl':'yellow',
}

function _tokens(s) {
  if (!s) return []
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean)
    .filter(t => !_RUIDO.has(t))
    .map(t => _TOK_ALIAS[t] ?? _JR[t] ?? t)
}

function _tokCompat(a, b) {
  if (a === b) return true
  if (a.length < 4 || b.length < 4) return false
  if (Math.abs(a.length - b.length) === 1) return a.startsWith(b) || b.startsWith(a)
  return false
}

function _tokIn(t, arr) { return arr.some(x => _tokCompat(t, x)) }

function _colorDe(s) { return _tokens(s).find(t => _COLORES.has(t)) ?? null }
function _sinColor(s) { return _tokens(s).filter(t => !_COLORES.has(t)).join(' ') }

function _colapsarJunior(tokens) {
  if (!tokens.includes('boy') && !tokens.includes('girl')) return tokens
  return tokens.filter(t => t !== 'junior')
}

function _firma(modelo, variante, año = null) {
  let toks = [..._tokens(modelo ?? ''), ..._tokens(variante ?? '')]
  if (año != null) {
    const añoCorto = String(año % 100)
    toks = toks.filter(t => !(/^\d+$/.test(t) && (t === String(año) || t === añoCorto)))
  }
  toks = _colapsarJunior(toks)
  return Array.from(new Set(toks)).sort().join('|')
}

function _modeloCompatible(modeloCat, modeloExt, añoCat = null, añoExt = null) {
  if (!modeloExt) {
    if (!modeloCat) return true
    if (_tokens(modeloCat).length === 0) return true
    return /^[\d.]+$/.test(modeloCat.trim())
  }
  const tCat = modeloCat ? _tokens(modeloCat) : []
  const tExt = _tokens(modeloExt)
  const inseguro = (t) =>
    _DISCRIMINANTES.has(t) || /^v\d+p\d+$/.test(t) || (/^\d+$/.test(t) && añoCat == null && añoExt == null)
  if (tExt.every(t => _tokIn(t, tCat))) {
    return !tCat.filter(t => !_tokIn(t, tExt)).some(inseguro)
  }
  if (tCat.every(t => _tokIn(t, tExt))) {
    const extra = tExt.filter(t => !_tokIn(t, tCat))
    if (tCat.length === 0) {
      const año = añoCat ?? añoExt
      const añoCorto = año != null ? String(año % 100) : null
      const seguro = (t) => _COLORES.has(t) || (/^\d+$/.test(t) && año != null && (t === String(año) || t === añoCorto))
      return extra.every(seguro)
    }
    return !extra.some(inseguro)
  }
  return false
}

function buscarEnCatalogo(attrs) {
  if (!attrs.marca || !attrs.linea) return []

  const lineaNorm = attrNormLinea(attrs.linea)
  let data = catalogoAtributos.filter(p => p.marca === attrs.marca && p.linea === lineaNorm)
  if (data.length === 0) return []

  const filtrarConModelo = (modeloPara) => data.filter(p => {
    const varCoinciden = attrNormVariante(p.variante) === attrNormVariante(attrs.variante)
    const añoOk = !attrs.año || !p.año || p.año === attrs.año
    const modeloOk = _modeloCompatible(p.modelo, modeloPara, p.año, attrs.año)
    const cruzado = !modeloPara && !!attrs.variante && !p.variante
      && attrNormVariante(p.modelo) === attrNormVariante(attrs.variante)
    return (varCoinciden && modeloOk || cruzado) && añoOk
  })

  let filtrados = filtrarConModelo(attrs.modelo)

  // Retry con nombre de jugador como modelo (pista)
  if (filtrados.length === 0 && attrs.jugadorMencionado) {
    filtrados = filtrarConModelo(attrs.jugadorMencionado)
  }

  // Fallback: firma combinada modelo+variante
  if (filtrados.length === 0) {
    const firmaExt = _firma(attrs.modelo ?? attrs.jugadorMencionado ?? null, attrs.variante, attrs.año)
    if (firmaExt !== '') {
      const porFirma = data.filter(p => {
        const añoOk = !attrs.año || !p.año || p.año === attrs.año
        return añoOk && _firma(p.modelo, p.variante, p.año ?? attrs.año) === firmaExt
      })
      if (porFirma.length === 1) filtrados = porFirma
    }
  }

  // Preferir modelo más específico si hay varios candidatos
  if (filtrados.length > 1) {
    const mRef = attrs.modelo ?? attrs.jugadorMencionado ?? null
    if (mRef) {
      const tExt = _tokens(mRef)
      const exactos = filtrados.filter(c => {
        const tCat = c.modelo ? _tokens(c.modelo) : []
        return tCat.length > 0 && tExt.every(t => _tokIn(t, tCat)) && tCat.every(t => _tokIn(t, tExt))
      })
      if (exactos.length > 0 && exactos.length < filtrados.length) filtrados = exactos
    }
  }

  // Si hay año y hay ambigüedad → preferir fila con ese año exacto
  if (attrs.año && filtrados.length > 1) {
    const conAño = filtrados.filter(p => p.año === attrs.año)
    const sinAño = filtrados.filter(p => p.año == null)
    if (conAño.length === 1 && conAño.length + sinAño.length === filtrados.length) filtrados = conAño
  }

  // Sin año: si todas las claves (sin año) son iguales → la más reciente
  if (!attrs.año && filtrados.length > 1) {
    const clave = (p) => `${(p.marca ?? '').toLowerCase()}|${(p.linea ?? '').toLowerCase()}|${(p.modelo ?? '').toLowerCase()}|${attrNormVariante(p.variante) ?? ''}`
    if (new Set(filtrados.map(clave)).size === 1) {
      return [filtrados.reduce((best, p) => (p.año ?? 0) > (best.año ?? 0) ? p : best)]
    }
  }

  // Resolver ambigüedad por color
  if (filtrados.length > 1) {
    const clave = (p) => `${(p.marca ?? '').toLowerCase()}|${(p.linea ?? '').toLowerCase()}|${attrNormVariante(p.variante) ?? ''}|${p.año ?? ''}|${_sinColor(p.modelo)}`
    if (new Set(filtrados.map(clave)).size === 1) {
      const mRef = attrs.modelo ?? attrs.jugadorMencionado ?? null
      const colorT = _colorDe(mRef)
      if (colorT) {
        const exacto = filtrados.filter(p => _colorDe(p.modelo) === colorT)
        if (exacto.length === 1) filtrados = exacto
      } else {
        const sinCol = filtrados.filter(p => _colorDe(p.modelo) === null)
        if (sinCol.length === 1) filtrados = sinCol
      }
    }
  }

  return filtrados
}

// ── Carga del catálogo desde Supabase ─────────────────────────
async function cargarCatalogo() {
  try {
    const rows = await SB.get('palas?select=id,marca,linea,modelo,variante,a%C3%B1o&limit=5000')
    catalogoAtributos = (rows || []).filter(p => p.marca && p.linea)
    // Normalizar campo año (key en JSON puede venir como "año" o "año")
    for (const p of catalogoAtributos) {
      if (p['año'] !== undefined) p.año = p['año']
    }
    console.log(`[tiendas-ext] Catálogo cargado: ${catalogoAtributos.length} palas`)

    // Enriquecer ATTR_LINEAS con líneas de BD no presentes en el hardcoded
    const nuevas = {}
    for (const row of rows || []) {
      if (!row.marca || !row.linea) continue
      const lNorm = row.linea.toLowerCase().trim()
      const yaExiste = ATTR_LINEAS[row.marca]?.includes(lNorm)
      if (yaExiste) continue
      if (!nuevas[row.marca]) nuevas[row.marca] = []
      if (!nuevas[row.marca].includes(lNorm)) nuevas[row.marca].push(lNorm)
    }
    for (const [marca, ns] of Object.entries(nuevas)) {
      ns.sort((a, b) => b.length - a.length)
      if (!ATTR_LINEAS[marca]) {
        ATTR_LINEAS[marca] = ns
      } else {
        for (const l of ns) {
          if (!ATTR_LINEAS[marca].includes(l)) ATTR_LINEAS[marca].push(l)
        }
      }
    }
  } catch (e) {
    console.warn('[tiendas-ext] cargarCatalogo error:', e.message)
    catalogoAtributos = []
  }
}

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
