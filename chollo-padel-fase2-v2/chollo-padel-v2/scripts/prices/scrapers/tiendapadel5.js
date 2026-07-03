// scripts/prices/scrapers/tiendapadel5.js
// TiendaPadel5 — WooCommerce + Elementor
// URL categoría: https://tiendapadel5.com/palas-padel/
// Paginación: /palas-padel/page/N/
// Nota: también tiene palas con defectos estéticos a precio reducido
//       (https://tiendapadel5.com/palas-padel/defectos-esteticos/) — incluidas

const SOURCE_KEY = 'tiendapadel5'
const BASE_URL   = 'https://tiendapadel5.com/palas-padel/'
const DELAY_MS   = 1500

const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

async function extractProducts(page) {
  return page.evaluate(() => {
    function parsePrice(text) {
      if (!text) return NaN
      const clean = text.replace(/[^\d,.]/g, '').replace('.', '').replace(',', '.')
      return parseFloat(clean)
    }

    const items = []
    const els = Array.from(document.querySelectorAll('li.product, article.product, .type-product'))

    els.forEach(el => {
      // Título
      const titleEl =
        el.querySelector('.woocommerce-loop-product__title') ||
        el.querySelector('h2, h3, .product-title')
      const title = titleEl?.textContent?.trim()
      if (!title) return

      // URL
      const linkEl = el.querySelector('a.woocommerce-LoopProduct-link, a.product-link, a')
      const url = linkEl?.href ?? ''
      if (!url.startsWith('http')) return

      // Precio — WooCommerce con oferta: <del>original</del><ins>actual</ins>
      const insEl  = el.querySelector('.price ins .woocommerce-Price-amount bdi, .price ins .amount')
      const delEl  = el.querySelector('.price del .woocommerce-Price-amount bdi, .price del .amount')
      const anyEl  = el.querySelector('.price .woocommerce-Price-amount bdi, .price .amount')
      const priceEl = insEl ?? anyEl
      if (!priceEl) return

      const price    = parsePrice(priceEl.textContent)
      const original = delEl ? parsePrice(delEl.textContent) : NaN
      if (isNaN(price) || price <= 0) return

      // Imagen
      const imgEl = el.querySelector('img.wp-post-image, img.attachment-woocommerce_thumbnail, img')
      const image = imgEl?.src ?? imgEl?.dataset?.src ?? null

      items.push({
        title,
        price,
        precio_original: (!isNaN(original) && original > price) ? original : null,
        url,
        image: image && image.startsWith('http') ? image : null,
      })
    })
    return items
  })
}

async function scrape() {
  console.log('[tiendapadel5] Iniciando scraper (WooCommerce)…')

  let chromium
  try {
    ({ chromium } = require('playwright'))
  } catch {
    console.error('[tiendapadel5] playwright no instalado — npm install playwright')
    return []
  }

  const browser = await chromium.launch({ headless: true })
  const page    = await browser.newPage()

  await page.setExtraHTTPHeaders({
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'es-ES,es;q=0.9',
  })

  const allProducts = []
  let pageNum = 1
  let codigoDescuento = null
  let rebajasUrls = []

  try {
    while (true) {
      const url = pageNum === 1 ? BASE_URL : `${BASE_URL}page/${pageNum}/`
      console.log(`[tiendapadel5] Página ${pageNum}: ${url}`)

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

      // Cerrar cookies
      if (pageNum === 1) {
        try {
          await page.waitForSelector('.cmplz-accept, .cc-btn, [data-cky-tag="accept-button"]', { timeout: 4000 })
          await page.click('.cmplz-accept, .cc-btn, [data-cky-tag="accept-button"]')
          await page.waitForTimeout(800)
        } catch { /* sin banner */ }
      }

      try {
        await page.waitForSelector('li.product, article.product, .type-product', { timeout: 15000 })
      } catch {
        console.log(`[tiendapadel5] Sin productos en página ${pageNum} — fin`)
        break
      }

      if (pageNum === 1) {
        const bodyText = await page.evaluate(() => document.body.innerText)
        codigoDescuento = detectarCodigoDescuento(bodyText)
        if (codigoDescuento) {
          console.log(`[tiendapadel5] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
        }
        const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href))
        rebajasUrls = filtrarUrlsRebajas(hrefs, BASE_URL)
        if (rebajasUrls.length > 0) {
          console.log(`[tiendapadel5] sección(es) de rebajas detectada(s): ${rebajasUrls.join(', ')}`)
        }
      }

      const products = await extractProducts(page)
      console.log(`[tiendapadel5]  → ${products.length} palas`)

      if (products.length === 0) break
      allProducts.push(...products)

      // ¿Hay página siguiente?
      const hasNext = await page.evaluate(() =>
        !!document.querySelector('a.next, .next.page-numbers, a[class*="next"]')
      )
      if (!hasNext) {
        console.log(`[tiendapadel5] Última página (${pageNum}). Total: ${allProducts.length}`)
        break
      }

      pageNum++
      await page.waitForTimeout(DELAY_MS)
    }
  } catch (err) {
    console.error('[tiendapadel5] Error:', err.message)
  }

  for (const rebajasUrl of rebajasUrls) {
    try {
      await page.goto(rebajasUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForSelector('li.product, article.product, .type-product', { timeout: 15000 })
      const products = await extractProducts(page)
      console.log(`[tiendapadel5] sección rebajas ${rebajasUrl} → ${products.length} productos`)
      allProducts.push(...products)
    } catch (e) {
      console.error(`[tiendapadel5] Error sección rebajas ${rebajasUrl}:`, e.message)
    }
    await page.waitForTimeout(DELAY_MS)
  }

  // Deduplicar por URL (antes de browser.close() para poder completar imágenes)
  const seen   = new Set()
  const unique = allProducts.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })

  // Para productos sin imagen (Elementor lazy-load sin scroll), extraer og:image de la ficha.
  const sinImagen = unique.filter(p => !p.image)
  if (sinImagen.length > 0) {
    console.log(`[tiendapadel5] Completando imagen de ficha para ${sinImagen.length} productos sin imagen…`)
    for (const p of sinImagen) {
      try {
        await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        const ogImg = await page.evaluate(() => {
          const meta = document.querySelector('meta[property="og:image"]')
          return meta ? meta.getAttribute('content') : null
        })
        if (ogImg) p.image = ogImg
      } catch (e) {
        console.error(`[tiendapadel5] No se pudo obtener imagen de ${p.url}:`, e.message)
      }
      await page.waitForTimeout(DELAY_MS)
    }
  }

  await browser.close()

  console.log(`[tiendapadel5] Total palas únicas: ${unique.length}`)

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
  resultado.codigoDescuento = codigoDescuento
  return resultado
}

module.exports = { scrape, SOURCE_KEY }
