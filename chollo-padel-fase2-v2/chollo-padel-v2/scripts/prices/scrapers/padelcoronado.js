// scripts/prices/scrapers/padelcoronado.js
// WooCommerce Store API — playwright-extra + stealth + cookie cache
//
// Cloudflare Turnstile bloquea:
//   - Node.js fetch (TLS fingerprint de undici ≠ Chrome real → HTTP 403)
//   - Playwright headless estándar (detectado como bot → Turnstile → 403)
//
// Solución A — IP fría (GitHub Actions, primera vez del día en local):
//   playwright-extra + puppeteer-extra-plugin-stealth
//   → Cloudflare no detecta headless → cf_clearance obtenida automáticamente
//
// Solución B — IP caliente (local tras varios intentos del mismo día):
//   Cookie cache: guarda cf_clearance tras cada éxito.
//   La siguiente ejecución carga esas cookies y llama a la API directamente,
//   sin tener que resolver el Turnstile de nuevo.
//   cf_clearance dura varios días → funciona continuamente en local.
//
// Endpoint: /wp-json/wc/store/v1/products?category=palas-padel
// Precios: strings de céntimos ("15995" = 159,95€), currency_minor_unit=2
// Total: ~149 palas en 2 páginas (per_page=100)

const fs   = require('fs')
const path = require('path')
const { detectarRebajasYCodigoViaHtml } = require('./_discount-utils.js')

// Caché de cookies (mismo directorio que el scraper, ignorado por git)
const COOKIES_FILE = path.join(__dirname, '.padelcoronado-cookies.json')

const SOURCE_KEY = 'padelcoronado'
const BASE_URL   = 'https://padelcoronado.com'
const CATEGORY   = 'palas-padel'
const PER_PAGE   = 100
const DELAY_MS   = 1200

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// Carga cookies guardadas; filtra las ya expiradas
function loadCachedCookies() {
  try {
    if (!fs.existsSync(COOKIES_FILE)) return []
    const raw     = fs.readFileSync(COOKIES_FILE, 'utf8')
    const cookies = JSON.parse(raw)
    const now     = Date.now() / 1000
    return cookies.filter(c => !c.expires || c.expires === -1 || c.expires > now)
  } catch {
    return []
  }
}

// Persiste las cookies del contexto actual para la próxima ejecución
async function saveCookies(context) {
  try {
    const cookies  = await context.cookies()
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2))
    const cfCookie = cookies.find(c => c.name === 'cf_clearance')
    const expiresIn = cfCookie && cfCookie.expires > 0
      ? Math.round((cfCookie.expires - Date.now() / 1000) / 3600) + 'h'
      : 'desconocido'
    console.log(`[padelcoronado] ✅ Cookies guardadas en caché (cf_clearance expira en ~${expiresIn})`)
  } catch (e) {
    console.warn('[padelcoronado] No se pudieron guardar las cookies:', e.message)
  }
}

// Los precios vienen como strings de céntimos enteros, e.g. "15995" → 159,95€
function centsToEuros(centsStr, minorUnit) {
  if (centsStr == null || centsStr === '') return NaN
  const n = parseInt(centsStr, 10)
  if (isNaN(n)) return NaN
  return n / Math.pow(10, minorUnit ?? 2)
}

function bestImage(images) {
  if (!Array.isArray(images) || images.length === 0) return null
  return images[0].src || images[0].thumbnail || null
}

// Llama a la Store API desde dentro del contexto del browser (same-origin).
// Así se evita el TLS fingerprinting de Node.js y se envían los cookies
// Cloudflare que el browser ya tiene en su sesión.
async function fetchViaPage(page, pageNum) {
  return page.evaluate(async ({ base, category, perPage, num }) => {
    const url = `${base}/wp-json/wc/store/v1/products?category=${category}&per_page=${perPage}&page=${num}`
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
      })
      if (!res.ok) return { error: `HTTP ${res.status}`, data: null, totalPages: 1 }
      const totalPagesHdr = res.headers.get('x-wp-totalpages')
      const totalPages    = totalPagesHdr ? parseInt(totalPagesHdr, 10) : 1
      const data          = await res.json()
      return { data, totalPages, error: null }
    } catch (e) {
      return { error: e.message, data: null, totalPages: 1 }
    }
  }, { base: BASE_URL, category: CATEGORY, perPage: PER_PAGE, num: pageNum })
}

async function scrape() {
  console.log('[padelcoronado] Iniciando scraper (playwright-extra + stealth + cookie cache)…')

  let chromium, StealthPlugin
  try {
    ;({ chromium } = require('playwright-extra'))
    StealthPlugin = require('puppeteer-extra-plugin-stealth')
    chromium.use(StealthPlugin())
  } catch (e) {
    console.error('[padelcoronado] playwright-extra o puppeteer-extra-plugin-stealth no instalados:', e.message)
    console.error('[padelcoronado] Ejecuta: npm install playwright-extra puppeteer-extra-plugin-stealth')
    return []
  }

  // channel: 'chrome' → Google Chrome real (mejor huella TLS que Chromium bundled)
  let browser
  try {
    browser = await chromium.launch({
      headless: true,
      channel: 'chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
  } catch {
    console.log('[padelcoronado] Chrome no disponible, usando Chromium bundled…')
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
  }

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' },
  })
  const page = await context.newPage()

  // ── Estrategia 1: cookies cacheadas (IP caliente / reejecutar en local) ───────
  // Si en una ejecución anterior obtuvimos cf_clearance, lo cargamos ahora.
  // Esto permite saltarse el Turnstile de Cloudflare aunque la IP esté "caliente".
  let firstPageResult = null
  const cachedCookies  = loadCachedCookies()
  const hasCfClearance = cachedCookies.some(c => c.name === 'cf_clearance')

  if (hasCfClearance) {
    console.log(`[padelcoronado] Cargando ${cachedCookies.length} cookies cacheadas (incluye cf_clearance)…`)
    await context.addCookies(cachedCookies)

    // Necesitamos navegar al origen antes de poder hacer fetch same-origin
    try {
      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    } catch { /* ignorar errores de red en la carga inicial */ }

    // Probar la API con las cookies cacheadas
    console.log('[padelcoronado] Probando API con cookies cacheadas…')
    const testResult = await fetchViaPage(page, 1)
    if (!testResult.error && Array.isArray(testResult.data) && testResult.data.length > 0) {
      console.log(`[padelcoronado] ✅ API OK con cookies cacheadas (${testResult.data.length} productos en pág 1)`)
      firstPageResult = testResult  // evitar repetir la pág 1
    } else {
      console.log(`[padelcoronado] Cookies cacheadas expiradas o inválidas (${testResult.error || 'sin datos'}). Recargando sesión…`)
    }
  }

  // ── Estrategia 2: carga normal de la home (IP fría / GitHub Actions) ──────────
  // Si las cookies cacheadas no funcionaron (o no existían), cargamos la home
  // para que Cloudflare nos dé un cf_clearance nuevo.
  if (!firstPageResult) {
    console.log('[padelcoronado] Cargando home para establecer sesión Cloudflare…')
    try {
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 60000 })
    } catch (e) {
      console.warn('[padelcoronado] Warning en carga home:', e.message)
    }

    await page.waitForTimeout(6000)

    const pageTitle = await page.title().catch(() => '')
    const pageUrl   = page.url()
    console.log(`[padelcoronado] Página cargada: "${pageTitle}" — ${pageUrl}`)

    const enChallenge = pageTitle.toLowerCase().includes('just a moment')
      || pageTitle.toLowerCase().includes('checking')
      || pageTitle.toLowerCase().includes('attention required')
      || pageTitle.toLowerCase().includes('bot verification')
      || pageTitle.toLowerCase().includes('verificación')
      || pageUrl.includes('/cdn-cgi/')

    if (enChallenge) {
      console.warn('[padelcoronado] ❌ Cloudflare Turnstile activo ("Bot Verification").')
      console.warn('[padelcoronado]    La IP está marcada. Opciones:')
      console.warn('[padelcoronado]    1. Esperar 2-3h y reintentar (IP se enfría sola).')
      console.warn('[padelcoronado]    2. Visitar https://padelcoronado.com en Chrome (cf_clearance')
      console.warn('[padelcoronado]       se guardará en caché automáticamente la próxima vez que')
      console.warn('[padelcoronado]       el pipeline corra con IP fría).')
      console.warn('[padelcoronado]    En GitHub Actions (IP nueva cada run) no ocurre este problema.')
      await browser.close()
      return []
    }

    // Cerrar cookie banner si aparece
    try {
      await page.click('.cmplz-accept, #cookieMsg a.close, .cookies-accept, [data-cky-tag="accept-button"]', { timeout: 3000 })
      await page.waitForTimeout(800)
    } catch { /* sin banner */ }
  }

  // ── Bucle de paginación de la Store API ───────────────────────────────────────
  const allProducts = []
  const seen        = new Set()
  let pageNum       = 1
  let totalPages    = 1

  while (pageNum <= totalPages) {
    console.log(`[padelcoronado] API página ${pageNum}/${totalPages}…`)

    // Reusar el resultado de la pág 1 si ya lo obtuvimos en el test de cookies
    let result
    if (pageNum === 1 && firstPageResult) {
      result     = firstPageResult
      totalPages = firstPageResult.totalPages || 1
    } else {
      result = await fetchViaPage(page, pageNum)
      if (pageNum === 1) totalPages = result.totalPages || 1
    }

    if (result.error) {
      console.error(`[padelcoronado] Error en página ${pageNum}: ${result.error}`)
      break
    }

    const { data, totalPages: tp } = result
    if (tp) totalPages = tp
    if (!Array.isArray(data) || data.length === 0) break

    for (const p of data) {
      const title = p.name
      const url   = p.permalink
      if (!title || !url || seen.has(url)) continue
      seen.add(url)

      const minorUnit    = p.prices?.currency_minor_unit ?? 2
      const salePrice    = centsToEuros(p.prices?.sale_price,    minorUnit)
      const regularPrice = centsToEuros(p.prices?.regular_price, minorUnit)

      const price = !isNaN(salePrice) && salePrice > 0 ? salePrice : regularPrice
      if (isNaN(price) || price < 30) continue

      const precio_original = (!isNaN(regularPrice) && regularPrice > price) ? regularPrice : null

      allProducts.push({
        title,
        price,
        precio_original,
        url,
        image: bestImage(p.images),
        sku: p.sku || null,
      })
    }

    console.log(`[padelcoronado]  → ${data.length} productos en pág ${pageNum}/${totalPages} (acumulado: ${allProducts.length})`)

    pageNum++
    if (pageNum <= totalPages) await sleep(DELAY_MS)
  }

  // Guardar cookies para futuras ejecuciones (solo si obtuvimos palas)
  if (allProducts.length > 0) {
    await saveCookies(context)
  }

  await browser.close()

  console.log(`[padelcoronado] Total palas: ${allProducts.length}`)

  // Detección best-effort de código de descuento y secciones de rebajas
  const { codigoDescuento, rebajasUrls } = await detectarRebajasYCodigoViaHtml(
    `${BASE_URL}/categoria-producto/palas-padel/`, BASE_URL
  )
  if (codigoDescuento) {
    console.log(`[padelcoronado] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
  }
  if (rebajasUrls.length > 0) {
    console.log(`[padelcoronado] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
  }

  const scraped_at = new Date().toISOString()
  const resultado = allProducts.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original,
    url:             p.url,
    image:           p.image,
    sku:             p.sku ?? null,
    scraped_at,
  }))
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
