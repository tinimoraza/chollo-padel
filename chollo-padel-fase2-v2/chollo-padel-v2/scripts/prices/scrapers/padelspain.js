// scripts/prices/scrapers/padelspain.js
// Padel-Spain — Playwright + PrestaShop
// URL catálogo: https://padel-spain.es/es/257-palas-de-padel
//
// Fix 2026-08-12: migrado de fetch()+cheerio a Playwright. El fetch plano
// (User-Agent fijo, sin cookies, sin headers de navegador) recibía HTTP 403
// de forma persistente, mientras que la misma URL carga con normalidad en
// un navegador real.
//
// Fix 2026-08-13 (varias iteraciones, dato real en cada una):
//   1ª hipótesis: bloqueo anti-bot por navigator.webdriver — descartada.
//   2ª hipótesis: popup fancybox bloqueando el clic en "Siguiente" — cierto
//      que el popup existe, pero no era la causa real del corte.
//   3ª hipótesis: paginación AJAX mal esperada (waitForURL/waitForFunction)
//      — el clic no se podía verificar de forma fiable en headless.
//   4º intento: goto() con 'networkidle' — EMPEORÓ: ni siquiera cargaba
//      (timeout total de 45s), confirmando que no es un problema de espera.
// El patrón real, confirmado con datos de las 6 ejecuciones: LA PRIMERA
// petición de cada sesión de Playwright siempre funciona (página 1, con
// cualquier estrategia), y TODAS las peticiones siguientes de esa MISMA
// sesión/contexto fallan — sea página 2 por goto, por clic, o cualquier URL
// de rebajas. Esto es consistente con un bloqueo por sesión/fingerprint que
// distingue la primera petición de las siguientes dentro del mismo contexto
// de navegador. Contramedida: usar un contexto de navegador (BrowserContext)
// NUEVO Y LIMPIO para cada página, en vez de reutilizar el mismo — así cada
// petición se ve, de cara al sitio, como una "primera visita".
// Selectores confirmados en vivo el 2026-08-12/13:
//   - Contenedor: article.product-miniature (32 por página)
//   - Título+URL: h3 a / h2 a / .product-title a
//   - Precio actual: span[itemprop="price"][content]
//   - Precio original: .regular-price / .old-price (solo si hay descuento)
//   - Paginación: ?page=N (12 páginas confirmadas en vivo el 2026-08-13)

const SOURCE_KEY     = 'padelspain'
const BASE_URL        = 'https://padel-spain.es'
const CATEGORY_PATH   = '/es/257-palas-de-padel'
const DELAY_MS         = 2500

const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

const EXCLUIR = ['zapatilla', 'mochila', 'paletero', 'bolsa', 'grip', 'overgrip',
  'pelota', 'pelotas', 'camiseta', 'funda', 'muñequera', 'protector', 'pack ']

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'es-ES,es;q=0.9',
}

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR.some(w => t.includes(w))
}

async function cerrarPopups(page) {
  try {
    await page.click('.fancybox-close, .fancybox-close-small, .fancybox-item.fancybox-close', { timeout: 1500 })
  } catch { /* sin popup */ }
}

async function extractProducts(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('article.product-miniature, .js-product-miniature'))
    return cards.map(card => {
      const titleEl = card.querySelector('h3 a, h2 a, .product-title a')
      const title   = titleEl?.textContent?.trim()
      const url     = titleEl?.getAttribute('href')
      if (!title || !url) return null

      const priceEl = card.querySelector('span[itemprop="price"]')
      const price   = priceEl ? parseFloat(priceEl.getAttribute('content')) : NaN
      if (isNaN(price) || price <= 0) return null

      const regularEl = card.querySelector('.regular-price, .old-price')
      const originalText = regularEl?.textContent?.trim() ?? ''
      const original = originalText
        ? parseFloat(originalText.replace(/[^0-9,]/g, '').replace(',', '.'))
        : NaN

      const imgEl  = card.querySelector('img')
      const rawImg = imgEl ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('src') || '') : ''
      const image  = rawImg.startsWith('data:') ? null : (rawImg.split('?')[0] || null)

      return {
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url,
        image,
      }
    }).filter(Boolean)
  })
}

// Abre un contexto de navegador NUEVO (no reutilizado) para esta URL,
// extrae los productos y lo cierra. extraerNav=true además devuelve el
// código de descuento detectado y las URLs de rebajas (solo hace falta en
// la página 1).
async function scrapePagina(browser, url, { extraerNav = false } = {}) {
  const context = await browser.newContext({
    userAgent: HEADERS['User-Agent'],
    locale: 'es-ES',
    extraHTTPHeaders: { 'Accept-Language': HEADERS['Accept-Language'] },
  })
  const page = await context.newPage()

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40_000 })
    await page.waitForTimeout(1200)
    await cerrarPopups(page)

    let cardsFound = false
    try {
      await page.waitForSelector('article.product-miniature, .js-product-miniature', { timeout: 20_000 })
      cardsFound = true
    } catch { /* sin productos */ }

    if (!cardsFound) return { ok: false, products: [] }

    const products = (await extractProducts(page)).filter(p => isPala(p.title))
    const resultado = { ok: true, products }

    if (extraerNav) {
      const bodyText = await page.evaluate(() => document.body.innerText)
      resultado.codigoDescuento = detectarCodigoDescuento(bodyText)
      const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href))
      resultado.rebajasUrls = filtrarUrlsRebajas(hrefs, `${BASE_URL}${CATEGORY_PATH}`)
      const hasNext = await page.evaluate(() => !!document.querySelector('a[rel="next"], a[href*="page=2"]'))
      resultado.hasNext = hasNext
    } else {
      const nextMatch = url.match(/page=(\d+)/)
      const currentPage = nextMatch ? parseInt(nextMatch[1], 10) : 1
      resultado.hasNext = await page.evaluate((cp) => !!document.querySelector(`a[href*="page=${cp + 1}"]`), currentPage)
    }

    return resultado
  } catch (err) {
    return { ok: false, products: [], error: err.message }
  } finally {
    await context.close().catch(() => {})
  }
}

async function scrape() {
  console.log('[padelspain] Iniciando scraper (Playwright + PrestaShop, contexto nuevo por página)…')

  let chromium
  try {
    ({ chromium } = require('playwright'))
  } catch {
    console.error('[padelspain] playwright no instalado')
    return []
  }

  const browser = await chromium.launch({ headless: true })

  const allProducts = []
  const seen = new Set()
  let pageNum = 1
  let codigoDescuento = null
  let rebajasUrls = []

  try {
    while (true) {
      const url = pageNum === 1 ? `${BASE_URL}${CATEGORY_PATH}` : `${BASE_URL}${CATEGORY_PATH}?page=${pageNum}`
      console.log(`[padelspain] Página ${pageNum}…`)

      const r = await scrapePagina(browser, url, { extraerNav: pageNum === 1 })
      if (!r.ok) {
        console.log(`[padelspain] Sin productos en página ${pageNum}${r.error ? ` (${r.error})` : ''} — fin`)
        break
      }

      if (pageNum === 1) {
        codigoDescuento = r.codigoDescuento
        rebajasUrls = r.rebajasUrls || []
        if (codigoDescuento) {
          console.log(`[padelspain] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
        }
        if (rebajasUrls.length > 0) {
          console.log(`[padelspain] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
        }
      }

      console.log(`[padelspain]  → ${r.products.length} palas`)
      for (const item of r.products) {
        if (seen.has(item.url)) continue
        seen.add(item.url)
        allProducts.push(item)
      }
      if (r.products.length === 0) break

      if (!r.hasNext) {
        console.log(`[padelspain] Última página (${pageNum}). Total: ${allProducts.length}`)
        break
      }

      pageNum++
      await new Promise(res => setTimeout(res, DELAY_MS))
    }
  } catch (err) {
    console.error('[padelspain] Error:', err.message)
  }

  for (const rebajasUrl of rebajasUrls) {
    const r = await scrapePagina(browser, rebajasUrl)
    if (!r.ok) {
      console.error(`[padelspain] Error sección rebajas ${rebajasUrl}: ${r.error || 'sin productos'}`)
    } else {
      let added = 0
      for (const item of r.products) {
        if (seen.has(item.url)) continue
        seen.add(item.url)
        allProducts.push(item)
        added++
      }
      console.log(`[padelspain] sección rebajas ${rebajasUrl} → ${added} productos nuevos`)
    }
    await new Promise(res => setTimeout(res, DELAY_MS))
  }

  await browser.close()

  console.log(`[padelspain] Total palas: ${allProducts.length}`)
  const scraped_at = new Date().toISOString()
  const resultado = allProducts.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    image:           p.image ?? null,
    scraped_at,
  }))
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
