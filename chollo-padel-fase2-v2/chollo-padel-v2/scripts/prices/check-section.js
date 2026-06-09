(async () => {
  const url = 'https://padelproshop.com/collections/palas-padel?page=1&section_id=template--26596133339441__main';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }});
  const html = await res.text();

  // Ver el bloque completo del primer product-card (apertura + 600 chars)
  const start = html.indexOf('<product-card');
  console.log('--- primer <product-card> (600 chars) ---');
  console.log(html.substring(start, start + 600));

  // Contar páginas: ver si hay link rel next en la section
  const hasNext = html.includes('rel="next"') || html.includes("rel='next'");
  console.log('\nTiene link[rel=next]:', hasNext);

  // Cuántos <product-card hay
  const count = (html.match(/<product-card/g) || []).length;
  console.log('Total <product-card:', count);
})().catch(console.error);
