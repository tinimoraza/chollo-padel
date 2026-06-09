/**
 * scripts/detectar-duplicados.ts
 * =============================================================================
 * Detecta palas duplicadas en el catálogo y propone cuál conservar.
 *
 * Criterio de duplicado: mismo marca + linea + modelo + variante + año
 * (todos en lowercase para comparar).
 *
 * El script NUNCA borra nada — solo reporta. Para limpiar, se genera un
 * fichero SQL con los DELETE/UPDATE listos para revisar y aplicar a mano.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/detectar-duplicados.ts
 *   npx tsx --env-file=.env.local scripts/detectar-duplicados.ts --sql
 *     (genera duplicados-a-limpiar.sql para revisar antes de ejecutar)
 * =============================================================================
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { join } from 'path'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const GENERAR_SQL = process.argv.includes('--sql')

// ─── Normalización (igual que fix-duplicados.js) ──────────────────────────────

const JUGADOR_TOKENS = new Set([
  'ale','galan','galán','juan','lebron','lebrón',
  'arturo','coello','agustin','agustín','tapia',
  'martita','marta','ortega',
  'paquito','pablo','cardona','navarro',
  'tello','alex','ruiz','momo','gonzalez','gonzález','chingotto',
  'franco','stupa','edu','alonso','coki','nieto',
  'gemma','triay','mapi','sanchez','sánchez',
  'carolina','lucia','lucía','sainz',
  'bea','ari','ariana',
  'tino','libaak','aranzazu','osoro',
  'leo','augsburger','miguel','lamperti',
  'jon','sanz','dal','bianco',
  'martin','martín','di','nenno',
  'moyano','yanguas',
  'by',
])

function normStr(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function normCampo(s: string | null): string {
  if (!s) return ''
  return normStr(s)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .split(' ')
    .filter(w => w.length > 0 && !JUGADOR_TOKENS.has(w))
    .join(' ')
}

function claveNorm(p: any): string {
  const marca    = normCampo(p.marca)
  const linea    = normCampo(p.linea)
  const modelo   = normCampo(p.modelo)
  const variante = normCampo(p.variante)
  if (!marca || !linea) return ''
  const año = p.año ?? 0
  return `${marca}|${linea}|${modelo}|${variante}|${año}`
}

// ─── Lógica de "qué pala conservar" ──────────────────────────────────────────
// Prioridad de fuente: padelful > padelzoom > padelnuestro > revision_manual > resto
const FUENTE_PRIORIDAD: Record<string, number> = {
  'padelful':       1,
  'padelzoom':      2,
  'padelnuestro':   3,
  'revision_manual': 4,
}

function prioridadFuente(fuente: string | null): number {
  return FUENTE_PRIORIDAD[fuente ?? ''] ?? 99
}

function elegirCanonica(grupo: any[]): { conservar: any; borrar: any[] } {
  // Ordenar: menor prioridad primero (padelful gana), luego la que tenga imagen real
  const ordenado = [...grupo].sort((a, b) => {
    const pA = prioridadFuente(a.fuente)
    const pB = prioridadFuente(b.fuente)
    if (pA !== pB) return pA - pB
    // Misma fuente: preferir la que tiene imagen real
    const imgA = !a.imagen_url || a.imagen_url.startsWith('data:') ? 1 : 0
    const imgB = !b.imagen_url || b.imagen_url.startsWith('data:') ? 1 : 0
    return imgA - imgB
  })
  return { conservar: ordenado[0], borrar: ordenado.slice(1) }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'─'.repeat(60)}`)
  console.log('  detectar-duplicados.ts')
  console.log(`${'─'.repeat(60)}\n`)

  // Cargar todas las palas paginando (Supabase limita a 1000 por petición)
  const PAGE = 1000
  let todas: any[] = [], from = 0
  while (true) {
    const { data, error } = await supabase
      .from('palas')
      .select('id, nombre, slug, marca, linea, modelo, variante, año, fuente, imagen_url, created_at')
      .order('marca').order('linea').order('año')
      .range(from, from + PAGE - 1)
    if (error) throw error
    todas = todas.concat(data ?? [])
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  console.log(`   Total palas cargadas: ${todas.length}`)

  // Agrupar por clave normalizada (quita jugadores, conserva año)
  const map = new Map<string, any[]>()
  for (const p of todas) {
    const clave = claveNorm(p)
    if (!clave) continue
    if (!map.has(clave)) map.set(clave, [])
    map.get(clave)!.push(p)
  }

  // Fase 2: año=null → fusionar con grupo del mismo modelo+variante con año real
  for (const [clave, grupo] of [...map.entries()]) {
    if (!clave.endsWith('|0')) continue
    const [m, l, mo, v] = clave.split('|')
    for (const [clave2] of [...map.entries()]) {
      if (clave2 === clave) continue
      const [m2, l2, mo2, v2, a2] = clave2.split('|')
      if (m===m2 && l===l2 && mo===mo2 && v===v2 && /^\d+$/.test(a2) && a2!=='0') {
        map.get(clave2)!.push(...grupo)
        map.delete(clave)
        break
      }
    }
  }

  // Fase 3: modelo-subconjunto (ej: "GENIUS 12K" ⊆ "Genius 12K Alum")
  const entradas = [...map.entries()]
  const eliminadas = new Set<string>()
  for (let i = 0; i < entradas.length; i++) {
    if (eliminadas.has(entradas[i][0])) continue
    const [c1, g1] = entradas[i]
    const [m1, l1, mo1, v1, a1] = c1.split('|')
    for (let j = i + 1; j < entradas.length; j++) {
      if (eliminadas.has(entradas[j][0])) continue
      const [c2, g2] = entradas[j]
      const [m2, l2, mo2, v2, a2] = c2.split('|')
      if (m1!==m2 || l1!==l2 || v1!==v2 || a1!==a2) continue
      const t1 = mo1.split(' ').filter(Boolean)
      const t2 = mo2.split(' ').filter(Boolean)
      const [shortTok, shortKey, shortGrp, longKey] =
        t1.length <= t2.length ? [t1, c1, g1, c2] : [t2, c2, g2, c1]
      const longTok = longKey === c2 ? t2 : t1
      if (shortTok.length > 0 && shortTok.every((t: string) => longTok.includes(t))) {
        map.get(longKey)!.push(...shortGrp)
        map.delete(shortKey)
        eliminadas.add(shortKey)
      }
    }
  }

  const duplicados = [...map.values()].filter(g => g.length > 1)

  if (duplicados.length === 0) {
    console.log('✅ No se detectaron duplicados.\n')
    return
  }

  console.log(`⚠️  Grupos con duplicados: ${duplicados.length}`)
  console.log(`   Total palas a borrar: ${duplicados.reduce((acc, g) => acc + g.length - 1, 0)}\n`)

  const sqlLineas: string[] = [
    '-- Duplicados detectados por detectar-duplicados.ts',
    `-- Generado: ${new Date().toISOString()}`,
    '-- REVISAR ANTES DE EJECUTAR',
    '',
  ]

  for (const grupo of duplicados) {
    const { conservar, borrar } = elegirCanonica(grupo)

    console.log(`  📌 CONSERVAR: [${conservar.fuente ?? '?'}] ${conservar.nombre}  (${conservar.id})`)
    for (const b of borrar) {
      console.log(`     🗑️  BORRAR:    [${b.fuente ?? '?'}] ${b.nombre}  (${b.id})`)
    }
    console.log()

    if (GENERAR_SQL) {
      sqlLineas.push(`-- ${conservar.nombre}`)
      sqlLineas.push(`-- Conservar: ${conservar.id} [${conservar.fuente}]`)
      for (const b of borrar) {
        sqlLineas.push(`-- Borrar:    ${b.id} [${b.fuente}] ${b.nombre}`)
        // Redirigir price_snapshots y aliases al canónico antes de borrar
        sqlLineas.push(`UPDATE price_snapshots SET pala_id = '${conservar.id}' WHERE pala_id = '${b.id}';`)
        sqlLineas.push(`UPDATE producto_aliases  SET pala_id = '${conservar.id}' WHERE pala_id = '${b.id}';`)
        sqlLineas.push(`DELETE FROM palas WHERE id = '${b.id}';`)
      }
      sqlLineas.push('')
    }
  }

  if (GENERAR_SQL) {
    const outPath = join(process.cwd(), 'duplicados-a-limpiar.sql')
    writeFileSync(outPath, sqlLineas.join('\n'), 'utf-8')
    console.log(`📄 SQL generado en: duplicados-a-limpiar.sql`)
    console.log('   Revísalo con calma y ejecuta en Supabase cuando estés segura.\n')
  } else {
    console.log('ℹ️  Ejecuta con --sql para generar el fichero SQL de limpieza.\n')
  }
}

main().catch(err => {
  console.error('\n💥 Error fatal:', err)
  process.exit(1)
})
