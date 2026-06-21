// scripts/auto-promote-candidatas.ts
// v2 (2026-06-05): filtro esPala() — descarta ropa, zapatillas y accesorios antes de promover
// Cron diario: promueve a la tabla `palas` las candidatas vistas en ≥N fuentes distintas.
// Ejecutar: npx tsx --env-file=.env.local scripts/auto-promote-candidatas.ts

import { createClient } from '@supabase/supabase-js'
import { extraerAtributos, cargarLineasDesdeBD } from './extract-atributos'
import { buscarPorAtributos } from './lib/modelo-matching'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const MIN_FUENTES = 1   // mínimo de tiendas distintas para promover
const MIN_PRECIO  = 30  // descartar accesorios baratos (grips, bolsas...)

// Palabras que indican que el producto NO es una pala de pádel.
// IMPORTANTE: usar términos específicos para no hacer falsos positivos
// (ej: evitar 'clay' porque hay palas con 'clay' en el nombre de color/variante)
const NO_ES_PALA = [
  // Pickleball — deporte distinto, no es pádel (bug real 2026-06-21: generaba
  // filas huérfanas tipo "PICKLEBALL ADIDAS 3" / "PICKLEBALL HEAD" en `palas`)
  'pickleball',
  // Calzado — términos inequívocos
  'zapatilla', 'zapatillas', 'shoe', 'shoes', 'footwear',
  'all court', 'gel challenger', 'gel resolution', 'solution speed',
  'propulse fury', 'sprint pro', 'master 1000 niños',
  'motion niños', 'motion team', 'neuron vibram',
  // Ropa — términos inequívocos
  'camiseta', 'falda', 'chándal', 'chandal',
  'vestido', 'tights', 'legging', 'sudadera', 'chaqueta',
  // "polo" y "short" con contexto para evitar falsos positivos
  ' polo ', ' polo -', 'polo shirt',
  ' short ', 'shorts -', '4in shorts', '9in shorts', '2in shorts',
  'short bullpadel', 'short adidas', 'short nike', 'short head',
  // Nike/Adidas/Asics/Fila ropa explícita
  'dri-fit', 'dri fit', 'freelift',
  // Accesorios
  'bolsa', 'mochila', 'paletero', 'funda', 'grip', 'overgrip',
  'protector', 'muñequera', 'pelotas', 'pelota',
  'antivibrador', 'raquetero', 'anorak', 'sandalia', 'sandalias',
  'gorra', 'calcetin', 'calcetín', 'calcetines', 'toalla',
  // Sets/packs — combinan pala + accesorio, el título no es una pala única
  'set de', 'pack de',
]

// Devuelve true si el título parece ser una pala de pádel
function esPala(titulo: string): boolean {
  const t = titulo.toLowerCase()
  return !NO_ES_PALA.some(w => t.includes(w))
}

async function main() {
  console.log('[auto-promote] Buscando candidatas para promover...')

  // Sincroniza LINEAS_POR_MARCA con las líneas ya existentes en BD antes de
  // parsear títulos — igual que hace pipeline-tiendas.ts al arrancar.
  await cargarLineasDesdeBD(supabase)

  const { data: candidatas, error } = await supabase
    .from('palas_candidatas')
    .select('*')
    .eq('auto_promovida', false)
    .gte('precio_min', MIN_PRECIO)

  if (error) throw error
  if (!candidatas || candidatas.length === 0) {
    console.log('[auto-promote] No hay candidatas pendientes.')
    return
  }

  let promovidas = 0
  let descartadas = 0

  for (const c of candidatas) {
    const numFuentes = (c.fuentes as string[]).length

    if (numFuentes < MIN_FUENTES) {
      console.log(`[auto-promote] ⏭  Esperar más fuentes (${numFuentes}/${MIN_FUENTES}): "${c.titulo}"`)
      descartadas++
      continue
    }

    // Filtrar productos que no son palas (ropa, zapatillas, accesorios)
    if (!esPala(c.titulo)) {
      console.log(`[auto-promote] 🚫 No es pala, descartando: "${c.titulo}"`)
      descartadas++
      continue
    }

    // Parsear el título con el mismo extractor que usa el pipeline de tiendas,
    // para no volcar el título crudo en `modelo` (bug detectado 2026-06-20:
    // generaba filas con linea=null y modelo=título completo sin parsear,
    // que luego chocaban como ambiguos/duplicados contra la fila limpia real).
    const attrs = extraerAtributos(c.titulo)
    const marca = attrs.marca || c.marca_detectada || 'Desconocida'

    // Si el extractor no reconoció línea, no insertar a ciegas: el título crudo
    // acaba volcado en `modelo` (causa raíz de las 277 filas huérfanas detectadas
    // 2026-06-21, ej. "SUPER PACK ADIDAS ZENTIX BLACK ORANGE 2026"). Mejor dejar
    // la candidata pendiente para revisión manual en GestorCandidatas.
    if (!attrs.linea) {
      console.log(`[auto-promote] ⏭  Sin línea reconocida, dejo pendiente para revisión manual: "${c.titulo}"`)
      descartadas++
      continue
    }

    // Antes de insertar, comprobar si ya existe una pala compatible en el
    // catálogo (misma lógica de matching que usa pipeline-tiendas.ts, vía
    // scripts/lib/modelo-matching.ts). Sin este check se generaban duplicados
    // semánticos tipo "Metalbone Lite 3.1" (nuevo) vs "Metalbone LITE" (ya en BD).
    const existentes = await buscarPorAtributos(supabase, attrs)
    if (existentes.length === 1) {
      await supabase
        .from('palas_candidatas')
        .update({ auto_promovida: true, estado: 'matched', updated_at: new Date().toISOString() })
        .eq('id', c.id)
      console.log(`[auto-promote] 🔗 Ya existe, vinculo sin duplicar: "${c.titulo}" → pala ${existentes[0].id}`)
      promovidas++
      continue
    }
    if (existentes.length > 1) {
      console.log(`[auto-promote] ⏭  Ambiguo (${existentes.length} candidatos), dejo pendiente para revisión manual: "${c.titulo}"`)
      descartadas++
      continue
    }

    // Año: preferir el detectado por el extractor (más fiable, normaliza
    // formatos tipo "2.6"→2026); si no encontró nada, fallback al regex simple.
    const añoMatch = c.titulo.match(/\b(20\d{2})\b/)
    const año = attrs.año ?? (añoMatch ? parseInt(añoMatch[1]) : null)

    // Construir slug url-friendly
    const slug = c.titulo_normalizado
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 100)

    // imagen_url: la candidata guarda en datos_extraidos la info del último
    // scraper que la vio. Si ese scraper capturó imagen, la heredamos aquí —
    // si no, queda null y un proceso aparte (backfill og:image) la rellena.
    // (Bug detectado 2026-06-20: esta columna nunca se rellenaba al promover,
    // generando palas sin imagen aunque la fuente sí la tuviera.)
    const imagenUrl = (c.datos_extraidos as any)?.imagen_url || null

    // Insertar en palas
    const { data: nuevaPala, error: insertError } = await supabase
      .from('palas')
      .insert({
        slug,
        nombre: c.titulo,
        modelo: attrs.modelo,
        linea: attrs.linea,
        variante: attrs.variante,
        marca,
        brand_slug: marca.toLowerCase().replace(/\s+/g, '-'),
        año,
        precio_pvp: c.precio_max,   // precio más alto visto = precio PVP aproximado
        precio_referencia: c.precio_min,
        fuente: 'auto_promoted',
        imagen_url: imagenUrl,
      })
      .select('id')
      .single()

    if (insertError) {
      // Si ya existe (slug duplicado) lo ignoramos
      if (insertError.code === '23505') {
        console.log(`[auto-promote] ⚠️  Slug duplicado, ignorando: "${c.titulo}"`)
      } else {
        console.error(`[auto-promote] Error insertando "${c.titulo}":`, insertError.message)
      }
      continue
    }

    // Marcar candidata como promovida
    await supabase
      .from('palas_candidatas')
      .update({ auto_promovida: true, estado: 'matched', updated_at: new Date().toISOString() })
      .eq('id', c.id)

    console.log(`[auto-promote] ✅ Promovida: "${c.titulo}" (${numFuentes} fuentes, id: ${nuevaPala.id})`)
    promovidas++
  }

  console.log(`\n[auto-promote] Completado: ${promovidas} promovidas, ${descartadas} esperando más fuentes.`)
}

main().catch(err => {
  console.error('[auto-promote] Error fatal:', err)
  process.exit(1)
})
