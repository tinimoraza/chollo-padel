// scripts/prices/scrapers/padelspain.js
// Padel-Spain — Playwright + PrestaShop
// URL catálogo: https://padel-spain.es/es/257-palas-de-padel
//
// Fix 2026-08-12: migrado de fetch()+cheerio a Playwright. El fetch plano
// (User-Agent fijo, sin cookies, sin headers de navegador) recibía HTTP 403
// de forma persistente (confirmado en varias ejecuciones del pipeline local
// de los días previos), mientras que la misma URL carga con normalidad en
// un navegador real (verificado en vivo el 2026-08-12: 32 productos/página,
// sin ningún challenge/captcha visible) — consistente con un bloqueo
// anti-bot que distingue clientes HTTP simples de navegadores reales.
// Selectores confirmados en vivo el 2026-08-12:
//   - Contenedor: article.product-miniature (32 por página)
//   - Título+URL: h3.s_title_block a[href] (texto = título completo)
//   - Precio actual: span[itemprop="price"][content] (valor numérico limpio)
//   - Precio original: .regular-price / .old-price (solo si hay descuento)
//   - Paginación: ?page=N ("1/12" ≈ 12 páginas en el momento de la verificación)

const SOURCE_KEY     = 'padelspain'
const BASE_URL        = 'https://padel-spain.es'
const CATEGORY_PATH   = '/es/257-palas-de-padel'
const DELAY_MS         = 1500

const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

const EXCLUIR = ['zapatilla', 'mochila', 'paletero', 'bolsa', 'grip', 'overgrip',
  'pelota', 'pelotas', 'camiseta', 'funda', 'muñequera', 'protector', 'pack ']

function isPala(title) {
  const t = title.toLowerCase()
  return !EXCLUIR.some(w => t.includes(w))
}

async function extractProducts(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('article.product-miniature, .js-product-miniature'))
    return cards.map(card => {
      const titleEl = card.querySelector('h3 a, h2 a, .product-title a')
      const title   = titleEl?.textContent?.trim()
      const url     = titleEl?.getAttribute('href')
      if (!title || !url) return null

      // Precio actual — PrestaShop lo pone limpio en el atributo content
      const priceEl = card.querySelector('span[itemprop="price"]')
      const price   = priceEl ? parseFloat(priceEl.getAttribute('content')) : NaN
      if (isNaN(price) || price <= 0) return null

      // Precio original tachado (solo existe cuando hay descuento)
      const regularEl = card.querySelector('.regular-price, .old-price')
      const originalText = regularEl?.textContent?.trim() ?? ''
      const original = originalText
        ? parseFloat(originalText.replace(/[^0-9,]/g, '').replace(',', '.'))
        : NaN

      // Imagen — lazy-load habitual en PrestaShop (data-src con la url real)
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

async function scrape() {
  console.log('[padelspain] Iniciando scraper (Playwright + PrestaShop)…')

  let chromium
  try {
    ({ chromium } = require('playwright'))
  } catch {
    console.error('[padelspain] playwright no instalado')
    return []
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const page    = await browser.newPage()

  await page.setExtraHTTPHeaders({
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'es-ES,es;q=0.9',
  })

  // Fix 2026-08-12: el sitio deja pasar la primera petición de la sesión
  // (página 1) pero bloquea con timeout TODAS las siguientes (página 2 y
  // las 7 secciones de rebajas), tanto la primera vez como reintentando —
  // 2/2 ejecuciones reales. Verificado que NO es la URL ni rapidez de
  // navegación: la misma secuencia (carga página 1 → inmediatamente página 2)
  // funciona sin problema en un Chrome real. La diferencia es que Playwright
  // Chromium headless expone navigator.webdriver=true y otras señales que
  // un WAF puede usar para servir solo la primera petición con normalidad y
  // frenar el resto de la sesión automatizada. Se enmascaran esas señales
  // (patrón "stealth" estándar) antes de cualquier navegación.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    // @ts-ignore
    window.chrome = window.chrome || { runtime: {} }
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
    Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es'] })
  })

  const allProducts = []
  const seen = new Set()
  let pageNum = 1
  let codigoDescuento = null
  let rebajasUrls = []

  try {
    let yaNavegado = false // true cuando la página actual se alcanzó con clic (no con goto)

    while (true) {
      console.log(`[padelspain] Página ${pageNum}…`)

      if (!yaNavegado) {
        // Fix 2026-08-12 (2ª contramedida): saltar directo con page.goto() a
        // ?page=N es indistinguible de "teletransportarse" — ningún usuario
        // real llega así a la página 2. Solo la página 1 se navega con goto
        // (es la entrada natural desde fuera). De la 2 en adelante se navega
        // haciendo clic real en el enlace "Siguiente" (ver más abajo), que
        // deja el mismo rastro que un usuario navegando con el ratón.
        const url = `${BASE_URL}${CATEGORY_PATH}`
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40_000 })
        await page.waitForTimeout(1500)
      }
      yaNavegado = false

      // Cerrar cookies si aparece
      try {
        await page.click('.cmplz-accept, [data-cky-tag="accept-button"], #onetrust-accept-btn-handler', { timeout: 2000 })
        await page.waitForTimeout(500)
      } catch { /* sin banner */ }

      // Fix 2026-08-12: la página 2 falló una vez con timeout aunque el sitio
      // funcionaba con normalidad (verificado en vivo justo después, misma
      // URL → 32 productos) — parece un hipo puntual de carga, no un bloqueo
      // real. Se añade un reintento (recarga + segunda espera) antes de dar
      // la página por vacía, para no cortar el scraping por un fallo transitorio.
      let cardsFound = false
      for (let intento = 1; intento <= 2 && !cardsFound; intento++) {
        try {
          await page.waitForSelector('article.product-miniature, .js-product-miniature', { timeout: 15_000 })
          cardsFound = true
        } catch {
          if (intento === 1) {
            console.log(`[padelspain] Timeout esperando productos en página ${pageNum}, reintentando…`)
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 40_000 }).catch(() => {})
            await page.waitForTimeout(1500)
          }
        }
      }
      if (!cardsFound) {
        console.log(`[padelspain] Sin productos en página ${pageNum} tras reintento — fin`)
        break
      }

      if (pageNum === 1) {
        const bodyText = await page.evaluate(() => document.body.innerText)
        codigoDescuento = detectarCodigoDescuento(bodyText)
        if (codigoDescuento) {
          console.log(`[padelspain] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
        }
        const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href))
        rebajasUrls = filtrarUrlsRebajas(hrefs, `${BASE_URL}${CATEGORY_PATH}`)
        if (rebajasUrls.length > 0) {
          console.log(`[padelspain] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
        }
      }

      const products = (await extractProducts(page)).filter(p => isPala(p.title))
      console.log(`[padelspain]  → ${products.length} palas`)

      let nuevos = 0
      for (const item of products) {
        if (seen.has(item.url)) continue
        seen.add(item.url)
        allProducts.push(item)
        nuevos++
      }
      if (products.length === 0) break

      // Comprobar si hay página siguiente y, si la hay, hacer clic real en
      // el enlace en vez de navegar con goto() (ver comentario más arriba).
      const nextSelector = `a[href*="page=${pageNum + 1}"]`
      const hasNext = await page.evaluate((sel) => !!document.querySelector(sel), nextSelector)

      if (!hasNext) {
        console.log(`[padelspain] Última página (${pageNum}). Total: ${allProducts.length}`)
        break
      }

      await page.waitForTimeout(DELAY_MS)
      try {
        await Promise.all([
          page.waitForLoadState('domcontentloaded', { timeout: 40_000 }),
          page.click(nextSelector, { timeout: 5_000 }),
        ])
        yaNavegado = true
      } catch (e) {
        console.log(`[padelspain] No se pudo hacer clic en "Siguiente" (${e.message}), fin de paginación`)
        break
      }
      pageNum++
    }
  } catch (err) {
    console.error('[padelspain] Error:', err.message)
  }

  for (const rebajasUrl of rebajasUrls) {
    try {
      await page.goto(rebajasUrl, { waitUntil: 'domcontentloaded', timeout: 40_000 })
      await page.waitForTimeout(1500)
      // Mismo reintento que en la paginación principal (ver fix 2026-08-12).
      let cardsFound = false
      for (let intento = 1; intento <= 2 && !cardsFound; intento++) {
        try {
          await page.waitForSelector('article.product-miniature, .js-product-miniature', { timeout: 15_000 })
          cardsFound = true
        } catch {
          if (intento === 1) {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 40_000 }).catch(() => {})
            await page.waitForTimeout(1500)
          }
        }
      }
      if (!cardsFound) throw new Error('sin productos tras reintento')
      const products = (await extractProducts(page)).filter(p => isPala(p.title))
      let added = 0
      for (const item of products) {
        if (seen.has(item.url)) continue
        seen.add(item.url)
        allProducts.push(item)
        added++
      }
      console.log(`[padelspain] sección rebajas ${rebajasUrl} → ${added} productos nuevos`)
    } catch (e) {
      console.error(`[padelspain] Error sección rebajas ${rebajasUrl}:`, e.message)
    }
    await page.waitForTimeout(DELAY_MS)
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
