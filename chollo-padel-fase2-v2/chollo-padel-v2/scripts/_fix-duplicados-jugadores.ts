/**
 * _fix-duplicados-jugadores.ts
 * Limpia palas del catálogo cuyo nombre contiene un jugador.
 *
 * Modo diagnóstico (por defecto):
 *   npx tsx --env-file=.env.local scripts/_fix-duplicados-jugadores.ts
 *
 * Modo fix:
 *   npx tsx --env-file=.env.local scripts/_fix-duplicados-jugadores.ts --fix
 *
 * Qué hace con --fix:
 *   1. Renombra cada pala duplicada quitando el jugador del nombre
 *   2. Si dos palas quedan con el mismo nombre tras el strip → fusiona la segunda en la primera
 *   3. Añade alias apuntando al nombre original (con jugador)
 *   4. Cierra candidatas ambiguas/pendientes que matcheen con el nombre normalizado
 */

import { createClient } from '@supabase/supabase-js'
import { quitarJugadores } from './extract-atributos'

const sb    = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
const FIX   = process.argv.includes('--fix')

function normalizar(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function slugify(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function stripJugador(nombre: string): string {
  return quitarJugadores(nombre)
    .replace(/\bby\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

async function main() {
  // ── Estado candidatas ──────────────────────────────────────────────────────
  const { data: cands } = await sb.from('palas_candidatas')
    .select('id, titulo, titulo_normalizado, estado, datos_extraidos')
    .in('estado', ['ambiguo', 'pendiente'])
    .order('estado').order('titulo')

  console.log(`\n=== Candidatas ambiguas/pendientes: ${cands?.length ?? 0} ===`)
  for (const c of cands ?? []) {
    const d = c.datos_extraidos as any
    console.log(`[${c.estado}] ${c.titulo}`)
    console.log(`  marca:${d?.marca} linea:${d?.linea} modelo:${d?.modelo} año:${d?.año}`)
  }

  // ── Catálogo completo ──────────────────────────────────────────────────────
  const { data: todasPalas } = await sb.from('palas')
    .select('id, nombre, marca, linea, modelo, variante, año, slug')
  const palas = todasPalas ?? []

  // ── Detectar duplicados ────────────────────────────────────────────────────
  // Agrupar por "nombre limpio + año" — palas que deberían ser la misma
  type Grupo = { clave: string; palas: typeof palas }
  const grupos = new Map<string, typeof palas>()

  for (const p of palas) {
    const stripped = stripJugador(p.nombre)
    if (normalizar(stripped) === normalizar(p.nombre)) continue  // no hay jugador → ignorar
    const clave = normalizar(stripped) + '|' + (p.año ?? 'null')
    if (!grupos.has(clave)) grupos.set(clave, [])
    grupos.get(clave)!.push(p)
  }

  // Palas con "alonso" / "edu" en el nombre que no se detectaron → diagnóstico extra
  const ventusCheck = palas.filter(p =>
    /alonso|edu alonso|ventus.*alonso|alonso.*ventus/i.test(p.nombre)
  )
  if (ventusCheck.length > 0) {
    console.log(`\n=== Palas con "alonso" en nombre (diagnóstico extra) ===`)
    ventusCheck.forEach(p => console.log(`  ${p.id}: ${JSON.stringify(p.nombre)}`))
    console.log(`  stripJugador de cada una:`)
    ventusCheck.forEach(p => console.log(`    "${p.nombre}" → "${stripJugador(p.nombre)}"`))
  }

  console.log(`\n=== Palas con jugador en nombre: ${[...grupos.values()].flat().length} en ${grupos.size} grupos ===`)

  const slugsUsados = new Set(palas.map(p => p.slug))

  for (const [clave, grupo] of grupos) {
    const [nombreLimpio] = clave.split('|')
    console.log(`\nGrupo "${nombreLimpio}" (${grupo.length} entradas):`)
    for (const p of grupo) console.log(`  • ${p.id}: ${p.nombre}`)

    if (!FIX) continue

    // Buscar si ya existe una pala con ese nombre limpio
    const baseExistente = palas.find(p =>
      !grupo.some(g => g.id === p.id) &&
      normalizar(p.nombre) === nombreLimpio
    )

    if (baseExistente) {
      // Ya existe la base limpia → migrar todos los del grupo a la base
      console.log(`  ✅ Base ya existe: ${baseExistente.id}: ${baseExistente.nombre}`)
      for (const p of grupo) await migrarYBorrar(p, baseExistente)
    } else if (grupo.length === 1) {
      // Un solo duplicado → renombrar
      const p = grupo[0]
      const stripped = stripJugador(p.nombre)
      await renombrar(p, stripped, slugsUsados)
      await agregarAlias(p.id, p.nombre)
    } else {
      // Múltiples duplicados que colapsan al mismo nombre → el primero es canónico, los demás se fusionan
      const [canonico, ...resto] = grupo
      const stripped = stripJugador(canonico.nombre)
      await renombrar(canonico, stripped, slugsUsados)
      await agregarAlias(canonico.id, canonico.nombre)
      for (const p of resto) {
        await migrarYBorrar(p, { ...canonico, nombre: stripped })
      }
    }
  }

  // ── Cerrar candidatas ambiguas/pendientes ──────────────────────────────────
  if (FIX && cands?.length) {
    console.log(`\n=== Cerrando ${cands.length} candidatas ambiguas/pendientes ===`)
    const palasActualizadas = (await sb.from('palas').select('id, nombre')).data ?? []

    for (const c of cands) {
      const tituloNorm    = normalizar(c.titulo)
      const tituloStrip   = normalizar(stripJugador(c.titulo))
      // versión sin año: permite matchear cuando el año está en posición distinta
      const sinAño        = (s: string) => s.replace(/\b20\d{2}\b/g, '').replace(/\s+/g, ' ').trim()
      const tituloSinAño  = sinAño(tituloStrip)

      // Buscar pala por título normalizado (exacto o sin jugador, o sin año)
      let pala = palasActualizadas.find(p => normalizar(p.nombre) === tituloNorm)
             ?? palasActualizadas.find(p => normalizar(p.nombre) === tituloStrip)
             ?? palasActualizadas.find(p => sinAño(normalizar(p.nombre)) === tituloSinAño)

      // Buscar por alias (exacto y sin año)
      if (!pala) {
        const { data: alias } = await sb.from('producto_aliases')
          .select('pala_id').eq('texto_normalizado', tituloNorm).limit(1)
        if (alias?.[0]) {
          const { data: pa } = await sb.from('palas').select('id, nombre').eq('id', alias[0].pala_id).single()
          pala = pa ?? undefined
        }
      }
      if (!pala) {
        // Último recurso: candidatos_ids guardados en datos_extraidos cuando se marcó como ambiguo
        const ids: string[] = c.datos_extraidos?.candidatos_ids ?? []
        if (ids.length > 0) {
          const existente = palasActualizadas.find(p => ids.includes(p.id))
          if (existente) pala = existente
        }
      }

      if (pala) {
        console.log(`  ✅ Cerrando "${c.titulo}" → ${pala.id}: ${pala.nombre}`)
        await sb.from('palas_candidatas').update({
          estado:          'matched',
          revisada_at:     new Date().toISOString(),
          datos_extraidos: { ...c.datos_extraidos, pala_id_promovida: pala.id, resuelto_por: 'fix-duplicados' },
        }).eq('id', c.id)
      } else {
        console.log(`  ⚠️  Sin match para "${c.titulo}" — revisar`)
      }
    }
  }

  if (!FIX) console.log(`\n➡️  Ejecuta con --fix para aplicar`)
}

async function renombrar(p: any, nuevoNombre: string, slugsUsados: Set<string>) {
  const nombreUpper = nuevoNombre.toUpperCase()
  let slug = slugify(nuevoNombre)
  if (slugsUsados.has(slug)) {
    let i = 2; while (slugsUsados.has(`${slug}-${i}`)) i++; slug = `${slug}-${i}`
  }
  slugsUsados.add(slug)
  console.log(`  ✏️  Renombrando: "${p.nombre}" → "${nombreUpper}"`)
  const { error } = await sb.from('palas').update({ nombre: nombreUpper, slug }).eq('id', p.id)
  if (error) console.log(`    ❌ ${error.message}`)
  else console.log(`    ✅ OK`)
}

async function agregarAlias(palaId: string, nombreOriginal: string) {
  const { error } = await sb.from('producto_aliases').upsert({
    pala_id:           palaId,
    texto_original:    nombreOriginal,
    texto_normalizado: normalizar(nombreOriginal),
    tienda:            'catalogo',
    confianza:         1.0,
  }, { onConflict: 'texto_normalizado,tienda' })
  if (error) console.log(`    ❌ Alias: ${error.message}`)
  else console.log(`    ✅ Alias "${nombreOriginal}" guardado`)
}

async function migrarYBorrar(duplicado: any, base: any) {
  console.log(`  🔀 Migrando ${duplicado.id} (${duplicado.nombre}) → ${base.id}`)

  const { error: e1 } = await sb.from('price_snapshots').update({ pala_id: base.id }).eq('pala_id', duplicado.id)
  if (e1) { console.log(`    ❌ Snapshots: ${e1.message}`); return }

  const { error: e2 } = await sb.from('producto_aliases').update({ pala_id: base.id }).eq('pala_id', duplicado.id)
  if (e2) { console.log(`    ❌ Aliases: ${e2.message}`); return }

  // Añadir el nombre original como alias apuntando a la base
  await agregarAlias(base.id, duplicado.nombre)

  await sb.from('palas_candidatas').update({
    estado: 'matched',
    revisada_at: new Date().toISOString(),
    datos_extraidos: { pala_id_promovida: base.id, resuelto_por: 'fix-duplicados' },
  }).contains('datos_extraidos', { pala_id_promovida: duplicado.id })

  const { error: e3 } = await sb.from('palas').delete().eq('id', duplicado.id)
  if (e3) { console.log(`    ❌ Delete: ${e3.message}`); return }
  console.log(`    ✅ Eliminado`)
}

main().catch(console.error)
