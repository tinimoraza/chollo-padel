/**
 * scripts/revisar-candidatas.ts
 * =============================================================================
 * Revisión manual de palas_candidatas con marca reconocida.
 *
 * Sustituye al auto-promote para el caso "marca reconocida, sin match en bbdd":
 * en vez de crear palas pobres automáticamente, te enseña cada candidata con
 * TODO lo que el pipeline ya extrajo (marca/línea/modelo/variante/año/imagen/
 * precio) y tú decides: promover (crea la pala ya con esos datos), descartar
 * o dejar pendiente.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/revisar-candidatas.ts
 * =============================================================================
 */

import { createClient } from '@supabase/supabase-js'
import * as readline from 'node:readline/promises'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quitar acentos
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100)
}

async function main() {
  console.log('🔍 Revisión de candidatas con marca reconocida\n')

  const { data: candidatas, error } = await supabase
    .from('palas_candidatas')
    .select('*')
    .in('estado', ['pendiente', 'ambiguo'])
    .eq('auto_promovida', false)
    .not('marca_detectada', 'is', null)
    .order('veces_visto', { ascending: false, nullsFirst: false })

  if (error) throw error
  if (!candidatas || candidatas.length === 0) {
    console.log('No hay candidatas pendientes con marca reconocida. 🎉')
    rl.close()
    return
  }

  console.log(`${candidatas.length} candidatas con marca reconocida pendientes de revisión.\n`)

  let promovidas = 0, descartadas = 0, saltadas = 0

  for (const c of candidatas) {
    const d = (c.datos_extraidos ?? {}) as Record<string, any>

    console.log('─'.repeat(70))
    console.log(`📦 ${c.titulo}`)
    console.log(`   Estado: ${c.estado}  |  Visto ${c.veces_visto ?? 1}x  |  Fuentes: ${(c.fuentes ?? []).join(', ')}`)
    console.log(`   Precio: ${c.precio_min}€${c.precio_max !== c.precio_min ? ` – ${c.precio_max}€` : ''}`)
    console.log(`   Marca detectada: ${c.marca_detectada ?? '—'}`)
    if (d.linea || d.modelo || d.variante || d.año) {
      console.log(`   Atributos extraídos: línea=${d.linea ?? '—'} | modelo=${d.modelo ?? '—'} | variante=${d.variante ?? '—'} | año=${d.año ?? '—'}`)
    }
    if (d.imagen_url) console.log(`   Imagen: ${d.imagen_url}`)
    if (d.url_origen) console.log(`   URL: ${d.url_origen}`)
    if (d.candidatos_ids?.length) console.log(`   ⚠️  Candidatos ambiguos en bbdd: ${d.candidatos_ids.join(', ')}`)

    const resp = (await rl.question('\n   [p] promover · [d] descartar · [Enter] saltar > ')).trim().toLowerCase()

    if (resp === 'p') {
      const nombre = c.titulo
      const slug = slugify(`${d.marca ?? c.marca_detectada}-${d.linea ?? ''}-${d.modelo ?? ''}-${d.variante ?? ''}-${d.año ?? ''}`) || slugify(nombre)
      const marca = d.marca ?? c.marca_detectada
      const brandSlug = slugify(marca)

      const { data: nuevaPala, error: insertError } = await supabase
        .from('palas')
        .insert({
          slug,
          nombre,
          marca,
          brand_slug: brandSlug,
          linea:      d.linea ?? null,
          modelo:     d.modelo ?? null,
          variante:   d.variante ?? null,
          año:        d.año ?? null,
          imagen_url: d.imagen_url ?? null,
          precio_pvp: d.precio_pvp ?? c.precio_max,
          fuente:     'revision_manual',
          jugadores:  [],
        })
        .select('id, slug')
        .single()

      if (insertError) {
        console.log(`   ❌ Error al crear la pala: ${insertError.message}`)
        continue
      }

      await supabase
        .from('palas_candidatas')
        .update({ auto_promovida: true, estado: 'matched', revisada_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', c.id)

      console.log(`   ✅ Pala creada: ${nuevaPala.slug} (id: ${nuevaPala.id})`)
      promovidas++

    } else if (resp === 'd') {
      await supabase
        .from('palas_candidatas')
        .update({ estado: 'descartada', revisada_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', c.id)
      console.log('   🗑️  Descartada.')
      descartadas++

    } else {
      console.log('   ⏭️  Saltada (sigue pendiente).')
      saltadas++
    }
  }

  console.log('\n' + '═'.repeat(70))
  console.log(`📊 Resumen: ${promovidas} promovidas · ${descartadas} descartadas · ${saltadas} saltadas`)
  rl.close()
}

main()
  .catch(err => { console.error('Error fatal:', err); process.exit(1) })
  .finally(() => rl.close())
