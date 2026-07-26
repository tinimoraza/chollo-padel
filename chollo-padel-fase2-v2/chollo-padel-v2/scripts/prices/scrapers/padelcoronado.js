// scripts/prices/scrapers/padelcoronado.js
const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

const SOURCE_KEY      = 'padelcoronado'
const CATEGORY_URL    = 'https://padelcoronado.com/categoria-producto/palas-padel/'
const SCROLL_PAUSE_MS = 4000
const MAX_SCROLLS     = 100
const STABLE_NEEDED   = 4

// Reintenta un page.evaluate si la navegación (p.ej. reload tras aceptar cookies)
// destruye el execution context a mitad de la llamada.
async function safeEvaluate(page, fn, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await page.evaluate(fn)
    } catch (err) {
      const msg = err?.message || ''
      if (!msg.includes('Execution context was destroyed') && !msg.includes('Target closed')) throw err
      console.log(`[padelcoronado]   ⚠️  Contexto destruido por navegación, reintentando (${i + 1}/${attempts})…`)
      await page.waitForLoadState('domcontentloaded').catch(() => {})
      await page.waitForTimeout(1500)
    }
  }
  return null
}

async function scrapeBrandPage(page, url, state, excludeUrls = []) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(3000)

  // Elementor 4.2+ puede usar .e-loop-item, article.type-product, li.product o
  // simplemente renderizar los enlaces /producto/ directamente en el DOM.
  // Esperamos cualquiera de estas señales; si ninguna aparece, no hay productos.
  const PRODUCT_SELECTOR = [
    '.e-loop-item.product',
    '.e-loop-item',
    'li.product',
    'article.type-product',
    'article.product',
    'a[href*="/producto/"]',
  ].join(', ')

  try {
    await page.waitForSelector(PRODUCT_SELECTOR, { timeout: 15000 })
  } catch {
    console.log(`[padelcoronado]   Sin productos en ${url}`)
    return []
  }

  if (state && !state.checked) {
    state.checked = true
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '')
    state.codigoDescuento = detectarCodigoDescuento(bodyText)
    if (state.codigoDescuento) {
      console.log(`[padelcoronado] codigo detectado: ${state.codigoDescuento.codigo} (-${state.codigoDescuento.descuento_pct}%)`)
    }
    const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href)).catch(() => [])
    state.rebajasUrls = filtrarUrlsRebajas(hrefs, CATEGORY_URL, excludeUrls)
    if (state.rebajasUrls.length > 0) {
      console.log(`[padelcoronado] sección(es) de rebajas detectada(s): ${state.rebajasUrls.join(', ')}`)
    }
  }

  // Scroll hasta estabilizar
  let prevCount = 0, stableCount = 0, scrolls = 0
  while (scrolls < MAX_SCROLLS) {
    const count = (await safeEvaluate(page, () => {
      const selectors = ['.e-loop-item.product', '.e-loop-item', 'li.product', 'article.type-product', 'article.product']
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel)
        if (els.length > 0) return els.length
      }
      // Fallback: contar enlaces de producto únicos
      return new Set(Array.from(document.querySelectorAll('a[href*="/producto/"]')).map(a => a.href)).size
    })) ?? 0
    if (count === prevCount) {
      stableCount++
      if (stableCount >= STABLE_NEEDED) break
    } else {
      stableCount = 0
    }
    prevCount = count
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(SCROLL_PAUSE_MS)
    scrolls++
  }

  return (await safeEvaluate(page, () => {
    function parsePrice(text) {
      if (!text) return NaN
      const m = text.match(/([\d.]+,\d{2})/)
      if (!m) return NaN
      return parseFloat(m[1].replace('.', '').replace(',', '.'))
    }

    // Probar selectores de contenedor en orden de preferencia
    const selectors = ['.e-loop-item.product', '.e-loop-item', 'li.product', 'article.type-product', 'article.product']
    let els = []
    for (const sel of selectors) {
      els = Array.from(document.querySelectorAll(sel))
      if (els.length > 0) break
    }

    // Fallback: extraer directamente de los enlaces de producto con precio cercano
    if (els.length === 0) {
      const seen = new Set()
      const out = []
      document.querySelectorAll('a[href*="/producto/"]').forEach(a => {
        const url = a.href.split('?')[0]
        if (seen.has(url)) return
        // Buscar el contenedor raíz más cercano que tenga precio
        let container = a
        for (let i = 0; i < 6; i++) {
          if (!container.parentElement) break
          container = container.parentElement
          const priceEl = container.querySelector('.woocommerce-Price-amount bdi, ins .amount, .price .amount')
          if (priceEl) break
        }
        const title = (a.getAttribute('title') || a.textContent || '').trim()
        const priceEl = container.querySelector('.price ins .woocommerce-Price-amount bdi, .price .woocommerce-Price-amount bdi')
        const origEl  = container.querySelector('.price del .woocommerce-Price-amount bdi')
        const price    = parsePrice(priceEl?.textContent ?? '')
        const original = parsePrice(origEl?.textContent ?? '')
        const imgEl    = container.querySelector('img')
        const rawImg   = imgEl ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('src') || '') : ''
        const image    = rawImg.startsWith('data:') ? null : (rawImg.split('?')[0] || null)
        if (!title || isNaN(price) || price <= 0) return
        seen.add(url)
        out.push({ title, price, precio_original: (!isNaN(original) && original > price) ? original : null, url, image })
      })
      return out
    }

    return els.map(el => {
      const titleEl =
        el.querySelector('.elementor-heading-title') ||
        el.querySelector('.woocommerce-loop-product__title') ||
        el.querySelector('h2, h3')
      const title = titleEl?.textContent?.trim()
      if (!title) return null

      const linkEl =
        el.querySelector('a[href*="padelcoronado.com/producto/"]') ||
        el.querySelector('a[href*="padelcoronado.com"]') ||
        el.querySelector('a')
      const url = linkEl?.href ?? ''
      if (!url.startsWith('http')) return null

      let price = NaN, original = NaN
      const srTexts = Array.from(el.querySelectorAll('span.screen-reader-text'))
        .map(s => s.textContent.trim())
      const currentSR  = srTexts.find(t => t.includes('precio actual'))
      const originalSR = srTexts.find(t => t.includes('precio original') || t.includes('precio era'))
      if (currentSR)  price    = parsePrice(currentSR)
      if (originalSR) original = parsePrice(originalSR)
      if (isNaN(price)) {
        const amountEl = el.querySelector(
          '.price ins .woocommerce-Price-amount bdi, ' +
          '.price .woocommerce-Price-amount bdi, ' +
          '.woocommerce-Price-amount bdi'
        )
        price = parsePrice(amountEl?.textContent ?? '')
      }
      if (isNaN(price) || price <= 0) return null

      // Imagen — WooCommerce/Elementor hace lazy-load (data-src con la url real).
      const imgEl  = el.querySelector('img')
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
  })) ?? []
}

async function scrape() {
  console.log('[padelcoronado] Iniciando scraper (Playwright, marcas dinámicas)…')

  let chromium
  try {
    ({ chromium } = require('playwright'))
  } catch {
    console.error('[padelcoronado] playwright no instalado — npm install playwright')
    return []
  }

  const browser = await chromium.launch({ headless: true })
  const page    = await browser.newPage()

  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })

  // Cargar categoría principal para: (1) cerrar cookies, (2) descubrir marcas
  await page.goto(CATEGORY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2000)

  try {
    await page.waitForSelector('.cmplz-accept, button[data-cmplz], .cc-btn, [data-cky-tag="accept-button"]', { timeout: 5000 })
    await page.click('.cmplz-accept, button[data-cmplz], .cc-btn, [data-cky-tag="accept-button"]')
    console.log('[padelcoronado] Banner cookies cerrado ✅')
    // Esperar a que la página se estabilice tras el banner (puede hacer reload)
    await page.waitForLoadState('domcontentloaded').catch(() => {})
    await page.waitForTimeout(2500)
  } catch {
    console.log('[padelcoronado] Sin banner de cookies')
  }

  // Esperar a que el DOM esté listo antes de evaluar
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await page.waitForTimeout(1000)

  // Descubrir URLs de marca desde el sidebar de filtros (selectores de checkbox).
  // El HTML tiene dos estilos de URL: /marca-de-palas/{brand}/ (menú) y
  // /categoria-producto/palas-padel/marca-palas-{brand}/ (filtros).
  // Usamos los filtros porque son más fiables para paginación WooCommerce.
  const brandUrls = (await safeEvaluate(page, () => {
    const links = Array.from(document.querySelectorAll('a[href*="/marca-palas-"], a[href*="/marca-de-palas/"]'))
    const urls  = links
      .map(a => a.href)
      .filter(h => h.includes('/categoria-producto/palas-padel/') || h.includes('/marca-de-palas/'))
    return [...new Set(urls)]
  })) ?? []

  if (brandUrls.length === 0) {
    console.log('[padelcoronado] ⚠️  No se encontraron URLs de marca — scrapeando categoría global')
    brandUrls.push(CATEGORY_URL)
  } else {
    console.log(`[padelcoronado] Marcas encontradas: ${brandUrls.length}`)
    brandUrls.forEach(u => console.log(`  • ${u}`))
  }

  // Scrapear cada marca
  const allProducts = []
  const state = { checked: false, codigoDescuento: null, rebajasUrls: [] }
  for (const brandUrl of brandUrls) {
    const brand = brandUrl.match(/marca-palas-([^/]+)/)?.[1] ?? 'global'
    console.log(`[padelcoronado] Scrapeando: ${brand}`)
    const products = await scrapeBrandPage(page, brandUrl, state, brandUrls)
    console.log(`[padelcoronado]   → ${products.length} palas`)
    allProducts.push(...products)
  }

  for (const rebajasUrl of state.rebajasUrls) {
    console.log(`[padelcoronado] Scrapeando sección rebajas: ${rebajasUrl}`)
    const products = await scrapeBrandPage(page, rebajasUrl, null, brandUrls)
    console.log(`[padelcoronado]   sección rebajas → ${products.length} palas`)
    allProducts.push(...products)
  }

  await browser.close()

  // Deduplicar por URL
  const seen   = new Set()
  const unique = allProducts.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  console.log(`[padelcoronado] Total palas únicas: ${unique.length}`)

  const scraped_at = new Date().toISOString()
  const resultado = unique.map(p => ({
    source_key:      SOURCE_KEY,
    title:           p.title,
    price:           p.price,
    precio_original: p.precio_original ?? null,
    url:             p.url,
    image:           p.image ?? null,
    scraped_at,
  }))
  resultado.codigoDescuento = state.codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
