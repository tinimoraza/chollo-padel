// Cuenta productos únicos de ES en padelproshop (los 2 sitemaps sin prefijo de idioma)
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const sitemaps = [
    'https://padelproshop.com/sitemap_products_1.xml?from=8516896129329&to=10552480629041',
    'https://padelproshop.com/sitemap_products_2.xml?from=10552489836849&to=10682599833905',
  ];

  const allUrls = new Set();

  for (const sm of sitemaps) {
    await page.goto(sm, { waitUntil: 'load', timeout: 30000 });
    const urls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('loc')).map(l => l.textContent.trim())
    );
    urls.forEach(u => { if (u.includes('/products/')) allUrls.add(u) });
    console.log(`${sm.split('/').pop().split('?')[0]}: ${urls.filter(u=>u.includes('/products/')).length} productos`);
  }

  const palas = [...allUrls].filter(u => u.match(/pala|raqueta/i));
  console.log(`\nTotal productos únicos ES: ${allUrls.size}`);
  console.log(`URLs con "pala" o "raqueta": ${palas.length}`);
  console.log('\nPrimeros 20 con "pala":');
  palas.slice(0,20).forEach(u => console.log(' ', u));

  await browser.close();
})().catch(console.error);
