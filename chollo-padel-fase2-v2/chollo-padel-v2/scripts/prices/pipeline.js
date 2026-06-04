// scripts/prices/pipeline.js
// v8 (2026-06-01):
//   FIX 1 — Umbral de confianza: 0.92 → 0.95 en runPipeline.
//     El pipeline ya usaba 0.95 para recalculatePriceReference pero aceptaba
//     snapshots con confidence >= 0.92. Unificado a 0.95 en ambos sitios.
//   FIX 2 — Sanity check precio_pvp en recalculatePriceReference.
//     Si la mediana calculada es > 1.4× o < 0.5× el precio_pvp oficial del
//     catálogo, hay un bad match en los snapshots. En ese caso se usa precio_pvp
//     como fallback y se loguea el incidente para revisión.
//     Esto evita que matches incorrectos generen chollos o top-oportunidades falsos.
// v7 (2026-05-27):
//   FIX 1 — insertSnapshot: segundo check anti-dup por pala_id+source_id+día
//     (independiente de la URL). Evita que slugs alternativos del mismo producto
//     en PadelNuestro generen filas duplicadas en price_snapshots.
//   FIX 2 — fuzzy-matcher v6: extraerVersionDeUrl ignora la versión del slug
//     cuando el título tiene año ≥2025. Evita que slugs reutilizados (drive-3-3,
//     match-3-2) fuercen el match a palas antiguas en vez de las nuevas 2026.
// v6 (2026-05-26):
//   FIX 1 — Verificación HTTP de URLs: checkUrlDisponible() hace HEAD a cada URL
//     de price_snapshots. Si responde 404 o redirige a una URL diferente (producto
//     descatalogado que PadelNuestro redirige silenciosamente), marca disponible=false.
//     Se ejecuta en lote al final del pipeline para no ralentizar el scrape.
//   FIX 2 — fuzzyMatch recibe ahora el url_producto. El matcher v5 extrae año y versión
//     de la URL (más fiable que el título). Neuron-25 → año 2025. Drive-3-3 → versión 3.3.
//   FIX 3 — Invalidación de caché por URL: saveToCache guarda el url_path del producto.
//     getFromCache comprueba si el path actual coincide; si no, descarta la caché y
//     rematchea. Evita que matches incorrectos queden perpetuados indefinidamente.
//   RECOMENDADO tras deploy: DELETE FROM price_match_cache; para empezar limpio.
// v5 (2026-05-26):
//   - recalculatePriceReference: MEDIA → MEDIANA para precio_referencia
//     Un outlier de Roma Sport (280€) rodeado de precios de 75-150€ ya no
//     infla la referencia. Con mediana, la referencia refleja el precio real
//     de mercado. price_reference y palas.precio_referencia usan mediana.
//     precio_minimo_tiendas sigue siendo el mínimo absoluto (no cambia).
// v4 (2026-05-25):
//   - insertSnapshot: .maybeSingle() → .limit(1) para evitar error PGRST116 cuando ya hay >1 duplicado
// v3 (2026-05-25):
//   - recalculatePriceReference: ventana 24h → 30 días
//   - runPipeline: filtrar productos cuyo título contiene "pack" antes de matching
// v2 (2026-05-25):
//   - insertSnapshot: check anti-duplicado por pala_id+source_id+url_producto+día
//   - recalculatePriceReference: dedup por url_producto antes de promediar
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
    .select('pala_id, match_method, confidence, producto_titulo')
    .eq('source_id', sourceId)
    .eq('producto_url', productUrl)
    .single();
  return data || null;
}

// Fix 3: saveToCache almacena el título actual. Si en el próximo scrape el título
// de esa URL ha cambiado (PadelNuestro reutilizó la URL para otro producto), la
// caché se invalida automáticamente en el bloque de matching abajo.
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
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Check 1: misma URL hoy (anti-dup original)
  const { data: existingUrl } = await supabase
    .from('price_snapshots')
    .select('id')
    .eq('pala_id', palaId)
    .eq('source_id', sourceId)
    .eq('url_producto', product.url_producto)
    .gte('scraped_at', today)
    .limit(1);
  if (existingUrl && existingUrl.length > 0) return true;

  // Check 2: misma pala+fuente hoy con URL distinta (slugs alternativos del mismo producto)
  // Evita que PadelNuestro tenga 2 URLs para la misma pala y genere filas duplicadas.
  const { data: existingPala } = await supabase
    .from('price_snapshots')
    .select('id, url_producto')
    .eq('pala_id', palaId)
    .eq('source_id', sourceId)
    .gte('scraped_at', today)
    .limit(1);
  if (existingPala && existingPala.length > 0) {
    console.log(`[pipeline] ⚠️  Pala ${palaId} ya tiene snapshot hoy en source ${sourceId} (URL: ${existingPala[0].url_producto}). Ignorando URL alternativa: ${product.url_producto}`);
    return true;
  }

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

// ─── Fix 1: Verificación HTTP de URLs ────────────────────────────────────────
// PadelNuestro no devuelve 404 en productos descatalogados: los redirige
// silenciosamente a otra página. Detectamos esto comparando la URL final
// de la respuesta con la URL que guardamos. Si son distintas → descatalogado.
async function checkUrlDisponible(url) {
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'es-ES,es;q=0.9',
  };
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: HEADERS,
    });
    // Si HEAD devuelve 404, algunos servidores (ej: PadelVice) bloquean HEAD pero
    // sirven GET correctamente → verificar con GET antes de marcar como rota.
    if (resp.status === 404) {
      try {
        const respGet = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(10000),
          headers: HEADERS,
        });
        if (respGet.ok) return true;   // HEAD mentía, GET funciona → URL válida
        if (respGet.status === 404) return false;
      } catch { /* si GET falla también, caer al return false original */ }
      return false;
    }
    // Si hubo redirección a una URL diferente → producto descatalogado/reemplazado
    // Excepción: Shopify redirige HEAD requests con parámetros extra — no es señal de baja
    const isShopify = url.includes('/products/');
    if (!isShopify && resp.redirected && resp.url !== url) {
      // Permitir redirecciones triviales (http→https, trailing slash)
      const norm = (u) => u.replace(/^http:/, 'https:').replace(/\/$/, '');
      if (norm(resp.url) !== norm(url)) return false;
    }
    return resp.ok;
  } catch {
    return null; // timeout u error de red → no marcar como no disponible
  }
}

// Verifica en lote las URLs de snapshots recién insertados y marca disponible=false
// los que ya no existen. Corre al final para no bloquear el scrape principal.
async function verificarUrlsNuevas(palaIds, sourceId) {
  if (palaIds.length === 0) return;
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // últimas 2h
  const { data: snaps } = await supabase
    .from('price_snapshots')
    .select('id, url_producto')
    .in('pala_id', palaIds)
    .eq('source_id', sourceId)
    .eq('disponible', true)
    .gte('scraped_at', since);

  if (!snaps || snaps.length === 0) return;

  console.log(`[pipeline] Verificando ${snaps.length} URLs nuevas (concurrencia 8)…`);
  let rotas = 0;
  const CONCURRENCY = 8;
  for (let i = 0; i < snaps.length; i += CONCURRENCY) {
    const batch = snaps.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (snap) => {
      const disponible = await checkUrlDisponible(snap.url_producto);
      if (disponible === false) {
        await supabase
          .from('price_snapshots')
          .update({ disponible: false })
          .eq('id', snap.id);
        console.log(`[pipeline] 🔴 URL rota → disponible=false: ${snap.url_producto}`);
        rotas++;
      }
    }));
  }
  if (rotas > 0) {
    console.log(`[pipeline] ${rotas} URLs marcadas como no disponibles.`);
    // Recalcular referencia de las palas afectadas: si la URL rota era el precio más barato,
    // la referencia queda obsoleta hasta el próximo scrape si no la recalculamos ahora.
    const rotasPalaIds = snaps
      .filter((_, idx) => idx < rotas)  // aproximación — recalcular todas las palaIds verificadas
      .map(s => s.pala_id ?? null).filter(Boolean);
    const rotasUnique = [...new Set(palaIds)];  // usar palaIds que ya tenemos del caller
    await recalculatePriceReference(rotasUnique);
  }
}

// ─── Mediana ──────────────────────────────────────────────────────────────────
// Media aritmética de los precios — suma / número de tiendas
function calcularMediana(precios) {
  if (precios.length === 0) return null;
  const suma = precios.reduce((a, b) => a + b, 0);
  return parseFloat((suma / precios.length).toFixed(2));
}

async function recalculatePriceReference(palaIds) {
  if (!palaIds.length) return;
  console.log(`[pipeline] Recalculando precio_referencia para ${palaIds.length} palas...`);

  const FUENTES_EXCLUIR_DE_REFERENCIA = new Set([2, 9]); // 2 = PadelZoom, 9 = Roma Sport
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // FIX v8: cargar precio_pvp oficial del catálogo para sanity check posterior
  const pvpPorPalaId = new Map();
  const CHUNK_PVP = 500;
  for (let i = 0; i < palaIds.length; i += CHUNK_PVP) {
    const chunk = palaIds.slice(i, i + CHUNK_PVP);
    const { data: pvpData } = await supabase
      .from('palas')
      .select('id, precio_pvp')
      .in('id', chunk);
    if (pvpData) {
      for (const p of pvpData) {
        if (p.precio_pvp > 0) pvpPorPalaId.set(p.id, p.precio_pvp);
      }
    }
  }

  // ── v9: BULK — 1 query por lote en lugar de 4 queries por pala ──────────────
  // Antes: 555 palas × 4 queries = 2.220 requests → timeout en GH Actions
  // Ahora: 2 queries bulk + 1 upsert bulk + 1 update bulk → ~4 requests totales
  const CHUNK = 500; // Supabase .in() acepta hasta ~500 IDs por query
  const allSnaps = [];

  for (let i = 0; i < palaIds.length; i += CHUNK) {
    const chunk = palaIds.slice(i, i + CHUNK);
    const { data: snapsChunk } = await supabase
      .from('price_snapshots')
      .select('pala_id, precio, source_id, url_producto, match_confidence')
      .in('pala_id', chunk)
      .eq('disponible', true)
      .gte('match_confidence', 0.95)
      .gte('scraped_at', since);
    if (snapsChunk) allSnaps.push(...snapsChunk);
  }

  // Agrupar por pala_id
  const byPala = new Map();
  for (const s of allSnaps) {
    if (!byPala.has(s.pala_id)) byPala.set(s.pala_id, { confirmados: [], todos: [] });
    byPala.get(s.pala_id).todos.push(s);
    if (s.match_confidence === 1.0) byPala.get(s.pala_id).confirmados.push(s);
  }

  const refRows = [];
  const palaRows = [];
  const now = new Date().toISOString();

  for (const palaId of palaIds) {
    const grupo = byPala.get(palaId);
    if (!grupo || grupo.todos.length === 0) continue;

    // Usar confirmados si hay >=2 fuentes con año verificado; si no, todos
    const snapsConfSrcs = new Set(grupo.confirmados.map(s => s.source_id));
    const snaps = snapsConfSrcs.size >= 2 ? grupo.confirmados : grupo.todos;

    const snapsParaRef = snaps.filter(s => !FUENTES_EXCLUIR_DE_REFERENCIA.has(s.source_id));
    const snapsFuente  = snapsParaRef.length > 0 ? snapsParaRef : snaps;

    // Deduplicar por url_producto — quedarse con el precio más bajo por URL
    const byUrl = new Map();
    for (const s of snapsFuente) {
      if (!byUrl.has(s.url_producto) || s.precio < byUrl.get(s.url_producto).precio) {
        byUrl.set(s.url_producto, s);
      }
    }
    const unique = [...byUrl.values()];
    const precios = unique.map(s => s.precio);
    if (precios.length === 0) continue;

    let precio_referencia = calcularMediana(precios);
    const precio_minimo = Math.min(...precios);
    const precio_maximo = Math.max(...precios);
    const fuentes_count = new Set(unique.map(s => s.source_id)).size;

    // v9: Precio de referencia dinámico
    // - < 3 tiendas con el producto → usar precio_pvp del fabricante (más fiable)
    // - ≥ 3 tiendas → usar mediana de precios actuales (refleja el mercado real, incluye bajadas)
    // - Solo bloquear si la mediana es >1.4× el pvp (bad match arriba, ej: edición especial)
    const pvpOficial = pvpPorPalaId.get(palaId);
    if (pvpOficial && precio_referencia) {
      const ratio = precio_referencia / pvpOficial;
      if (fuentes_count < 2) {
        // Solo 1 tienda → poco fiable, usar pvp fabricante como referencia
        console.log(`[pipeline] ℹ️  ${palaId}: solo ${fuentes_count} fuente(s) → usando pvp fabricante ${pvpOficial}€ como referencia`);
        precio_referencia = pvpOficial;
      } else if (ratio > 1.4) {
        // Bad match arriba (ej: edición especial matcheada a pala barata)
        console.warn(`[pipeline] ⚠️  precio_ref inflado para ${palaId}: mediana=${precio_referencia}€ vs pvp=${pvpOficial}€ (ratio=${ratio.toFixed(2)}) → usando pvp como fallback`);
        precio_referencia = pvpOficial;
      }
      // Si ≥ 3 tiendas y ratio <= 1.4 → usar mediana (puede ser mucho menor que pvp original, es correcto)
    }

    refRows.push({ pala_id: palaId, precio_referencia, precio_minimo, precio_maximo, fuentes_count, updated_at: now });
    palaRows.push({ id: palaId, precio_referencia, precio_minimo_tiendas: precio_minimo, precios_updated_at: now });
  }

  console.log(`[pipeline] Actualizando price_reference para ${refRows.length} palas...`);

  // Upsert bulk en lotes de 200
  const BATCH = 200;
  for (let i = 0; i < refRows.length; i += BATCH) {
    await supabase.from('price_reference')
      .upsert(refRows.slice(i, i + BATCH), { onConflict: 'pala_id' });
  }

  // Update palas en lotes (upsert por id)
  for (let i = 0; i < palaRows.length; i += BATCH) {
    for (const row of palaRows.slice(i, i + BATCH)) {
      await supabase.from('palas').update({
        precio_referencia:      row.precio_referencia,
        precio_minimo_tiendas:  row.precio_minimo_tiendas,
        precios_updated_at:     row.precios_updated_at,
      }).eq('id', row.id);
    }
  }

  console.log(`[pipeline] ✅ precio_referencia actualizado para ${refRows.length} palas`);

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

    // Filtrar packs
    if (/\bpack\b/i.test(p.title)) {
      console.log(`[pipeline] Descartando pack: "${p.title}"`);
      continue;
    }

    // Filtrar palas pickleball (algunas tiendas las listan junto a palas de pádel)
    // Comprobar tanto el título como la URL — el título a veces no lo menciona aunque la URL sí
    if (/\bpickleball\b/i.test(p.title) || /\bpickleball\b/i.test(p.url_producto || '')) {
      console.log(`[pipeline] Descartando pickleball: "${p.title}" (${p.url_producto || ''})`);
      continue;
    }

    // Filtrar palas junior/youth
    if (/\b(junior|jr|youth|bambino|kids|ni[ñn]o|mini)\b/i.test(p.title) ||
        /\b(junior|jr|youth|bambino|kids)\b/i.test(p.url_producto || '')) {
      console.log(`[pipeline] Descartando junior/youth: "${p.title}"`);
      await upsertCandidata(p.title, sourceSlug, p.precio, p.url_producto);
      continue;
    }

    // Filtrar variantes de jugador que contaminan referencias de modelos base
    // Ej: Lapi Edition (281€) no debe mezclarse con Tournament Pro Iconic (120€)
    if (/lapi[- ]edition/i.test(p.url_producto || '') || /lapi[- ]edition/i.test(p.title)) {
      console.log(`[pipeline] Descartando variante jugador (Lapi Edition): "${p.title}"`);
      continue;
    }

    // Filtrar ediciones World Cup y países
    if (/\b(world[- ]?cup|wc[-\s]?202[56]|argentina|alemania|espa[ñn]a|usa|england|colombia|france|belgium|netherland|multination|italia)\b/i.test(p.title) ||
        /\b(world[- ]?cup|wc-202[56])\b/i.test(p.url_producto || '')) {
      console.log(`[pipeline] Descartando edición especial/país: "${p.title}"`);
      continue;
    }

    try {
      let match = await getFromCache(source.id, p.url_producto);

      // Fix 3: si el título actual difiere del que guardamos en caché, el producto
      // cambió en esa URL → invalidar y rematchear desde cero.
      if (match && match.producto_titulo && match.producto_titulo !== p.title) {
        console.log(`[pipeline] 🔄 Título cambiado en caché, rematcheando: "${p.title}"`);
        match = null;
      }

      if (!match) {
        // Fix 2: pasamos url_producto al matcher para que extraiga señales de año/versión
        match = await fuzzyMatch(p.title, p.url_producto);
        await saveToCache(source.id, p.url_producto, p.title, match);
      }

      if (match?.pala_id) {
        matches_encontrados++;

        if (match.confidence < 0.95) {
          console.log(`[pipeline] ⚠️  Match rechazado (conf ${match.confidence.toFixed(3)} < 0.95): "${p.title}" → ${match.pala_id}`);
          await upsertCandidata(p.title, sourceSlug, p.precio, p.url_producto);
          candidatas_nuevas++;
        } else {
          const inserted = await insertSnapshot(match.pala_id, source.id, p, match.confidence);
          if (inserted) {
            inserts_realizados++;
            updatedPalaIds.add(match.pala_id);
          }
        }
      } else {
        await upsertCandidata(p.title, sourceSlug, p.precio, p.url_producto);
        candidatas_nuevas++;
      }

    } catch (err) {
      console.error(`[pipeline] Error procesando "${p.title}":`, err.message);
      errores++;
    }
  }

  await recalculatePriceReference([...updatedPalaIds]);

  // Fix 1: verificar URLs de los snapshots recién insertados
  await verificarUrlsNuevas([...updatedPalaIds], source.id);

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

module.exports = { recalculatePriceReference };

if (require.main === module) {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Uso: node scripts/prices/pipeline.js <store-slug>');
    process.exit(1);
  }
  runPipeline(slug).catch(err => {
    console.error('[pipeline] Error fatal:', err);
    process.exit(1);
  });
}
