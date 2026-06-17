// scripts/prices/scrapers/padelzoom.js
// Scraper PadelZoom — FacetWP API (788 palas, 40 páginas de 20)
//
// PadelZoom usa FacetWP para paginar. El HTML estático solo muestra
// la primera página (20 palas). Para obtener todo el catálogo hay que
// llamar a la API POST con paged=1..N y parsear el campo `template`
// de cada respuesta con Cheerio (mismos selectores que el HTML estático).
//
// Campos extraídos:
//   title  — nombre de la pala (ej: "Bullpadel Vertex 05 2026 Juan Tello")
//   price  — precio mínimo de mercado (Precio_mas_bajo)
//   url    — URL de la pala en padelzoom.es
//
// Uso standalone: node scripts/prices/scrapers/padelzoom.js
// Uso pipeline:   node scripts/prices/pipeline.js padelzoom

const https = require('https');

const FACETWP_URL = 'https://padelzoom.es/wp-json/facetwp/v1/refresh';
const SOURCE_KEY  = 'padelzoom';
const PER_PAGE    = 20;
const DELAY_MS    = 800; // cortesía entre páginas

let cheerio;
try {
  cheerio = require('cheerio');
} catch {
  console.error('[padelzoom] ERROR: cheerio no instalado. Ejecuta: npm install cheerio');
  process.exit(1);
}

// ── HTTP POST ────────────────────────────────────────────────────────────────
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'Referer':       'https://padelzoom.es/palas/',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(new Error('JSON parse error: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20_000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Reintenta una petición FacetWP ante timeouts/errores transitorios de red.
// Sin esto, un solo timeout en la página 1 tiraba todo el script (exit 1)
// aunque las páginas 2+ ya tenían su propio try/catch individual.
async function fwpRequestRetry(page, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fwpRequest(page);
    } catch (err) {
      lastErr = err;
      console.error(`[padelzoom] Intento ${i}/${attempts} falló en página ${page}: ${err.message}`);
      if (i < attempts) await sleep(3000 * i);
    }
  }
  throw lastErr;
}

// ── Petición FacetWP para una página ────────────────────────────────────────
function fwpRequest(page) {
  return postJson(FACETWP_URL, {
    action: 'facetwp_refresh',
    data: {
      facets:         {},
      frozen_facets:  {},
      http_params: {
        uri:      'palas',
        url_vars: {},
      },
      template:     'palas',   // nombre del template en FWP_JSON
      extras:       { sort: 'default' },
      soft_refresh: 1,
      is_bfcache:   0,
      first_load:   0,
      paged:        page,
    },
  });
}

// ── Parser del HTML de cada respuesta ───────────────────────────────────────
// El campo `template` contiene el mismo HTML que el listado estático:
//   <div class="col-md-pala">
//     <a href="...">
//       <div class="text-title-price">
//         <p>Nombre pala</p>
//         ...
//         <p><span class="color-blue font-weight-600">254.90</span>€</p>
//       </div>
//     </a>
//   </div>
function parseTemplate(html) {
  const $ = cheerio.load(html);
  const products = [];

  $('div.col-md-pala').each((_, card) => {
    const $link = $(card).children('a').first();
    const url   = $link.attr('href');
    if (!url || url === '#') return;

    const $text = $link.find('div.text-title-price');
    const title = $text.find('p').first().text().trim();
    if (!title) return;

    const priceRaw = $text.find('span.color-blue').text().trim();
    const price    = parseFloat(priceRaw.replace(',', '.'));
    if (!price || isNaN(price) || price < 20 || price > 2000) return;

    products.push({ title, price, url });
  });

  return products;
}

// ── Scrape principal ─────────────────────────────────────────────────────────
async function scrape() {
  console.log('[padelzoom] Iniciando scrape via FacetWP API…');

  // Página 1: obtener total_pages (con reintentos — si esta falla, todo el job muere)
  const first = await fwpRequestRetry(1);
  const totalPages = first?.settings?.pager?.total_pages ?? 1;
  const totalRows  = first?.settings?.pager?.total_rows  ?? '?';
  console.log(`[padelzoom] Total palas: ${totalRows} — Páginas: ${totalPages}`);

  const allProducts = [];
  const seen = new Set();

  // Procesar página 1
  const page1Products = parseTemplate(first.template || '');
  console.log(`[padelzoom] Página 1/${totalPages}: ${page1Products.length} palas`);
  for (const p of page1Products) {
    if (!seen.has(p.url)) { seen.add(p.url); allProducts.push(p); }
  }

  // Páginas 2..N
  for (let page = 2; page <= totalPages; page++) {
    await sleep(DELAY_MS);
    try {
      const res      = await fwpRequestRetry(page);
      const products = parseTemplate(res.template || '');
      console.log(`[padelzoom] Página ${page}/${totalPages}: ${products.length} palas`);
      for (const p of products) {
        if (!seen.has(p.url)) { seen.add(p.url); allProducts.push(p); }
      }
      // Si la página vuelve vacía, parar
      if (products.length === 0) {
        console.log(`[padelzoom] Página vacía en ${page}, parando.`);
        break;
      }
    } catch (err) {
      console.error(`[padelzoom] Error en página ${page}: ${err.message}`);
    }
  }

  console.log(`[padelzoom] ✅ Total scrapeado: ${allProducts.length} palas`);

  const scraped_at = new Date().toISOString();
  return allProducts.map(p => ({
    source_key: SOURCE_KEY,
    title:      p.title,
    price:      p.price,
    url:        p.url,
    scraped_at,
  }));
}

module.exports = { scrape, SOURCE_KEY };

// ── Ejecución standalone ─────────────────────────────────────────────────────
if (require.main === module) {
  scrape()
    .then(products => {
      console.log(`\nPrimeras 20 palas:`);
      products.slice(0, 20).forEach(p => console.log(`  [${p.price}€] ${p.title}`));
      console.log(`\nÚltimas 5 palas:`);
      products.slice(-5).forEach(p => console.log(`  [${p.price}€] ${p.title}`));
    })
    .catch(err => {
      console.error('[padelzoom] Error fatal:', err.message);
      process.exit(1);
    });
}
