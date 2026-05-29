const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });

  // Probar página 3
  await page.goto('https://padelproshop.com/collections/palas-padel?page=3', { waitUntil: 'load', timeout: 40000 });
  await page.waitForTimeout(4000);

  const info = await page.evaluate(() => {
    const cards = document.querySelectorAll('product-card[data-hover-title]').length;
    const lastPage = document.querySelector('link[rel="next"]');
    const allText = document.title;
    return { cards, hasNext: !!lastPage, title: allText, bodyLength: document.body.innerHTML.length };
  });

  console.log('Página 3:', JSON.stringify(info, null, 2));

  // Probar página 4
  await page.goto('https://padelproshop.com/collections/palas-padel?page=4', { waitUntil: 'load', timeout: 40000 });
  await page.waitForTimeout(4000);

  const info4 = await page.evaluate(() => {
    const cards = document.querySelectorAll('product-card[data-hover-title]').length;
    return { cards, title: document.title };
  });

  console.log('Página 4:', JSON.stringify(info4, null, 2));
  await browser.close();
})().catch(console.error);
