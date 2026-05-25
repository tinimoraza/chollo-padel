// scripts/auto-promote-candidatas.ts
// Cron diario: promueve a la tabla `palas` las candidatas vistas en ≥2 fuentes distintas.
// Ejecutar: npx tsx --env-file=.env.local scripts/auto-promote-candidatas.ts

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const MIN_FUENTES = 2   // mínimo de tiendas distintas para promover
const MIN_PRECIO  = 30  // descartar accesorios baratos (grips, bolsas...)

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

    // Detectar año del título (ej: "2025", "2026")
    const añoMatch = c.titulo.match(/\b(20\d{2})\b/)
    const año = añoMatch ? parseInt(añoMatch[1]) : new Date().getFullYear()

    // Construir slug url-friendly
    const slug = c.titulo_normalizado
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 100)

    // Insertar en palas
    const { data: nuevaPala, error: insertError } = await supabase
      .from('palas')
      .insert({
        slug,
        nombre: c.titulo,
        modelo: c.titulo,
        marca: c.marca_detectada || 'Desconocida',
        brand_slug: (c.marca_detectada || 'desconocida').toLowerCase().replace(/\s+/g, '-'),
        año,
        precio_pvp: c.precio_max,   // precio más alto visto = precio PVP aproximado
        precio_referencia: c.precio_min,
        fuente: 'auto_promoted',
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
      .update({ auto_promovida: true, updated_at: new Date().toISOString() })
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
