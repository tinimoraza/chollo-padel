const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://romasport.es/categoria-producto/padel/padel-palas/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  try { await page.click('[data-cky-tag="accept-button"]', { timeout: 3000 }); } catch(e) {}
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const count = document.querySelectorAll('li.product, .type-product, article.product').length;
    const pagination = document.querySelector('.woocommerce-pagination, .next.page-numbers, a.next');
    const nav = document.querySelector('nav.woocommerce-pagination');
    return { count, pagination: pagination ? pagination.outerHTML.substring(0,300) : null, nav: nav ? nav.outerHTML.substring(0,300) : null };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})().catch(console.error);
