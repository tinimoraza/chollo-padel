const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  await page.goto('https://padelcoronado.com/categoria-producto/palas-padel/', {
    waitUntil: 'networkidle', timeout: 45000
  }).catch(() => {});
  await page.waitForTimeout(4000);

  const result = await page.evaluate(() => {
    // Buscar cualquier cosa relacionada con paginación
    const candidates = [
      'a.next',
      '.next',
      'a[aria-label*="siguiente"]',
      'a[aria-label*="Next"]',
      '.woocommerce-pagination',
      '.elementor-pagination',
      'nav.woocommerce-pagination',
      '.page-numbers',
      'a.page-numbers',
    ];

    const found = candidates.map(sel => ({
      selector: sel,
      exists: !!document.querySelector(sel),
      html: document.querySelector(sel)?.outerHTML?.substring(0, 200) ?? null
    }));

    // También volcar todo el HTML de paginación si existe
    const paginationArea = document.querySelector('[class*="pagination"], [class*="page-numbers"], nav[role="navigation"]');

    return {
      found,
      paginationHTML: paginationArea?.outerHTML?.substring(0, 1000) ?? 'NO ENCONTRADO',
      totalProducts: document.querySelectorAll('.e-loop-item, li.product').length,
    };
  });

  console.log('Productos en página 1:', result.totalProducts);
  console.log('\n--- Selectores de paginación ---');
  result.found.forEach(f => {
    if (f.exists) console.log(`✅ ${f.selector}\n   ${f.html}`);
    else console.log(`❌ ${f.selector}`);
  });
  console.log('\n--- HTML zona paginación ---');
  console.log(result.paginationHTML);

  await browser.close();
})();
