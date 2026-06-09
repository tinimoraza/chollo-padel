const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' });

  for (const p of [1, 2, 3, 4]) {
    await page.goto(`https://padelproshop.com/collections/palas-padel?page=${p}`, { waitUntil: 'domcontentloaded', timeout: 40000 });
    try {
      await page.waitForSelector('product-card[data-hover-title]', { timeout: 8000 });
      await page.waitForTimeout(3000);
    } catch(e) { console.log(`Página ${p}: 0 cards`); continue; }

    const info = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('product-card[data-hover-title]'));
      const first3 = cards.slice(0,3).map(c => {
        const link = c.querySelector('a[href*="/products/"]');
        const href = link?.getAttribute('href');
        const text = c.innerText;
        const prices = text.match(/\d+[,.]?\d*\s*€/g);
        return { title: c.getAttribute('data-hover-title'), href, prices };
      });
      return { count: cards.length, first3 };
    });
    console.log(`Página ${p}: ${info.count} cards`);
    console.log('  Primeras 3:', JSON.stringify(info.first3, null, 2));
  }

  await browser.close();
})().catch(console.error);
