// Scraper temporal de un solo uso para verificar, sin acceso a internet, si el
// fix de decodeHtmlEntities() en pipeline-tiendas.ts resuelve los "sin match"
// reales del run real de padelstyle (log pipeline_run_20260618_110433.json).
// Se borra después de la verificación.

const TITULOS_SIN_MATCH = [
  "Pala Adidas Cross It Pro EDT &#8211; Martita Ortega 2026",
  "Pala Adidas Metalbone 2026 &#8211; Ale Galán",
  "Pala Bullpadel XPLO 2026 &#8211; Martín Di Nenno",
  "Pala Bullpadel Neuron 02 2026 &#8211; Fede Chingotto",
  "Pala Bullpadel Elite 2026 &#8211; Gemma Triay",
  "Pala Bullpadel Pearl 2026 &#8211; Bea González",
  "Pala Bullpadel Vertex 05 Woman 2026 &#8211; Delfi Brea",
  "Pala Black Crown Iconic Crown 2026",
  "Pala Bullpadel Xplo Geo 2026 &#8211; Premier Padel",
  "Pala Bullpadel Vertex 05 Geo 2026 &#8211; Premier Padel",
  "Pala Bullpadel Vertex 05 Light 2026 &#8211; Premier Padel",
  "Pala Adidas Cross It Carbon 2026 &#8211; Maxi Arce",
  "Pala Adidas Arrow Hit Carbon Control 2026",
  "Pala Adidas Cross It Carbon Control 2026",
  "Pala NOX AT10 Genius Attack 18K Alum 2026",
  "Pala NOX Nextgen Pro Hybrid 12K NFA Series 2026",
  "Pala Bullpadel Icon 2026 &#8211; Juan Martin Diaz",
  "Pala HEAD Extreme Pro 2026",
  "Pala Adidas Cross It Carbon 2025 &#8211; Maxi Arce",
  "Pala Vibora King Cobra Xtreme 2025",
  "Pala Wilson Bela Pro V2.5 2025",
  "Pala Adidas Cross It Carbon Control 3.4 2025",
  "Pala StarVie Kenta Ultra Speed Soft",
  "Pala StarVie Aquila Soft 2024",
  "Pala StarVie Aquila Ultra Speed Soft 2024",
  "Pala StarVie Titania Soft 2024",
  "Pala StarVie Titania Ultra Speed Soft 2024",
  "Pala Yarara Xtreme Fiber Black 2025",
  "Pala Kelme Grey Wolf",
  "Pala Kelme Shark",
  "Pala Kelme Falcon",
  "Pala SET Hyena",
  "Pala SET Coyote",
  "Pala Dunlop Galactica Pro &#8211; Juani Mieres",
]

async function scrape() {
  const scraped_at = new Date().toISOString()
  return TITULOS_SIN_MATCH.map((title, i) => ({
    source_key: '__test_padelstyle',
    title,
    price: 99.99,
    precio_original: null,
    url: `https://test.local/producto-${i}`,
    image: null,
    scraped_at,
  }))
}

module.exports = { scrape, SOURCE_KEY: '__test_padelstyle' }
