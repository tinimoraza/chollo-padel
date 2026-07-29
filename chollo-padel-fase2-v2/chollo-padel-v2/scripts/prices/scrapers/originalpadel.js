// scripts/prices/scrapers/originalpadel.js
// Original Padel — OpenCart (tema Journal3), Playwright
// URL categoría: https://originalpadel.com/es/palas-de-padel/
// Paginación: /es/palas-de-padel/page/N/
// Nota: la versión fetch+cheerio con ?sort=...&limit=100 recibe 403.
//       Se usa Playwright headless para evitar el bloqueo.

const SOURCE_KEY = 'originalpadel'
const BASE_URL   = 'https://originalpadel.com'
const CAT_URL    = `${BASE_URL}/es/palas-de-padel/`
const DELAY_MS   = 1200
const MAX_PAGES  = 80  // sin limit=100 habrá más páginas (~15 prod/página)

const { detectarCodigoDescuento, filtrarUrlsRebajas } = require('./_discount-utils.js')

const EXCLUIR = ['grip', 'overgrip', 'pelota', 'pelotas', 'bolsa', 'mochila',
  'paletero', 'funda', 'protector', 'muñequera', 'camiseta', 'zapatilla',
  'gafas', 'libro', 'kit ', ' kit', 'sudadera', 'pantalon', 'pantalón',
  'malla', 'mallas', 'boxer', 'boxers', 'polo ', 'chaqueta', 'gorra',
  'sombrero', 'calcetin', 'calcetín', 'calcetines', 'leggin', 'sujetador',
  'top deportivo', 'chandal', 'chándal']

function isPala(title) {
  const t = title.toLowerCase()
  if (/pack.+(x\d+|gafas|libro|camiseta)/i.test(t)) return false
  return !EXCLUIR.some(w => t.includes(w))
}

async function extractProducts(page) {
  return page.evaluate((BASE_URL) => {
    function parsePrice(text) {
      if (!text) return NaN
      const m = text.match(/([\d,.]+)/)
      if (!m) return NaN
      return parseFloat(m[1].replace(',', '.'))
    }

    const items = []
    document.querySelectorAll('div.product-layout').forEach(el => {
      const linkEl  = el.querySelector('div.name a')
      const title   = linkEl?.textContent?.trim()
      let   href    = linkEl?.getAttribute('href') || ''

      if (!title || !href || href.includes('?product_id=')) return

      if (!href.startsWith('http')) href = BASE_URL + href

      const priceNew  = parsePrice(el.querySelector('span.price-new')?.textContent)
      const priceNorm = parsePrice(el.querySelector('span.price-normal')?.textContent)
      const priceOld  = parsePrice(el.querySelector('span.price-old')?.textContent)

      const price    = !isNaN(priceNew) ? priceNew : priceNorm
      const original = (!isNaN(priceOld) && priceOld > price) ? priceOld : null

      if (isNaN(price) || price < 30) return

      const imgEl  = el.querySelector('img.img-first')
      const image  = imgEl?.getAttribute('src') || null

      items.push({ title, price, precio_original: original,
                   url: href, image: image?.startsWith('http') ? image : null })
    })
    return items
  }, BASE_URL)
}

async function scrape() {
  console.log('[originalpadel] Iniciando scraper (Playwright, OpenCart Journal3)…')

  let chromium
  try {
    ({ chromium } = require('playwright'))
  } catch {
    console.error('[originalpadel] playwright no instalado — npm install playwright')
    return []
  }

  const browser = await chromium.launch({ headless: true })
  const page    = await browser.newPage()

  await page.setExtraHTTPHeaders({
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'es-ES,es;q=0.9',
  })

  const allProducts = []
  const seen        = new Set()
  let   pageNum     = 1
  let   lastPage    = 1
  let   codigoDescuento = null
  let   rebajasUrls     = []

  try {
    while (pageNum <= MAX_PAGES) {
      const url = pageNum === 1 ? CAT_URL : `${CAT_URL}page/${pageNum}/`
      console.log(`[originalpadel] Página ${pageNum}/${lastPage}: ${url}`)

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

      // Cerrar banner de cookies (solo página 1)
      if (pageNum === 1) {
        try {
          await page.waitForSelector('.btn-cookie, .cmplz-accept, [data-cky-tag="accept-button"], #cookieClose', { timeout: 4000 })
          await page.click('.btn-cookie, .cmplz-accept, [data-cky-tag="accept-button"], #cookieClose')
          await page.waitForTimeout(600)
        } catch { /* sin banner */ }

        // Detectar total de páginas desde paginación
        lastPage = await page.evaluate(() => {
          let max = 1
          document.querySelectorAll('.pagination a').forEach(a => {
            const m = (a.getAttribute('href') || '').match(/\/page\/(\d+)\//)
            if (m) { const n = parseInt(m[1]); if (n > max) max = n }
          })
          // También desde texto "X Páginas"
          const txt = document.querySelector('.pagination-results')?.textContent || ''
          const mp  = txt.match(/\((\d+)\s+P[áa]ginas?\)/)
          if (mp) { const n = parseInt(mp[1]); if (n > max) max = n }
          return max
        })
        console.log(`[originalpadel] Total páginas detectadas: ${lastPage}`)

        const bodyText = await page.evaluate(() => document.body.innerText)
        codigoDescuento = detectarCodigoDescuento(bodyText)
        if (codigoDescuento) {
          console.log(`[originalpadel] código detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`)
        }

        const hrefs = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]')).map(a => a.href)
        )
        rebajasUrls = filtrarUrlsRebajas(hrefs, CAT_URL)
        if (rebajasUrls.length > 0) {
          console.log(`[originalpadel] sección(es) de rebajas: ${rebajasUrls.join(', ')}`)
        }
      }

      // Esperar a que carguen las cards
      try {
        await page.waitForSelector('div.product-layout', { timeout: 15000 })
      } catch {
        console.log(`[originalpadel] Sin productos en página ${pageNum} — fin`)
        break
      }

      const items = await extractProducts(page)
      let added = 0
      for (const item of items) {
        if (!item.url || seen.has(item.url)) continue
        if (!isPala(item.title)) continue
        seen.add(item.url)
        allProducts.push(item)
        added++
      }
      console.log(`[originalpadel]  → ${added} palas nuevas (total: ${allProducts.length})`)

      if (pageNum >= lastPage) break
      pageNum++
      await page.waitForTimeout(DELAY_MS)
    }
  } catch (err) {
    console.error('[originalpadel] Error:', err.message)
  }

  // Secciones de rebajas
  for (const rebajasUrl of rebajasUrls) {
    try {
      await page.goto(rebajasUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForSelector('div.product-layout', { timeout: 10000 })
      const items = await extractProducts(page)
      let added = 0
      for (const item of items) {
        if (!item.url || seen.has(item.url)) continue
        if (!isPala(item.title)) continue
        seen.add(item.url)
        allProducts.push(item)
        added++
      }
      console.log(`[originalpadel] sección rebajas ${rebajasUrl} → ${added} productos nuevos`)
    } catch (e) {
      console.error(`[originalpadel] Error rebajas ${rebajasUrl}:`, e.message)
    }
    await page.waitForTimeout(DELAY_MS)
  }

  await browser.close()

  console.log(`[originalpadel] Total palas: ${allProducts.length}`)

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
