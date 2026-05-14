require('dotenv').config({ path: '.env.local' });
const axios = require('axios');

// Probamos la API interna que usan muchas tiendas Magento/PrestaShop
const urls = [
  'https://www.padelnuestro.com/api/products?category=palas-padel',
  'https://www.padelnuestro.com/es/search?q=pala&ajax=true',
  'https://www.padelnuestro.com/palas-padel?ajax=1',
  'https://www.padelnuestro.com/module/amfeaturedproduct/ajaxfeatured',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/plain, */*',
  'X-Requested-With': 'XMLHttpRequest',
};

(async () => {
  for (const url of urls) {
    try {
      const r = await axios.get(url, { headers: HEADERS, timeout: 8000 });
      console.log(`✅ ${url} → ${r.status} → ${JSON.stringify(r.data).substring(0, 200)}`);
    } catch (e) {
      console.log(`❌ ${url} → ${e.response?.status || e.message}`);
    }
  }
})();