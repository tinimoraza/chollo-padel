// scripts/prices/scrapers/padelnuestro.js
// Scraper Padel Nuestro — Puppeteer + Magento 2

const puppeteer = require("puppeteer");
const { detectarCodigoDescuento } = require("./_discount-utils.js");

const BASE_URL = "https://www.padelnuestro.com/palas-padel";
const SOURCE_KEY = "padelnuestro";

async function extractProducts(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("div.product-item-info"));
    return cards.map((card) => {
      const linkEl = card.querySelector("a.product-item-link");
      const title = linkEl ? linkEl.textContent.trim() : null;
      const url = linkEl ? linkEl.href : null;
      const priceEl = card.querySelector('[data-price-type="finalPrice"]');
      const price = priceEl
        ? parseFloat(priceEl.getAttribute("data-price-amount"))
        : null;
      const imgEl = card.querySelector("img.product-image-photo, img");
      // La web usa lazy-load: "src" empieza siendo un placeholder base64 (1x1 px
      // transparente) y la URL real vive en "data-src" hasta que el navegador la
      // copia a "src" al entrar en pantalla. Preferimos data-src; si no existe,
      // usamos src pero descartando cualquier "data:" (placeholder, nunca foto real).
      const rawImg = imgEl ? (imgEl.getAttribute("data-src") || imgEl.getAttribute("src") || "") : "";
      const image = rawImg.startsWith("data:") ? null : (rawImg.split("?")[0] || null);
      return { title, price, url, image };
    }).filter((p) => p.title && p.price && !isNaN(p.price));
  });
}

async function getNextPageUrl(page, currentPageNum) {
  return page.evaluate((currentPageNum) => {
    const nextBtn = document.querySelector("a.action.next");
    if (!nextBtn) return null;
    const href = nextBtn.href;
    if (!href) return null;
    // Verificar que el href apunta a una página mayor a la actual
    const match = href.match(/[?&]p=(\d+)/);
    if (!match) return null;
    const nextPageNum = parseInt(match[1]);
    if (nextPageNum <= currentPageNum) return null; // anti-loop
    return href;
  }, currentPageNum);
}

async function scrape() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );

  const allProducts = [];
  let pageNum = 1;
  let codigoDescuento = null;

  try {
    console.log(`[padelnuestro] Abriendo ${BASE_URL} …`);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("div.product-item-info", { timeout: 30_000 });

    const bodyText = await page.evaluate(() => document.body.innerText);
    codigoDescuento = detectarCodigoDescuento(bodyText);
    if (codigoDescuento) {
      console.log(`[padelnuestro] codigo detectado: ${codigoDescuento.codigo} (-${codigoDescuento.descuento_pct}%)`);
    }

    while (true) {
      console.log(`[padelnuestro] Extrayendo página ${pageNum} …`);
      const products = await extractProducts(page);
      console.log(`[padelnuestro] → ${products.length} productos`);
      allProducts.push(...products);

      const nextUrl = await getNextPageUrl(page, pageNum);
      if (!nextUrl) {
        console.log(`[padelnuestro] Última página (${pageNum}). Total: ${allProducts.length} productos.`);
        break;
      }

      await page.goto(nextUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      try {
        await page.waitForSelector("div.product-item-info", { timeout: 30_000 });
      } catch (err) {
        // La página devolvió 200 pero sin tarjetas de producto (fin real del
        // catálogo, bloqueo puntual o página vacía). No tiramos todo el scrape
        // por una sola página fallida: cerramos la paginación con lo acumulado.
        console.log(`[padelnuestro] Página ${pageNum + 1} sin productos (timeout esperando selector). Detengo paginación. Total: ${allProducts.length} productos.`);
        break;
      }
      pageNum++;
    }
  } finally {
    await browser.close();
  }

  const scraped_at = new Date().toISOString();
  const resultado = allProducts.map((p) => ({
    source_key: SOURCE_KEY,
    title: p.title,
    price: p.price,
    url: p.url,
    image: p.image ?? null,
    scraped_at,
  }));
  resultado.codigoDescuento = codigoDescuento;
  return resultado;
}

module.exports = { scrape, SOURCE_KEY };
