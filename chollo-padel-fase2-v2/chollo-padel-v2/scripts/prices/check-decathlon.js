(async () => {
  // Probar sitemap y feeds alternativos de Decathlon
  const urls = [
    'https://www.decathlon.es/sitemap.xml',
    'https://www.decathlon.es/sitemap_index.xml',
    'https://www.decathlon.es/feed.xml',
    // Feed de Google Shopping / comparadores (suelen estar abiertos)
    'https://www.decathlon.es/catalog_product.xml',
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }
      });
      console.log(`${res.status} | ${url}`);
      if (res.ok) {
        const text = await res.text();
        console.log('  Preview:', text.substring(0, 300));
      }
    } catch(e) {
      console.log(`ERR | ${url} | ${e.message}`);
    }
  }
})().catch(console.error);
