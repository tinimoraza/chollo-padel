// scripts/auto-promote-candidatas.ts
// v2 (2026-06-05): filtro esPala() — descarta ropa, zapatillas y accesorios antes de promover
// Cron diario: promueve a la tabla `palas` las candidatas vistas en ≥N fuentes distintas.
// Ejecutar: npx tsx --env-file=.env.local scripts/auto-promote-candidatas.ts

import { createClient } from '@supabase/supabase-js'

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
  // Nike/Adidas/Asics/Fila ropa explícita
  'dri-fit', 'dri fit', 'freelift',
  // Accesorios
  'bolsa', 'mochila', 'paletero', 'funda', 'grip', 'overgrip',
  'protector', 'muñequera', 'pelotas', 'pelota',
  'antivibrador', 'raquetero',
]

// Devuelve true si el título parece ser una pala de pádel
function esPala(titulo: string): boolean {
  const t = titulo.toLowerCase()
  return !NO_ES_PALA.some(w => t.includes(w))
}

async function main() {
  console.log('[auto-promote] Buscando candidatas para promover...')

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

    // Detectar año del título (ej: "2025", "2026")
    // Si no hay año explícito → NULL (no asumir el año actual, podría ser un modelo antiguo)
    const añoMatch = c.titulo.match(/\b(20\d{2})\b/)
    const año = añoMatch ? parseInt(añoMatch[1]) : null

    // Construir slug url-friendly
    const