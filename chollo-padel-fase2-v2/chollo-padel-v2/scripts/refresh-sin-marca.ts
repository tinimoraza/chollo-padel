/**
 * scripts/refresh-sin-marca.ts
 * =============================================================================
 * Re-extrae los atributos de las candidatas pendientes sin marca detectada
 * y actualiza su datos_extraidos en la BD.
 *
 * Tras ejecutar este script, corre promover-candidatas.ts para insertarlas.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/refresh-sin-marca.ts           # real
 *   npx tsx --env-file=.env.local scripts/refresh-sin-marca.ts --dry-run  # preview
 * =============================================================================
 */

import { createClient } from '@supabase/supabase-js'
import { extraerAtributos } from './extract-atributos'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  refresh-sin-marca.ts${DRY_RUN ? '  [DRY RUN]' : ''}`)
  console.log(`${'─'.repeat(60)}\n`)

  const { data: candidatas, error } = await supabase
    .from('palas_candidatas')
    .select('id, titulo, datos_extraidos')
    .eq('estado', 'pendiente')
    .is('datos_extraidos->>marca', null)
    .order('titulo')

  if (error) throw error

  console.log(`📋 Candidatas sin marca: ${candidatas!.length}\n`)

  let actualizadas = 0
  let siguen_sin_marca = 0

  for (const c of candidatas!) {
    const titulo = c.titulo as string
    const d = c.datos_extraidos as Record<string, any>
    const attrs = extraerAtributos(titulo)

    if (!attrs.marca) {
      console.log(`  ❓ [sin marca aún] ${titulo}`)
      siguen_sin_marca++
      continue
    }

    const nuevoDatos = {
      ...d,
      marca:    attrs.marca,
      linea:    attrs.linea,
      modelo:   attrs.modelo,
      variante: attrs.variante,
      año:      attrs.año ? String(attrs.año) : d.año ?? null,
    }

    if (DRY_RUN) {
      console.log(`  ✅ ${titulo}`)
      console.log(`     → marca: ${attrs.marca} | linea: ${attrs.linea} | modelo: ${attrs.modelo} | variante: ${attrs.variante} | año: ${attrs.año}`)
      actualizadas++
      continue
    }

    const { error: errUpdate } = await supabase
      .from('palas_candidatas')
      .update({ datos_extraidos: nuevoDatos })
      .eq('id', c.id)

    if (errUpdate) {
      console.log(`  ❌ ${titulo}: ${errUpdate.message}`)
    } else {
      console.log(`  ✅ ${titulo}  →  ${attrs.marca} / ${attrs.linea ?? '-'} / ${attrs.modelo ?? '-'}`)
      actualizadas++
    }
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`✅ Actualizadas:     ${actualizadas}`)
  if (siguen_sin_marca > 0) {
    console.log(`❓ Siguen sin marca: ${siguen_sin_marca}  (marcas no reconocidas — revisar a mano)`)
  }
  console.log(`${'─'.repeat(60)}\n`)

  if (DRY_RUN) {
    console.log('ℹ️  DRY RUN — ejecuta sin --dry-run para aplicar.\n')
  } else if (actualizadas > 0) {
    console.log('▶️  Ahora ejecuta: npx tsx --env-file=.env.local scripts/promover-candidatas.ts\n')
  }
}

main().catch(err => {
  console.error('\n💥 Error fatal:', err)
  process.exit(1)
})
