// scripts/prices/scrapers/_shopify-utils.js
//
// Fix root-cause 2026-06-24 (futurapadelshop): el listado de colección de
// Shopify (/collections/X/products.json) puede servir precios cacheados y
// desactualizados durante horas. Inicialmente se asumió que la ficha
// individual del producto (/products/<handle>.json) siempre refleja el
// precio real vigente — pero esto resultó ser falso: confirmado con datos
// reales que la ficha individual TAMBIÉN se sirve desde caché de CDN
// (un scrape posterior al cambio real de precio en Shopify siguió leyendo
// el valor viejo desde la ficha individual).
//
// Fix root-cause 2026-06-24 (v2): se añade un parámetro anti-caché
// (`_=timestamp`) a la URL + cabecera `Cache-Control: no-cache` para forzar
// a la CDN a tratar cada petición como única y no servir una respuesta cacheada.
//
// Esta función re-pide cada ficha y corrige el precio (y precio_original,
// y disponibilidad real) en el array de productos ya recolectados.

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function refreshShopifyPrices(products, { delayMs = 300, headers, minPrice = 30 } = {}) {
  let corregidos = 0
  let fallidos = 0

  for (const p of products) {
    try {
      const bustUrl = `${p.url}.json?_=${Date.now()}`
      const res = await fetch(bustUrl, {
        headers: headers ?? {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
        cache: 'no-store',
      })

      if (res.ok) {
        const data = await res.json()
        const variant = data.product?.variants?.[0]
        if (variant) {
          const freshPrice   = parseFloat(variant.price)
          const freshCompare = parseFloat(variant.compare_at_price)
          if (!isNaN(freshPrice) && freshPrice >= minPrice) {
            if (freshPrice !== p.price) corregidos++
            p.price = freshPrice
            p.precio_original = (!isNaN(freshCompare) && freshCompare > freshPrice) ? freshCompare : null
          }
          // Disponibilidad real de Shopify (variante o, si falta, producto).
          if (typeof variant.available === 'boolean') {
            p.disponible = variant.available
          } else if (typeof data.product?.available === 'boolean') {
            p.disponible = data.product.available
          }
        }
      } else {
        fallidos++
      }
    } catch {
      // Si falla la petición individual, nos quedamos con el precio del
      // listado (mejor un dato posiblemente viejo que ningún dato).
      fallidos++
    }

    await sleep(delayMs)
  }

  console.log(`  → refreshShopifyPrices: ${corregidos} precios corregidos vs listado, ${fallidos} fichas no accesibles (de ${products.length})`)
  return products
}

module.exports = { refreshShopifyPrices }
