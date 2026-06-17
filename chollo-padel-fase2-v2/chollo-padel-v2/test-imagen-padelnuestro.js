// Verificación aislada: comprueba que el extractor de imagen corregido coge la
// URL real (data-src) en vez del placeholder base64 (src), sin tocar la BD.
const puppeteer = require("puppeteer");

const BASE_URL = "https://www.padelnuestro.com/palas-padel";

async function extractProducts(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("div.product-item-info"));
    return cards.map((card) => {
      const linkEl = card.querySelector("a.product-item-link");
      const title = linkEl ? linkEl.textContent.trim() : null;
      const imgEl = card.querySelector("img.product-image-photo, img");
      const rawSrc = imgEl ? (imgEl.getAttribute("src") || "") : "";
      const rawDataSrc = imgEl ? (imgEl.getAttribute("data-src") || "") : "";
      // misma lógica que el fix aplicado en padelnuestro.js
      const rawImg = rawDataSrc || rawSrc;
      const image = rawImg.startsWith("data:") ? null : (rawImg.split("?")[0] || null);
      return {
        title,
        src_es_placeholder: rawSrc.startsWith("data:"),
        data_src_presente: !!rawDataSrc,
        image_final: image,
      };
    }).filter(p => p.title);
  });
}

(async () => {
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36");
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 90000 });
  await new Promise(r => setTimeout(r, 2000));

  const productos = await extractProducts(page);
  console.log(`Total productos detectados: ${productos.length}\n`);

  let conPlaceholder = 0, conImagenReal = 0, sinDataSrc = 0;
  for (const p of productos.slice(0, 12)) {
    console.log(`- ${p.title}`);
    console.log(`    src era placeholder: ${p.src_es_placeholder} | data-src presente: ${p.data_src_presente}`);
    console.log(`    => imagen final: ${p.image_final}`);
  }
  for (const p of productos) {
    if (p.src_es_placeholder) conPlaceholder++;
    if (p.image_final && p.image_final.startsWith("http")) conImagenReal++;
    if (!p.data_src_presente) sinDataSrc++;
  }
  console.log(`\nResumen sobre ${productos.length} productos:`);
  console.log(`  src era placeholder base64 en: ${conPlaceholder}`);
  console.log(`  sin data-src disponible: ${sinDataSrc}`);
  console.log(`  imagen final válida (http...): ${conImagenReal}`);

  await browser.close();
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
