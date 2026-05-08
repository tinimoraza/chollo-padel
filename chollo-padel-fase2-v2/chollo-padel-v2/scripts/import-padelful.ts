import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // necesita service role, no anon key
)

const BASE_URL = 'https://padelful.com/api/v1/rackets'
const PAGE_SIZE = 100

async function fetchAllRackets() {
  let allRackets: any[] = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const url = `${BASE_URL}?locale=es&limit=${PAGE_SIZE}&offset=${offset}`
    console.log(`Fetching offset ${offset}...`)
    const res = await fetch(url)
    const json = await res.json()

    const rackets = json.data?.rackets ?? []
    allRackets = allRackets.concat(rackets)
    hasMore = json.data?.pagination?.hasMore ?? false
    offset += PAGE_SIZE
  }

  console.log(`Total palas obtenidas: ${allRackets.length}`)
  return allRackets
}

function mapRacket(r: any) {
  return {
    slug: r.slug,
    nombre: r.title,
    marca: r.brand,
    brand_slug: r.brandSlug,
    modelo: r.model,
    año: r.season,
    forma: r.shape,
    balance: r.balance ?? null,
    tacto: r.feel ?? null,
    juego: r.game ?? null,
    genero: r.genre ?? null,
    peso_min: r.weight?.[0] ?? null,
    peso_max: r.weight?.[1] ?? null,
    material_cara: r.materials?.faces ?? null,
    material_nucleo: r.materials?.core ?? null,
    material_marco: r.materials?.frame ?? null,
    rating_global: r.rating ? parseFloat(r.rating) : null,
    rating_potencia: r.ratings?.power ?? null,
    rating_control: r.ratings?.control ?? null,
    rating_rebote: r.ratings?.rebound ?? null,
    rating_manejabilidad: r.ratings?.maneuverability ?? null,
    rating_punto_dulce: r.ratings?.sweetSpot ?? null,
    precio_pvp: r.pvp ?? null,
    imagen_url: r.image ? `https://padelful.com${r.image}` : null,
    jugadores: r.players ?? [],
    fuente: 'padelful',
    padelful_slug: r.slug,
  }
}

async function main() {
  const rackets = await fetchAllRackets()
  const mapped = rackets.map(mapRacket)

  // Upsert en lotes de 50
  const BATCH = 50
  for (let i = 0; i < mapped.length; i += BATCH) {
    const batch = mapped.slice(i, i + BATCH)
    const { error } = await supabase
      .from('palas')
      .upsert(batch, { onConflict: 'slug' })

    if (error) {
      console.error(`Error en lote ${i}:`, error.message)
    } else {
      console.log(`✅ Lote ${i} - ${i + batch.length} insertado`)
    }
  }

  console.log('🎉 Importación completada')
}

main()
