// scripts/backfill-imagenes-palas.ts
// One-off: rellena palas.imagen_url para palas existentes que no la tienen,
// usando la URL de origen (palas_candidatas.urls / producto_aliases.fuente_url)
// y extrayendo el <meta property="og:image"> de la ficha de producto.
// Ejecutar: BACKFILL_LIMIT=60 npx tsx --env-file=.env.local scripts/backfill-imagenes-palas.ts

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function getOgImage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const html = await res.text()
    const m = html.match(/<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']/i)
      || html.match(/<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']/i)
    return m ? m[1] : null
  } catch (e) {
    return null
  }
}

async function main() {
  const LIMIT = parseInt(process.env.BACKFILL_LIMIT || '9999', 10)
  console.log('[backfill-imagenes] Buscando palas sin imagen, limite ' + LIMIT)

  const { data: palas, error } = await supabase
    .from('palas')
    .select('id, modelo, fuente')
    .or('imagen_url.is.null,imagen_url.eq.')
    .limit(LIMIT)

  if (error) throw error
  console.log('[backfill-imagenes] ' + (palas ? palas.length : 0) + ' palas sin imagen en este lote')

  let ok = 0, fail = 0, skip = 0

  for (const p of (palas || [])) {
    let url = null

    if (p.fuente === 'auto_promoted') {
      const { data: cand } = await supabase
        .from('palas_candidatas')
        .select('urls, datos_extraidos')
        .eq('titulo', p.modelo)
        .limit(1)
        .maybeSingle()
      url = (cand && cand.urls && cand.urls[0]) || (cand && cand.datos_extraidos && cand.datos_extraidos.url_origen) || null
    } else {
      const { data: alias } = await supabase
        .from('producto_aliases')
        .select('fuente_url')
        .eq('pala_id', p.id)
        .limit(1)
        .maybeSingle()
      url = (alias && alias.fuente_url) || null
    }

    if (!url) { skip++; continue }

    const img = await getOgImage(url)
    if (img) {
      await supabase.from('palas').update({ imagen_url: img }).eq('id', p.id)
      console.log('OK ' + (p.modelo ? p.modelo.slice(0, 60) : '') + ' -> ' + img.slice(0, 80))
      ok++
    } else {
      console.log('FAIL sin og:image: ' + (p.modelo ? p.modelo.slice(0, 60) : '') + ' (' + url + ')')
      fail++
    }

    await sleep(150)
  }

  console.log('')
  console.log('[backfill-imagenes] Completado: ' + ok + ' ok, ' + fail + ' sin og:image, ' + skip + ' sin url disponible')
}

main().catch(err => {
  console.error('[backfill-imagenes] Error fatal:', err)
  process.exit(1)
})
