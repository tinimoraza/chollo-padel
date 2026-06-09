/**
 * scripts/promover-candidatas.ts
 * =============================================================================
 * Promueve las palas_candidatas pendientes (con marca conocida) al catálogo.
 *
 * Por cada candidata:
 *   1. Inserta una fila en `palas` con los datos extraídos
 *   2. Crea un alias en `producto_aliases` para que futuros scrapes la matcheen
 *   3. Marca la candidata como estado='matched'
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/promover-candidatas.ts           # real
 *   npx tsx --env-file=.env.local scripts/promover-candidatas.ts --dry-run  # solo preview
 *
 * Las 38 candidatas sin marca (Vairo, etc.) NO se tocan — requieren revisión aparte.
 * =============================================================================
 */

import { createClient } from '@supabase/supabase-js'
import { normalizar } from './extract-atributos'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const DRY_RUN = process.argv.includes('--dry-run')
const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgo'

// Marcas que el extractor escribe de forma incorrecta → forma canónica
const MARCA_NORMALIZACION: Record<string, string> = {
  'Star Vie': 'StarVie',
  'Vibora':   'Vibor-A',
}

// ─── Slug ────────────────────────────────────────────────────────────────────

function slugify(texto: string): string {
  return texto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  promover-candidatas.ts${DRY_RUN ? '  [DRY RUN — sin cambios]' : ''}`)
  console.log(`${'─'.repeat(60)}\n`)

  // 1. Cargar candidatas pendientes con marca conocida
  const { data: candidatas, error: errCand } = await supabase
    .from('palas_candidatas')
    .select('id, titulo, titulo_normalizado, datos_extraidos')
    .eq('estado', 'pendiente')
    .not('datos_extraidos->>marca', 'is', null)
    .order('datos_extraidos->>marca')
    .order('titulo')

  if (errCand) throw errCand

  console.log(`📋 Candidatas a promover: ${candidatas!.length}`)
  console.log(`   (sin marca excluidas — se tratarán aparte)\n`)

  // 2. Cargar slugs existentes para garantizar unicidad
  const { data: slugsExistentes } = await supabase
    .from('palas')
    .select('slug')

  const usedSlugs = new Set(slugsExistentes?.map(p => p.slug) ?? [])

  // 3. Procesar candidatas
  let insertadas = 0
  let yaExistia = 0
  let sinImagen = 0
  const errores: string[] = []

  for (const c of candidatas!) {
    const d = c.datos_extraidos as Record<string, any>
    const titulo = c.titulo as string

    // Nombre = el título original tal cual (ya viene en mayúsculas de padelnuestro)
    const nombre = titulo.trim().toUpperCase()

    // ── Guardia anti-duplicados: si ya existe un alias con este texto, no insertamos ──
    const textoNormGuardia = normalizar(titulo)
    const { data: aliasExistente } = await supabase
      .from('producto_aliases')
      .select('pala_id')
      .eq('tienda', 'padelnuestro')
      .eq('texto_normalizado', textoNormGuardia)
      .maybeSingle()

    if (aliasExistente) {
      if (!DRY_RUN) {
        await supabase.from('palas_candidatas').update({
          estado:          'matched',
          revisada_at:     new Date().toISOString(),
          datos_extraidos: { ...d, pala_id_promovida: aliasExistente.pala_id },
        }).eq('id', c.id)
      }
      console.log(`  🔗 [ya en catálogo] ${nombre}`)
      yaExistia++
      continue
    }

    // Slug único
    let slug = slugify(nombre)
    if (usedSlugs.has(slug)) {
      let i = 2
      while (usedSlugs.has(`${slug}-${i}`)) i++
      slug = `${slug}-${i}`
    }

    // Imagen: si es placeholder la insertamos igual (aparecerá en fix-imagenes)
    const imagenUrl: string | null = d.imagen_url ?? null
    const esPlaceholder = imagenUrl?.startsWith(PLACEHOLDER)

    if (esPlaceholder) sinImagen++

    const marcaCanonica = MARCA_NORMALIZACION[d.marca] ?? d.marca

    const nuevaPala = {
      slug,
      nombre,
      marca:      marcaCanonica ?? null,
      linea:      d.linea   ?? null,
      modelo:     d.modelo  ?? null,
      variante:   d.variante ?? null,
      año:        d.año     ? parseInt(d.año, 10) : null,
      imagen_url: imagenUrl,
      precio_pvp: d.precio_pvp ? parseFloat(d.precio_pvp) : null,
      fuente:     'padelnuestro',
    }

    if (DRY_RUN) {
      const imagenTag = esPlaceholder ? ' ⚠️ sin imagen' : ''
      console.log(`  ✅ ${nombre}${imagenTag}`)
      usedSlugs.add(slug)
      insertadas++
      continue
    }

    // ── Insertar pala ────────────────────────────────────────────────────────
    const { data: palaInsertada, error: errPala } = await supabase
      .from('palas')
      .insert(nuevaPala)
      .select('id')
      .single()

    if (errPala || !palaInsertada) {
      errores.push(`❌ [pala] ${titulo}: ${errPala?.message}`)
      continue
    }

    usedSlugs.add(slug)
    const palaId = palaInsertada.id

    // ── Insertar alias ───────────────────────────────────────────────────────
    const { error: errAlias } = await supabase
      .from('producto_aliases')
      .insert({
        pala_id:           palaId,
        texto_original:    titulo,
        texto_normalizado: normalizar(titulo),
        tienda:            'padelnuestro',
        fuente_url:        d.url_origen ?? null,
        confianza:         1.0,
      })

    if (errAlias) {
      // No abortamos — la pala ya está insertada
      errores.push(`⚠️  [alias] ${titulo}: ${errAlias.message}`)
    }

    // ── Marcar candidata como matched ────────────────────────────────────────
    const { error: errUpdate } = await supabase
      .from('palas_candidatas')
      .update({
        estado:       'matched',
        revisada_at:  new Date().toISOString(),
        datos_extraidos: { ...d, pala_id_promovida: palaId },
      })
      .eq('id', c.id)

    if (errUpdate) {
      errores.push(`⚠️  [candidata] ${titulo}: ${errUpdate.message}`)
    }

    const imagenTag = esPlaceholder ? ' ⚠️ sin imagen' : ''
    console.log(`  ✅ ${nombre}${imagenTag}`)
    insertadas++
  }

  // ─── Resumen ─────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`✅ Insertadas:  ${insertadas}`)
  if (yaExistia > 0) {
    console.log(`🔗 Ya existían: ${yaExistia}  (marcadas como matched sin insertar)`)
  }
  if (sinImagen > 0) {
    console.log(`⚠️  Sin imagen:  ${sinImagen}  (aparecerán en la herramienta fix-imagenes)`)
  }
  if (errores.length > 0) {
    console.log(`\n❌ Errores (${errores.length}):`)
    errores.forEach(e => console.log(`   ${e}`))
  }
  console.log(`${'─'.repeat(60)}\n`)

  if (DRY_RUN) {
    console.log('ℹ️  DRY RUN completado — ejecuta sin --dry-run para aplicar cambios.\n')
  }
}

main().catch(err => {
  console.error('\n💥 Error fatal:', err)
  process.exit(1)
})
