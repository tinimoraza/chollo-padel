// Diagnóstico: cuántas páginas y productos tiene padelproshop
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  let totalURLs = new Set();

  for (let p = 1; p <= 15; p++) {
    const url = `https://padelproshop.com/collections/palas-padel?page=${p}`;
    await page.goto(url, { waitUntil: 'load', timeout: 40000 });
    await page.waitForTimeout(5000);

    const info = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('product-card[data-hover-title]'));
      const urls = cards.map(c => {
        const a = c.querySelector('a[href*="/products/"]');
        return a ? a.getAttribute('href').split('?')[0] : null;
      }).filter(Boolean);
      return { count: cards.length, urls };
    });

    const newURLs = info.urls.filter(u => !totalURLs.has(u));
    info.urls.forEach(u => totalURLs.add(u));

    console.log(`Página ${p}: ${info.count} cards, ${newURLs.length} nuevas (total acum: ${totalURLs.size})`);

    if (info.count === 0 || newURLs.length === 0) {
      console.log('→ Fin de páginas nuevas');
      break;
    }
  }

  console.log(`\nTOTAL productos únicos: ${totalURLs.size}`);
  await browser.close();
})().catch(console.error);
