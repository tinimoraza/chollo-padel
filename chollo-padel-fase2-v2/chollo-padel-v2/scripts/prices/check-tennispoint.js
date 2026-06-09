(async () => {
  const res = await fetch('https://www.tennis-point.es/collections/padel/products.json?limit=250', {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
  });
  const data = await res.json();
  const products = data.products ?? [];

  // Ver tipos únicos de producto
  const tipos = [...new Set(products.map(p => p.product_type))];
  console.log('Product types:', tipos);

  // Ver primeras palas (títulos con "pala" o "raqueta")
  const palas = products.filter(p => /pala|racket|raqueta/i.test(p.title) || /pala|racket/i.test(p.product_type));
  console.log(`\nProductos con "pala/racket": ${palas.length}/${products.length}`);
  palas.slice(0,5).forEach(p => console.log(' ', p.product_type, '|', p.title));
})().catch(console.error);
