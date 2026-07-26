// scripts/detect-geo-codes.js
//
// Detecta códigos de descuento en tiendas con geo-targeting por IP.
// Debe correr en local (IP española) para que la web sirva la versión
// española con los banners de promo.
//
// Uso manual:
//   node scripts/detect-geo-codes.js
//
// Uso automático (Task Scheduler Windows, diario a las 9:00):
//   schtasks /create /tn "HuntPadel-GeoCodesDetector" /tr
//     "node C:\chollo-padel\chollo-padel-fase2-v2\chollo-padel-v2\scripts\detect-geo-codes.js"
//     /sc daily /st 09:00 /f
//
// El script:
//   1. Abre cada URL con Playwright (headless, IP local)
//   2. Detecta código usando el mismo detector que el scraper normal
//   3. Actualiza codigos_descuento_manual en Supabase
//   4. Aplica el código a price_snapshots de esa tienda (efecto inmediato en /chollos)
//
// Añadir más tiendas: sigue el patrón del array GEO_TIENDAS al final del fichero.

'use strict'
const path = require('path')
try { require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') }) } catch (_) {}

const { detectarCodigoDescuento } = require('./prices/scrapers/_discount-utils.js')

// ── Tiendas con geo-targeting (no detectables desde GH Actions) ──────────────
// url       : homepage principal donde aparece el banner de promo
// waitMs    : ms adicionales para que el slider/JS cargue tras networkidle
// slug      : debe coincidir con price_sources.slug en Supabase
const GEO_TIENDAS = [
  {
    slug:   'tiendapadelpoint',
    url:    'https://www.tiendapadelpoint.com',
    waitMs: 4000,   // Revolution Slider necesita tiempo extra
  },
  // Añadir más tiendas aquí cuando sea necesario:
  // { slug: 'otratienda', url: 'https://www.otratienda.com', waitMs: 2000 },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toLocaleTimeString('es-ES', { hour12: false })
}

async function detectarEnPagina(page, url, waitMs) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForTimeout(waitMs)
  const html = await page.evaluate(() => document.documentElement.innerHTML)
  const low  = html.toLowerCase()
  const info = {
    htmlKb:     Math.round(html.length / 1024),
    tieneSale:  /\bsale\s*\d{1,2}\b/.test(low),
    tieneCupon: /cup[oó]n|c[oó]digo/.test(low),
    esEspañol:  /palas|descuento|oferta|rebajas/.test(low),
  }
  const codigo = detectarCodigoDescuento(html)
  return { codigo, info }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    console.error('❌ Faltan variables NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en .env.local')
    process.exit(1)
  }

  const { createClient } = require('@supabase/supabase-js')
  const supabase = createClient(url, key)

  // Obtener source_ids
  const slugs = GEO_TIENDAS.map(t => t.slug)
  const { data: sources, error: srcErr } = await supabase
    .from('price_sources').select('id,slug').in('slug', slugs)
  if (srcErr) { console.error('❌ Error cargando price_sources:', srcErr.message); process.exit(1) }
  const srcMap = Object.fromEntries((sources || []).map(s => [s.slug, s]))

  // Lanzar Playwright
  let chromium
  try { ({ chromium } = require('playwright')) }
  catch { console.error('❌ playwright no instalado — ejecuta: npm install playwright'); process.exit(1) }

  const browser = await chromium.launch({ headless: true })
  const page    = await browser.newPage()
  await page.setExtraHTTPHeaders({
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  })

  console.log(`\n🔍 detect-geo-codes — ${new Date().toLocaleString('es-ES')}`)
  console.log('─'.repeat(60))

  for (const tienda of GEO_TIENDAS) {
    const src = srcMap[tienda.slug]
    if (!src) {
      console.log(`[${ts()}] ⚠️  ${tienda.slug} — no encontrado en price_sources, omitiendo`)
      continue
    }

    console.log(`\n[${ts()}] ▶ ${tienda.slug} (${tienda.url})`)

    try {
      const { codigo, info } = await detectarEnPagina(page, tienda.url, tienda.waitMs)

      console.log(`         HTML: ${info.htmlKb}KB | español: ${info.esEspañol} | sale_pattern: ${info.tieneSale} | cupón_kw: ${info.tieneCupon}`)

      if (codigo) {
        console.log(`[${ts()}] ✅ Detectado: ${codigo.codigo} (-${codigo.descuento_pct}%)`)

        // Guardar en codigos_descuento_manual (delete+insert por si no hay constraint unique)
        await supabase.from('codigos_descuento_manual')
          .delete()
          .eq('source_id', src.id)
          .eq('nota', 'Auto-detectado local (IP española)')

        await supabase.from('codigos_descuento_manual').insert({
          source_id:    src.id,
          codigo:       codigo.codigo,
          descuento_pct: codigo.descuento_pct,
          activo:       true,
          nota:         'Auto-detectado local (IP española)',
          updated_at:   new Date().toISOString(),
        })

        // Aplicar a price_snapshots disponibles de esta tienda
        const { count } = await supabase.from('price_snapshots')
          .update({ codigo_descuento: codigo.codigo, descuento_pct: codigo.descuento_pct })
          .eq('source_id', src.id)
          .eq('disponible', true)
          .select('id', { count: 'exact', head: true })

        console.log(`[${ts()}] 📦 Aplicado a ${count ?? '?'} snapshots disponibles`)

      } else {
        console.log(`[${ts()}] ℹ️  Sin código detectado`)

        if (info.esEspañol) {
          // La página cargó en español pero no hay código → promo terminó
          // Limpiar entradas auto-detectadas y snapshots
          await supabase.from('codigos_descuento_manual')
            .update({ activo: false, updated_at: new Date().toISOString() })
            .eq('source_id', src.id)
            .eq('nota', 'Auto-detectado local (IP española)')

          await supabase.from('price_snapshots')
            .update({ codigo_descuento: null, descuento_pct: null })
            .eq('source_id', src.id)
            .not('codigo_descuento', 'is', null)

          console.log(`[${ts()}] 🧹 Promo terminada — snapshots limpiados`)
        } else {
          // La página no se cargó en español → posible problema de conexión, no tocar BD
          console.log(`[${ts()}] ⚠️  Página no cargó en español — BD sin cambios (comprobar conexión)`)
        }
      }

    } catch (e) {
      console.error(`[${ts()}] ❌ Error en ${tienda.slug}: ${e.message}`)
    }
  }

  await browser.close()
  console.log('\n' + '─'.repeat(60))
  console.log(`✅ Completado — ${new Date().toLocaleString('es-ES')}`)
}

main().catch(e => {
  console.error('❌ Error fatal:', e)
  process.exit(1)
})
