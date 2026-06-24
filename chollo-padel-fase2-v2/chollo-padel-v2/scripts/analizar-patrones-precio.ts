/**
 * scripts/analizar-patrones-precio.ts
 * =============================================================================
 * Analiza price_history_log (histórico insert-only, ver migración
 * "create_price_history_log" 2026-06-24) para detectar, por tienda, si hay
 * franjas horarias o días de la semana donde los precios bajan con más
 * frecuencia. El resultado se guarda en price_patterns_summary (1 fila por
 * tienda y ejecución) y se imprime un resumen legible en consola.
 *
 * IMPORTANTE: price_history_log empezó a poblarse el 2026-06-24. Con pocos
 * días de datos cualquier "patrón" es ruido — el campo `confiable` solo se
 * marca true si hay >= 14 días distintos cubiertos para esa tienda. No tiene
 * sentido tomar decisiones de scheduling con `confiable: false`.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/analizar-patrones-precio.ts
 *   npx tsx --env-file=.env.local scripts/analizar-patrones-precio.ts --tienda futurapadelshop
 * =============================================================================
 */

import { createClient } from '@supabase/supabase-js'

try { require('dotenv').config({ path: '.env.local' }) } catch (_) {}

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

const MIN_DIAS_CONFIABLE = 14

const argTienda = (() => {
  const i = process.argv.indexOf('--tienda')
  return i >= 0 ? process.argv[i + 1] : null
})()

interface FilaHistorial {
  pala_id: string
  precio: number
  scraped_at: string
}

// Madrid está en UTC+1 (invierno) / UTC+2 (verano). Para "hora del día" en
// la que el USUARIO ve cambios de precio, lo correcto es la hora local de
// España, no UTC. new Date().toLocaleString con timeZone hace la conversión
// sin depender de librerías externas.
function horaLocalMadrid(iso: string): number {
  const d = new Date(iso)
  const hora = d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false })
  return parseInt(hora, 10) % 24
}

function diaSemanaLocalMadrid(iso: string): number {
  // 0 = domingo .. 6 = sábado (igual que Date#getDay)
  const d = new Date(iso)
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', weekday: 'short' }).format(d)
  const mapa: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return mapa[partes] ?? 0
}

async function fetchHistorialFuente(sourceId: number): Promise<FilaHistorial[]> {
  const PAGE = 1000
  let offset = 0
  const out: FilaHistorial[] = []
  while (true) {
    const { data, error } = await supabase
      .from('price_history_log')
      .select('pala_id,precio,scraped_at')
      .eq('source_id', sourceId)
      .order('pala_id', { ascending: true })
      .order('scraped_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`price_history_log (source_id=${sourceId}): ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return out
}

function analizarFuente(filas: FilaHistorial[]) {
  const porHora: Record<number, number> = {}
  const porDia: Record<number, number> = {}
  let bajadas = 0

  // Agrupar por pala_id, ya viene ordenado por scraped_at ASC dentro de cada
  // pala_id gracias al .order() doble de la query.
  const porPala = new Map<string, FilaHistorial[]>()
  for (const f of filas) {
    if (!porPala.has(f.pala_id)) porPala.set(f.pala_id, [])
    porPala.get(f.pala_id)!.push(f)
  }

  for (const serie of porPala.values()) {
    for (let i = 1; i < serie.length; i++) {
      const anterior = serie[i - 1]
      const actual = serie[i]
      if (actual.precio < anterior.precio) {
        bajadas++
        const h = horaLocalMadrid(actual.scraped_at)
        const d = diaSemanaLocalMadrid(actual.scraped_at)
        porHora[h] = (porHora[h] ?? 0) + 1
        porDia[d] = (porDia[d] ?? 0) + 1
      }
    }
  }

  const diasCubiertos = new Set(filas.map(f => f.scraped_at.slice(0, 10))).size
  const totalProductos = porPala.size

  const horaTop = Object.entries(porHora).sort((a, b) => b[1] - a[1])[0]
  const diaTop = Object.entries(porDia).sort((a, b) => b[1] - a[1])[0]

  return {
    totalObservaciones: filas.length,
    totalProductos,
    diasCubiertos,
    bajadas,
    porHora,
    porDia,
    horaTop: horaTop ? parseInt(horaTop[0], 10) : null,
    diaTop: diaTop ? parseInt(diaTop[0], 10) : null,
  }
}

const NOMBRES_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

async function main() {
  let q = supabase.from('price_sources').select('id,slug,activa').eq('activa', true)
  if (argTienda) q = q.eq('slug', argTienda)
  const { data: fuentes, error } = await q
  if (error) throw new Error(`price_sources: ${error.message}`)
  if (!fuentes || fuentes.length === 0) {
    console.log('No hay tiendas activas que analizar.')
    return
  }

  console.log(`Analizando ${fuentes.length} tienda(s)…\n`)

  for (const fuente of fuentes) {
    const filas = await fetchHistorialFuente(fuente.id)
    if (filas.length === 0) {
      console.log(`[${fuente.slug}] sin datos en price_history_log todavía — se omite.`)
      continue
    }

    const r = analizarFuente(filas)
    const confiable = r.diasCubiertos >= MIN_DIAS_CONFIABLE
    const nota = confiable
      ? null
      : `Solo ${r.diasCubiertos} día(s) de histórico — hacen falta ≥${MIN_DIAS_CONFIABLE} para que el patrón sea fiable.`

    console.log(`[${fuente.slug}]`)
    console.log(`  Observaciones: ${r.totalObservaciones} · Productos: ${r.totalProductos} · Días cubiertos: ${r.diasCubiertos}`)
    console.log(`  Bajadas de precio detectadas: ${r.bajadas}`)
    if (r.horaTop !== null) console.log(`  Hora más frecuente de bajada: ${r.horaTop}:00 (hora España)`)
    if (r.diaTop !== null) console.log(`  Día más frecuente de bajada: ${NOMBRES_DIA[r.diaTop]}`)
    console.log(`  Fiable: ${confiable ? 'sí' : 'no'}${nota ? ` — ${nota}` : ''}`)
    console.log('')

    const { error: errInsert } = await supabase.from('price_patterns_summary').insert({
      source_id: fuente.id,
      source_slug: fuente.slug,
      total_observaciones: r.totalObservaciones,
      total_productos: r.totalProductos,
      dias_cubiertos: r.diasCubiertos,
      bajadas_detectadas: r.bajadas,
      patron_hora: r.porHora,
      patron_dia_semana: r.porDia,
      hora_mas_frecuente: r.horaTop,
      dia_mas_frecuente: r.diaTop,
      confiable,
      nota,
    })
    if (errInsert) console.error(`  ⚠️  No se pudo guardar el resumen de ${fuente.slug}: ${errInsert.message}`)
  }
}

main().catch(err => {
  console.error('❌', err)
  process.exit(1)
})
