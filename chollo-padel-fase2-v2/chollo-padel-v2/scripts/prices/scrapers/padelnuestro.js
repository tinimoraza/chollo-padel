// scripts/prices/scrapers/padelnuestro.js
// Scraper Padel Nuestro — Puppeteer + Magento 2

const puppeteer = require("puppeteer");

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
      return { title, price, url };
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

  try {
    console.log(`[padelnuestro] Abriendo ${BASE_URL} …`);
    await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60_000 });
    await page.waitForSelector("div.product-item-info", { timeout: 30_000 });

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

      await page.goto(nextUrl, { waitUntil: "networkidle2", timeout: 45_000 });
      await page.waitForSelector("div.product-item-info", { timeout: 30_000 });
      pageNum++;
    }
  } finally {
    await browser.close();
  }

  const scraped_at = new Date().toISOString();
  return allProducts.map((p) => ({
    source_key: SOURCE_KEY,
    title: p.title,
    price: p.price,
    url: p.url,
    scraped_at,
  }));
}

module.exports = { scrape, SOURCE_KEY };
