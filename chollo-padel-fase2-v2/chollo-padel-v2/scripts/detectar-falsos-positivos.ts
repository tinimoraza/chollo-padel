/**
 * scripts/detectar-falsos-positivos.ts
 * =============================================================================
 * "Sistema de detección de falsos positivos" pedido tras el caso Adidas Adipower
 * CTRL 3.0 (streetpadel) que matcheó contra la pala "3.3" del catálogo.
 *
 * Recorre producto_aliases ↔ palas buscando contradicciones entre el texto
 * original de la tienda y la pala a la que quedó asociado el alias. Solo
 * REPORTA — no borra ni repunta nada automáticamente. Revisar cada fila a
 * mano (algunas son ruido del heurístico, ej. "Head Extreme" contiene la
 * subcadena "xtrem") y aplicar el fix en BD caso a caso.
 *
 * Patrones detectados:
 *   1. Versión decimal distinta   → alias "3.0" vs pala modelo "3.3"
 *   2. Variante de peso distinta  → alias "18K" vs pala nombre "12K" (o viceversa)
 *   3. Lite vs no-Lite            → alias "... Lite ..." vs pala sin "lite" (o viceversa)
 *   4. Marca distinta             → alias menciona una marca que no es la de la pala
 *   5. Año/generación distinto    → alias contiene un año 20xx que no coincide con pala.año
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/detectar-falsos-positivos.ts
 *
 * Recomendado: correrlo periódicamente (a mano o vía scheduled task) después
 * de cada pipeline de scraping, ya que cualquier tienda nueva puede introducir
 * el mismo tipo de mezcla que el caso Adidas/AT10.
 * =============================================================================
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const MARCAS = [
  'Adidas', 'Bullpadel', 'Siux', 'Nox', 'Drop Shot', 'StarVie', 'Head',
  'Dunlop', 'Vibor-A', 'Enebe', 'Wilson', 'Babolat', 'Royal Padel', 'Varlion',
  'Black Crown', 'Oxdog', 'Kombat', 'Softee', 'Joma', 'Akkeron', 'Kuikma',
  'Puma', 'Lok', 'Tecnifibre', 'Alkemia', 'Vairo', 'Harlem', 'Legend',
  'J-Hayber', 'Prince', 'Mystica', 'Slazenger', 'Asics', 'K-Swiss', 'Munich',
]

function marcaRegex(marca: string): RegExp {
  switch (marca) {
    case 'Vibor-A':     return /vibor.?a/i
    case 'Drop Shot':   return /drop.?shot/i
    case 'Black Crown': return /black.?crown/i
    case 'StarVie':     return /star.?vie/i
    case 'Royal Padel': return /royal.?padel/i
    case 'J-Hayber':    return /j.?hayber/i
    case 'K-Swiss':     return /k.?swiss/i
    default:            return new RegExp(`\\b${marca}\\b`, 'i')
  }
}

type Alias = {
  id: string
  pala_id: string
  tienda: string
  texto_original: string
  created_at: string
  palas: { nombre: string; marca: string; modelo: string | null; año: number | null } | null
}

async function cargarAliases(): Promise<Alias[]> {
  const PAGE = 1000
  let todos: Alias[] = [], from = 0
  while (true) {
    const { data, error } = await supabase
      .from('producto_aliases')
      .select('id, pala_id, tienda, texto_original, created_at, palas(nombre, marca, modelo, año)')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) throw error
    todos = todos.concat((data ?? []) as any)
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return todos
}

function kClass(s: string): string | null {
  const m = s.match(/\b(\d{1,2}k)\b/i)
  return m ? m[1].toLowerCase() : null
}

function añoMencionado(s: string): number | null {
  const m = s.match(/\b(20[1-3]\d)\b/)
  return m ? parseInt(m[1]) : null
}

function tieneLite(s: string): boolean {
  return /\blite\b/i.test(s)
}

async function main() {
  console.log(`\n${'─'.repeat(70)}`)
  console.log('  detectar-falsos-positivos.ts')
  console.log(`${'─'.repeat(70)}\n`)

  const aliases = await cargarAliases()
  console.log(`   Total aliases cargados: ${aliases.length}\n`)

  const hallazgos: { tipo: string; alias: Alias }[] = []

  for (const a of aliases) {
    const p = a.palas
    if (!p) continue
    const texto = a.texto_original

    // 1. Versión decimal distinta (3.0 vs 3.3)
    const vAlias = texto.match(/\b(\d+\.\d+)\b/)?.[1]
    const vPala  = (p.modelo ?? '').match(/\b(\d+\.\d+)\b/)?.[1]
    if (vAlias && vPala && vAlias !== vPala) {
      hallazgos.push({ tipo: `versión decimal: alias=${vAlias} pala=${vPala}`, alias: a })
      continue
    }

    // 2. Variante de peso (12K vs 18K vs ...)
    const kAlias = kClass(texto)
    const kPala  = kClass(p.nombre)
    if (kAlias && kPala && kAlias !== kPala) {
      hallazgos.push({ tipo: `peso distinto: alias=${kAlias} pala=${kPala}`, alias: a })
      continue
    }

    // 3. Lite vs no-Lite
    if (tieneLite(texto) !== tieneLite(p.nombre)) {
      hallazgos.push({ tipo: `lite: alias=${tieneLite(texto)} pala=${tieneLite(p.nombre)}`, alias: a })
      continue
    }

    // 4. Marca mencionada distinta a la de la pala
    const marcaDistinta = MARCAS.find(m => m !== p.marca && marcaRegex(m).test(texto))
    if (marcaDistinta) {
      hallazgos.push({ tipo: `marca mencionada=${marcaDistinta} pala.marca=${p.marca}`, alias: a })
      continue
    }

    // 5. Año mencionado distinto al de la pala
    const añoAlias = añoMencionado(texto)
    if (añoAlias && p.año && añoAlias !== p.año) {
      hallazgos.push({ tipo: `año: alias=${añoAlias} pala.año=${p.año}`, alias: a })
      continue
    }
  }

  if (hallazgos.length === 0) {
    console.log('   ✅ No se han detectado falsos positivos con los patrones actuales.\n')
    return
  }

  console.log(`   ⚠️  ${hallazgos.length} posibles falsos positivos:\n`)
  for (const h of hallazgos) {
    console.log(`   [${h.tipo}]`)
    console.log(`     alias_id: ${h.alias.id}  pala_id: ${h.alias.pala_id}  tienda: ${h.alias.tienda}`)
    console.log(`     texto_original: "${h.alias.texto_original}"`)
    console.log(`     pala: "${h.alias.palas?.nombre}"`)
    console.log('')
  }
  console.log('   Revisar cada fila a mano antes de actuar — el heurístico genera')
  console.log('   algún falso positivo propio (ej. "xtrem" dentro de "extreme").\n')
}

main().catch(err => {
  console.error('Error fatal:', err)
  process.exit(1)
})
