// scripts/prices/pipeline.js
// v4 (2026-05-25):
//   - insertSnapshot: .maybeSingle() → .limit(1) para evitar error PGRST116 cuando ya hay >1 duplicado
// v3 (2026-05-25):
//   - recalculatePriceReference: ventana 24h → 30 días (palas sin snapshot diario perdían precio_referencia)
//   - runPipeline: filtrar productos cuyo título contiene "pack" antes de matching
// v2 (2026-05-25):
//   - insertSnapshot: check anti-duplicado por pala_id+source_id+url_producto+día
//   - recalculatePriceReference: dedup por url_producto antes de promediar (evita inflado por duplicados Roma Sport)
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');
const { fuzzyMatch, normalize, extractBrand } = require('./fuzzy-matcher');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function getSource(slug) {
  const { data, error } = await supabase
    .from('price_sources')
    .select('id, nombre')
    .eq('slug', slug)
    .single();
  if (error) throw new Error(`Source no encontrado: ${slug}`);
  return data;
}

async function getFromCache(sourceId, productUrl) {
  const { data } = await supabase
    .from('price_match_cache')
    .select('pala_id, match_method, confidence')
    .eq('source_id', sourceId)
    .eq('producto_url', productUrl)
    .single();
  return data || null;
}

async function saveToCache(sourceId, productUrl, productTitle, matchResult) {
  await supabase.from('price_match_cache').upsert({
    source_id: sourceId,
    producto_url: productUrl,
    producto_titulo: productTitle,
    pala_id: matchResult.pala_id || null,
    match_method: matchResult.method,
    confidence: matchResult.confidence,
  }, { onConflict: 'source_id,producto_url' });
}

async function insertSnapshot(palaId, sourceId, product, confidence) {
  // Comprobar si ya existe un snapshot de esta URL+source de hoy para no duplicar
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const { data: existing } = await supabase
    .from('price_snapshots')
    .select('id')
    .eq('pala_id', palaId)
    .eq('source_id', sourceId)
    .eq('url_producto', product.url_producto)
    .gte('scraped_at', today)
    .limit(1);

  if (existing && existing.length > 0) return true; // Ya existe hoy, no duplicar

  const { error } = await supabase.from('price_snapshots').insert({
    pala_id: palaId,
    source_id: sourceId,
    precio: product.precio,
    precio_original: product.precio_original || null,
    url_producto: product.url_producto,
    match_confidence: confidence,
    disponible: true,
  });
  if (error) console.error('[pipeline] Error insertando snapshot:', error.message);
  return !error;
}

// Detecta marcas conocidas del catálogo (se cachea igual que fuzzyMatch)
let _knownBrandsCache = null;
async function getKnownBrands() {
  if (_knownBrandsCache) return _knownBrandsCache;
  const { data } = await supabase.from('palas').select('marca');
  _knownBrandsCache = [...new Set((data || []).map(p => p.marca))];
  return _knownBrandsCache;
}

// Guarda o actualiza una pala candidata (vista en tiendas pero no en catálogo)
async function upsertCandidata(title, sourceSlug, precio, url) {
  const tituloNorm = normalize(title);
  const knownBrands = await getKnownBrands();
  const marcaDetectada = extractBrand(title, knownBrands);

  // Buscar si ya existe por titulo_normalizado
  const { data: existing } = await supabase
    .from('palas_candidatas')
    .select('id, fuentes, urls, precio_min, precio_max, veces_visto')
    .eq('titulo_normalizado', tituloNorm)
    .single();

  if (existing) {
    // Actualizar acumulando fuentes, urls y precios
    const fuentes = existing.fuentes.includes(sourceSlug)
      ? existing.fuentes
      : [...existing.fuentes, sourceSlug];
    const urls = existing.urls.includes(url)
      ? existing.urls
      : [...existing.urls, url];

    await supabase.from('palas_candidatas').update({
      fuentes,
      urls,
      precio_min: Math.min(existing.precio_min ?? precio, precio),
      precio_max: Math.max(existing.precio_max ?? precio, precio),
      veces_visto: existing.veces_visto + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id);
  } else {
    // Insertar nueva candidata
    await supabase.from('palas_candidatas').insert({
      titulo: title,
      titulo_normalizado: tituloNorm,
      marca_detectada: marcaDetectada,
      fuentes: [sourceSlug],
      urls: [url],
      precio_min: precio,
      precio_max: precio,
      veces_visto: 1,
    });
    console.log(`[candidatas] Nueva pala candidata: "${title}" (marca: ${marcaDetectada || 'desconocida'})`);
  }
}

async function recalculatePriceReference(palaIds) {
  if (!palaIds.length) return;
  console.log(`[pipeline] Recalculando precio_referencia para ${palaIds.length} palas...`);

  for (const palaId of palaIds) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 días
    const { data: snaps } = await supabase
      .from('price_snapshots')
      .select('precio, source_id, url_producto')
      .eq('pala_id', palaId)
      .eq('disponible', true)
      .gte('scraped_at', since);

    if (!snaps || snaps.length === 0) continue;

    // Deduplicar por url_producto — quedarse con el precio más bajo por URL
    // para que duplicados del mismo producto no inflen la media
    const byUrl = new Map();
    for (const s of snaps) {
      const key = s.url_producto;
      if (!byUrl.has(key) || s.precio < byUrl.get(key).precio) {
        byUrl.set(key, s);
      }
    }
    const unique = [...byUrl.values()];

    const precios = unique.map(s => s.precio);
    const precio_minimo = Math.min(...precios);
    const precio_maximo = Math.max(...precios);
    const precio_referencia = parseFloat(
      (precios.reduce((a, b) => a + b, 0) / precios.length).toFixed(2)
    );
    const fuentes_count = new Set(unique.map(s => s.source_id)).size;

    await supabase.from('price_reference').upsert({
      pala_id: palaId,
      precio_referencia,
      precio_minimo,
      precio_maximo,
      fuentes_count,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'pala_id' });

    await supabase.from('palas').update({
      precio_referencia,
      precio_minimo_tiendas: precio_minimo,
      precios_updated_at: new Date().toISOString(),
    }).eq('id', palaId);
  }

  console.log(`[pipeline] Recálculo completado.`);
}

async function runPipeline(sourceSlug) {
  console.log(`\n===== PIPELINE: ${sourceSlug} =====`);
  const startedAt = new Date().toISOString();

  const source = await getSource(sourceSlug);
  const scraper = require(`./scrapers/${sourceSlug}`);

  let productos_scrapeados = 0;
  let matches_encontrados = 0;
  let inserts_realizados = 0;
  let candidatas_nuevas = 0;
  let errores = 0;
  const updatedPalaIds = new Set();

  let products;
  try {
    products = await scraper.scrape();
    productos_scrapeados = products.length;
  } catch (err) {
    console.error(`[pipeline] Error en scraper ${sourceSlug}:`, err.message);
    await supabase.from('scraper_logs').insert({
      source_id: source.id,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: 'error',
      errores: 1,
    });
    return;
  }

  for (const product of products) {
    const p = {
      precio:          product.price          ?? product.precio          ?? null,
      precio_original: product.precio_original                           ?? null,
      url_producto:    product.url            ?? product.url_producto    ?? null,
      title:           product.title,
    };

    // Filtrar packs (pack = bundle de varios productos, no una pala sola)
    if (/\bpack\b/i.test(p.title)) {
      console.log(`[pipeline] Descartando pack: "${p.title}"`);
      continue;
    }

    try {
      let match = await getFromCache(source.id, p.url_producto);

      if (!match) {
        match = await fuzzyMatch(p.title);
        await saveToCache(source.id, p.url_producto, p.title, match);
      }

      if (match?.pala_id) {
        matches_encontrados++;
        const inserted = await insertSnapshot(match.pala_id, source.id, p, match.confidence);
        if (inserted) {
          inserts_realizados++;
          updatedPalaIds.add(match.pala_id);
        }
      } else {
        // Sin match → guardar como candidata para auto-promoción futura
        await upsertCandidata(p.title, sourceSlug, p.precio, p.url_producto);
        candidatas_nuevas++;
      }

    } catch (err) {
      console.error(`[pipeline] Error procesando "${p.title}":`, err.message);
      errores++;
    }
  }

  await recalculatePriceReference([...updatedPalaIds]);

  await supabase.from('price_sources')
    .update({ last_scraped_at: new Date().toISOString() })
    .eq('id', source.id);

  await supabase.from('scraper_logs').insert({
    source_id: source.id,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    productos_scrapeados,
    matches_encontrados,
    inserts_realizados,
    errores,
    status: errores > 0 && inserts_realizados === 0 ? 'error' : errores > 0 ? 'partial' : 'success',
  });

  console.log(`\n[pipeline] ✅ ${sourceSlug} completado:`);
  console.log(`   Scrapeados:  ${productos_scrapeados}`);
  console.log(`   Matches:     ${matches_encontrados}`);
  console.log(`   Insertados:  ${inserts_realizados}`);
  console.log(`   Candidatas:  ${candidatas_nuevas}`);
  console.log(`   Errores:     ${errores}`);
}

const slug = process.argv[2];
if (!slug) {
  console.error('Uso: node scripts/prices/pipeline.js <store-slug>');
  process.exit(1);
}

runPipeline(slug).catch(err => {
  console.error('[pipeline] Error fatal:', err);
  process.exit(1);
});
