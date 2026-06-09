// Cuenta cuántos productos /products/ hay en padelproshop via sitemap
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Obtener sitemap principal
  await page.goto('https://padelproshop.com/sitemap.xml', { waitUntil: 'load', timeout: 30000 });
  const sitemapLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('loc')).map(l => l.textContent);
  });
  console.log('Sitemaps encontrados:', sitemapLinks);

  // Buscar sitemap de productos
  const productSitemap = sitemapLinks.find(u => u.includes('products'));
  if (!productSitemap) { console.log('No hay sitemap de productos'); await browser.close(); return; }

  await page.goto(productSitemap, { waitUntil: 'load', timeout: 30000 });
  const productUrls = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('loc')).map(l => l.textContent);
  });

  const palas = productUrls.filter(u =>
    u.includes('pala') || u.includes('raqueta') || u.includes('padel')
  );

  console.log(`\nTotal productos en sitemap: ${productUrls.length}`);
  console.log(`Productos con "pala/raqueta/padel" en URL: ${palas.length}`);
  console.log('\nPrimeros 10:', palas.slice(0,10));

  await browser.close();
})().catch(console.error);
