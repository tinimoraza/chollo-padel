// scripts/prices/scrapers/padelcoronado.js
// WooCommerce Store API — con playwright-extra + stealth plugin para bypasear Cloudflare Turnstile
//
// Problema: padelcoronado.com usa Cloudflare Turnstile (captcha "no soy robot")
// que bloquea tanto Node.js fetch (TLS fingerprint de undici ≠ Chrome real → HTTP 403)
// como Playwright headless estándar (detectado como bot → Turnstile se activa → sin cf_clearance → 403).
//
// Solución: playwright-extra + puppeteer-extra-plugin-stealth
//   - Parchea navigator.webdriver, chrome runtime, plugins, permissions, WebGL, canvas, etc.
//   - Con estos parches, Cloudflare no detecta headless → Turnstile NO se activa
//   - El browser obtiene cf_clearance automáticamente (como Chrome real)
//   - page.evaluate(fetch(...)) llama a la Store API same-origin con esas cookies
//
// Endpoint: /wp-json/wc/store/v1/products?category=palas-padel
// Precios: strings de céntimos enteros ("15995" = 159,95€), minor_unit=2
// Total: ~149 palas en 2 páginas (per_page=100)

const { detectarRebajasYCodigoViaHtml } = require('./_discount-utils.js')

const SOURCE_KEY = 'padelcoronado'
const BASE_URL   = 'https://padelcoronado.com'
const CATEGORY   = 'palas-padel'
const PER_PAGE   = 100
const DELAY_MS   = 1200

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

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
  console.log('[padelcoronado] Iniciando scraper (playwright-extra + stealth + Store API same-origin)…')

  let chromium, StealthPlugin
  try {
    ({ chromium } = require('playwright-extra'))
    StealthPlugin = require('puppeteer-extra-plugin-stealth')
    chromium.use(StealthPlugin())
  } catch (e) {
    console.error('[padelcoronado] playwright-extra o puppeteer-extra-plugin-stealth no instalados:', e.message)
    console.error('[padelcoronado] Instala con: npm install playwright-extra puppeteer-extra-plugin-stealth')
    return []
  }

  // channel: 'chrome' usa el Google Chrome instalado en el sistema en vez del
  // Chromium bundled de Playwright. La huella TLS de Chrome real es idéntica a
  // la de un browser humano, lo que ayuda a pasar el Cloudflare Turnstile.
  // Si Chrome no está instalado, Playwright cae al Chromium bundled (warning).
  let browser
  try {
    browser = await chromium.launch({
      headless: true,
      channel: 'chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
  } catch {
    // Fallback: Chromium bundled (GitHub Actions u otros entornos sin Chrome)
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

  // Paso 1: cargar la home para establecer sesión Cloudflare (cf_clearance, etc.)
  // Con stealth plugin activo, Cloudflare no debería mostrar Turnstile.
  // waitUntil: 'networkidle' espera a que los scripts de Cloudflare terminen de
  // ejecutarse (incluido el JS del challenge), no solo el DOM.
  console.log('[padelcoronado] Cargando home para establecer sesión Cloudflare…')
  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 60000 })
  } catch (e) {
    console.warn('[padelcoronado] Warning en carga home:', e.message)
  }

  // Dar tiempo extra a Cloudflare para procesar
  await page.waitForTimeout(6000)

  // Diagnóstico: loguear título y URL para detectar challenge
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
    console.warn('[padelcoronado] Cloudflare Turnstile activo ("Bot Verification").')
    console.warn('[padelcoronado] Causa: IP marcada por intentos recientes. Se necesita IP fría.')
    console.warn('[padelcoronado] En GitHub Actions (IP nueva cada run) funcionará correctamente.')
    console.warn('[padelcoronado] En local: esperar 2-3h sin acceder a padelcoronado y reintentar.')
    await browser.close()
    return []
  }

  // Cerrar cookie banner si aparece
  try {
    await page.click('.cmplz-accept, #cookieMsg a.close, .cookies-accept, [data-cky-tag="accept-button"]', { timeout: 3000 })
    await page.waitForTimeout(800)
  } catch { /* sin banner */ }

  // Paso 2: llamar a la Store API desde dentro del browser (same-origin)
  const allProducts = []
  const seen = new Set()
  let pageNum    = 1
  let totalPages = 1

  while (pageNum <= totalPages) {
    console.log(`[padelcoronado] API página ${pageNum}/${totalPages}…`)

    const result = await fetchViaPage(page, pageNum)

    if (result.error) {
      console.error(`[padelcoronado] Error en página ${pageNum}: ${result.error}`)
      break
    }

    const { data, totalPages: tp } = result
    totalPages = tp || totalPages
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
