/**
 * scripts/limpiar-duplicados-catalogo.ts
 * =============================================================================
 * Detecta duplicados REALES en `palas` usando la misma lógica de atributos
 * (marca+linea+variante+modelo+año) que ya usa pipeline-tiendas.ts y
 * auto-promote-candidatas.ts — NO usa fuzzy de nombre (token_set_ratio), que es
 * lo que generaba falsos positivos en GestorCandidatas (ej. "Valkiria" vs
 * "Valkiria 2", "RX Series Lime" vs "RX Series Red").
 *
 * Motivo (2026-06-21): GestorCandidatas marca 161 pares como "sospechosos" pero
 * mezclando duplicados reales (mismo producto, fila repetida sin datos) con
 * productos genuinamente distintos (colores, generaciones, ediciones firma).
 * Revisarlos 161 a mano es inviable. Este script usa el comprobador de
 * atributos ya probado para separar:
 *   - DUPLICADO_SEGURO: mismo marca+linea+variante y modeloCompatible()=true
 *     en ambas direcciones, Y uno de los dos lados está VACÍO (0 aliases,
 *     0 price_snapshots, 0 wallapop_cache) → se borra el vacío sin perder nada.
 *   - REQUIERE_MERGE: igual que arriba pero AMBOS lados tienen datos →
 *     no se puede borrar a ciegas (se perderían precios/alias), hay que
 *     fusionar en GestorCandidatas (pero ya con confianza de que es duplicado
 *     real, no falso positivo).
 *   - NO_ES_DUPLICADO: modeloCompatible()=false → son productos distintos,
 *     se descartan del problema (aunque el Gestor los siga marcando).
 *
 * Fix real 2026-06-23 (barrido completo: Adidas Metalbone, Vibor-A, Drop Shot,
 * Wilson): el pase de arriba (variante exacta + modeloCompatible) tiene un
 * punto ciego estructural — si el extractor reparte las MISMAS palabras de
 * forma distinta entre `modelo` y `variante` según el título exacto de cada
 * tienda (ej. "CTRL CARBON" → modelo=CTRL/variante=CARBON en una tienda,
 * "Carbon Control" → modelo=Carbon/variante=CTRL en otra), la condición
 * `normalizarVariante(a.variante) === normalizarVariante(b.variante)` nunca
 * se cumple y el par ni se evalúa. Se añade un SEGUNDO pase con
 * firmaProducto() (modelo-matching.ts): combina modelo+variante en una sola
 * bolsa de tokens y compara esa bolsa completa en vez de exigir que la
 * variante caiga en el mismo campo — detecta el mismo problema de fondo sin
 * importar cuál futuro bug de parseo concreto lo cause.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/limpiar-duplicados-catalogo.ts            # dry-run (default)
 *   npx tsx --env-file=.env.local scripts/limpiar-duplicados-catalogo.ts --ejecutar # borra los DUPLICADO_SEGURO
 * =============================================================================
 */

import { createClient } from '@supabase/supabase-js'
import { normalizarLinea, normalizarVariante, modeloCompatible, firmaProducto, type PalaCandidata } from './lib/modelo-matching'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const EJECUTAR = process.argv.includes('--ejecutar')

interface Pala extends PalaCandidata {
  nombre: string | null
  fuente: string | null
}

// Bug real 2026-06-21 (gordo): el cliente JS de Supabase trunca CUALQUIER
// select() a 1000 filas por defecto si no se pagina con .range(). Las 5
// tablas que toca este script tienen TODAS más de 1000 filas (palas: 2283,
// producto_aliases: 5858, price_snapshots: 7450, wallapop_cache: 4555,
// price_reference: 1454) — es decir, el script lleva todo este tiempo
// comparando solo un subconjunto arbitrario del catálogo y dando falsos
// "vacía" para filas cuyos datos relacionados caían fuera de las primeras
// 1000. Fix: traer todas las filas en páginas de 1000 hasta vaciar la tabla.
async function fetchAll<T = any>(tabla: string, columnas: string): Promise<T[]> {
  const out: T[] = []
  let desde = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase.from(tabla).select(columnas).range(desde, desde + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    out.push(...(data as T[]))
    if (data.length < PAGE) break
    desde += PAGE
  }
  return out
}

async function main() {
  const palas = await fetchAll<Pala>('palas', 'id, nombre, marca, linea, modelo, variante, año, fuente')

  const aliasRows = await fetchAll<{ pala_id: string }>('producto_aliases', 'pala_id')
  const snapRows = await fetchAll<{ pala_id: string }>('price_snapshots', 'pala_id')
  const wallaRows = await fetchAll<{ pala_id: string }>('wallapop_cache', 'pala_id')
  // price_reference es DISTINTA de price_snapshots y tiene su propia FK hacia
  // palas — al borrar una fila marcada "vacía" que en realidad tenía una fila
  // ahí, Supabase rechazaba el DELETE por price_reference_pala_id_fkey.
  const priceRefRows = await fetchAll<{ pala_id: string }>('price_reference', 'pala_id')

  const conAlias = new Set(aliasRows.map(r => r.pala_id))
  const conSnap = new Set(snapRows.map(r => r.pala_id))
  const conWalla = new Set(wallaRows.map(r => r.pala_id))
  const conPriceRef = new Set(priceRefRows.map(r => r.pala_id))

  const vacia = (id: string) => !conAlias.has(id) && !conSnap.has(id) && !conWalla.has(id) && !conPriceRef.has(id)

  // Agrupar por marca + linea normalizada
  const grupos = new Map<string, Pala[]>()
  for (const p of (palas as Pala[])) {
    if (!p.marca || !p.linea) continue
    const clave = `${p.marca.toLowerCase()}|${(normalizarLinea(p.linea) ?? '').toLowerCase()}`
    if (!grupos.has(clave)) grupos.set(clave, [])
    grupos.get(clave)!.push(p)
  }

  let duplicadoSeguro: { borrar: Pala; conservar: Pala }[] = []
  let requiereMerge: { a: Pala; b: Pala }[] = []
  const yaProcesados = new Set<string>()

  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue
    for (let i = 0; i < grupo.length; i++) {
      for (let j = i + 1; j < grupo.length; j++) {
        const a = grupo[i], b = grupo[j]
        const parKey = [a.id, b.id].sort().join('|')
        if (yaProcesados.has(parKey)) continue

        const añoCompatible = !a.año || !b.año || a.año === b.año
        if (!añoCompatible) continue

        const variantesCoinciden = normalizarVariante(a.variante) === normalizarVariante(b.variante)
        const esDuplicadoPase1 = variantesCoinciden
          && modeloCompatible(a.modelo, b.modelo, a.año, b.año)
          && modeloCompatible(b.modelo, a.modelo, b.año, a.año)

        // Pase 2 (fix 2026-06-23): mismo producto con las palabras repartidas
        // de otra forma entre modelo/variante — ver comentario de cabecera.
        const firmaA = firmaProducto(a.modelo, a.variante)
        const firmaB = firmaProducto(b.modelo, b.variante)
        const esDuplicadoPase2 = firmaA !== '' && firmaA === firmaB

        if (!esDuplicadoPase1 && !esDuplicadoPase2) continue // productos distintos (ej. colores, generaciones) — NO tocar

        yaProcesados.add(parKey)
        const aVacia = vacia(a.id), bVacia = vacia(b.id)
        if (aVacia && !bVacia) duplicadoSeguro.push({ borrar: a, conservar: b })
        else if (bVacia && !aVacia) duplicadoSeguro.push({ borrar: b, conservar: a })
        else if (aVacia && bVacia) duplicadoSeguro.push({ borrar: b, conservar: a }) // ambas vacías, da igual cual
        else requiereMerge.push({ a, b })
      }
    }
  }

  console.log(`\n[limpiar-duplicados] DUPLICADO_SEGURO (borrar sin perder datos): ${duplicadoSeguro.length}`)
  for (const d of duplicadoSeguro) {
    console.log(`  🗑️  "${d.borrar.nombre}" (${d.borrar.id}) → ya existe "${d.conservar.nombre}" (${d.conservar.id})`)
  }
  console.log(`\n[limpiar-duplicados] REQUIERE_MERGE (ambos lados tienen datos, fusionar en Gestor): ${requiereMerge.length}`)
  for (const r of requiereMerge) {
    console.log(`  🔀 "${r.a.nombre}" (${r.a.id}) ⇄ "${r.b.nombre}" (${r.b.id})`)
  }

  if (EJECUTAR && duplicadoSeguro.length > 0) {
    const ids = duplicadoSeguro.map(d => d.borrar.id)
    const { error: delError } = await supabase.from('palas').delete().in('id', ids)
    if (delError) {
      console.error('[limpiar-duplicados] Error borrando:', delError.message)
    } else {
      console.log(`\n[limpiar-duplicados] ✅ Borradas ${ids.length} filas duplicadas vacías.`)
    }
  } else if (!EJECUTAR) {
    console.log('\n[limpiar-duplicados] DRY RUN — relanza con --ejecutar para borrar los DUPLICADO_SEGURO.')
  }
}

main().catch(err => {
  console.error('[limpiar-duplicados] Error fatal:', err)
  process.exit(1)
})
