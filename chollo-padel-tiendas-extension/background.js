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
      // ── Fallback: match por atributos ──────────────────────
      const attrs = extraerAtributos(p.title)
      const candidatos = buscarEnCatalogo(attrs)
      if (candidatos.length === 1) {
        const pala_id = candidatos[0].id
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
        const txt = await r.text()
        if (!historyError) historyError = `${r.status}: ${txt}`
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

  return { matched, sinMatch, filtrados, total: matched + sinMatch, sinMatchResumen, historyError, attrMatched }
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
