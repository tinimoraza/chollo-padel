/**
 * scripts/match-pala-id.ts
 * ===========================================
 * Cruza los anuncios de wallapop_cache (pala_id = null) contra
 * la tabla palas del catálogo e intenta asignar el pala_id correcto.
 *
 * Estrategia de matching:
 *  1. Filtra candidatos por marca (campo marca en wallapop_cache, o detectada del título)
 *  2. Extrae tokens del modelo del catálogo (sin marca ni año)
 *  3. Comprueba que TODOS los tokens aparecen en el título del anuncio
 *  4. Si el título contiene un token diferenciador (hrd, team, ctrl…) y hay candidatos
 *     que NO lo requieren compitiendo con los que SÍ → descarta los que no lo requieren
 *  5. Si hay año en el título, debe coincidir con el año del catálogo
 *  6. Si hay un único match → asigna pala_id
 *     Si hay varios matches → elige el de más tokens (más específico)
 *     Si hay empate → no asigna (ambiguo)
 *
 * v17 (2026-05-31):
 *  - tokenizar: normaliza "c.6"/"c 6" → "c6" (Nox X-One C.6 se escribía con punto en Vinted)
 *  - KEEP_WORDS + TOKENS_DIFERENCIADORES: añadido "c6"
 *    Fix: anuncios "Nox X-One C.6" se asignaban a "Nox X-One 2025" en vez de "Nox X-One C6 2023"
 *
 * v16 (2026-05-26):
 *  - KEEP_WORDS: añadidos colores (black, blue, grey, white, red, green, orange, pink, yellow, purple, gold, silver, navy, lime)
 *    Problema: "Adidas Drive Black 2026" y "Adidas Drive Blue 2026" eran indistinguibles
 *    porque los colores no estaban en KEEP_WORDS → tokenizador los descartaba.
 *    Con este fix los colores se preservan y actúan como tokens diferenciadores.
 *  - TOKENS_DIFERENCIADORES: mismos colores añadidos.
 *    Efecto: "Drive Black" matchea solo con "Drive Black", no con "Drive Blue".
 *
 * v15 (2026-05-25):
 *  - MARCAS_CONOCIDAS: eliminado 'royal' (falso positivo con "Royal Blue" → marca Royal Padel incorrecta)
 *    Se mantiene 'royal padel' (dos palabras) que sí es inequívoco.
 *  - MARCAS_CONOCIDAS: añadidos 'jhayber' → Jhayber y 'harlem' → Harlem
 *
 * v14 (2026-05-24):
 *  - palasPorMarca: alias 'starvie' → palas de 'Star Vie'
 *    detectarMarca() devuelve 'Starvie' pero BD tiene marca='Star Vie' → 0 candidatos
 *
 * v13 (2026-05-24):
 *  - tokenizar: normaliza "hard" → "hrd" y "soft" → "sft" en títulos de anuncios
 *    (Vinted usa "Blast Pro Hard" en vez de "Blast Pro HRD")
 *  - KEEP_WORDS + TOKENS_DIFERENCIADORES: añadido "sft"
 *
 * v12 (2026-05-22):
 *  - matchPalaIds: carga también anuncios con match_method=no_match o ambiguous
 *    para reintentarlos cuando el catálogo crece (fix ratio bajando con el tiempo)
 *  - matchPalaIds: escribe match_method='no_match'/'ambiguous' en los fallidos
 *    para distinguirlos de anuncios nuevos sin intentar
 *  - matchPalaIds: en matches exitosos también escribe match_method='fuzzy_auto'
 *
 * v11 (2026-05-22):
 *  - "pro line" → "line" en tokenizar (Flow Pro Line matchea con título "Flow Proline")
 *  - número suelto 1-9 tras modelo normaliza a 0X ("Hack Hybrid 3" → token "03")
 *  - AT10_18K_ACTIVO: cuando inyección 18k activa, ignorar año del título en fases 1 y 2
 *    (vendedores ponen año actual 2026 pero la pala AT10 18K es 2023/2024)
 *
 * Ejecutar:
 *   npx tsx --env-file=.env.local scripts/match-pala-id.ts
 *   npx tsx --env-file=.env.local scripts/match-pala-id.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!

const DRY_RUN    = process.argv.includes('--dry-run')
const DEBUG_NOMATCH = process.argv.includes('--debug-nomatch')

// ─── Constantes compartidas (una única fuente de verdad) ──────────────────────

// Palabras a ignorar al tokenizar el modelo (artículos, preposiciones, etc.)
const STOP_WORDS = new Set([
  'de', 'da', 'del', 'la', 'el', 'y', 'e', 'con', 'para', 'pala', 'padel',
  'raqueta', 'serie', 'series', 'edition', 'version', 'by',
  'a22', 'a23', 'a24', 'rc',  // Akkeron — nunca aparecen en títulos Wallapop
])

// Palabras que diferencian modelos — nunca ignorar aunque sean cortas
const KEEP_WORDS = new Set([
  'hrd', 'ctrl', 'soft', 'air', 'light', 'team', 'carbon',
  'match', 'drive', 'arrow', 'cross', 'hit', 'rx',
  '18k', '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena', 'hard',
  'pro', 'evo', 'plus', 'motion', 'elite', 'genius', 'attack',
  'lite',    // Nox AT10 Xtreme Lite
  'x',       // Head Speed Pro X vs Speed Pro
  'proplus', // Oxdog Ultimate Pro+ vs Pro
  'woman',   // Bullpadel versión femenina (W normalizado → woman)
  'sft',     // Joma Blast Pro SFT vs HRD
  'c6',      // Nox X-One C6 vs X-One 2025
  // Nombres de modelo (para que tokenizar no los descarte)
  'trilogy', 'triton', 'metheora', 'raptor', 'basalto', 'drax', 'kenta', 'aquila', 'brava',
  'fenix', 'diablo', 'gea', 'spyder', 'yarara', 'mamba', 'titan',
  'axion', 'conqueror', 'canyon', 'explorer',
  'piton', 'patron', 'gladius',
  'summum',
  // v16: Colores — diferencian variantes de una misma familia
  // Ej: Adidas Drive Black 2026 vs Drive Blue 2026 vs Drive Grey 2026
  // Ej: Vibora Yarara Pro White 2.0 vs otras variantes
  'black', 'blue', 'grey', 'white', 'red', 'green', 'orange', 'pink',
  'yellow', 'purple', 'gold', 'silver', 'navy', 'lime',
  // Español (variantes de catálogo: Negro-Rojo, Azul-Verde…)
  'negro', 'rojo', 'azul', 'blanco', 'verde', 'naranja', 'rosa',
  'amarillo', 'gris', 'dorado', 'plateado', 'morado', 'violeta', 'turquesa',
])

// Tokens que diferencian variantes dentro de una misma familia.
// Si el TÍTULO los contiene, los modelos que no los requieren son descartados.
// CLAVE: usar los tokens YA normalizados (hrd, no hrd+) igual que tokenizar().
const TOKENS_DIFERENCIADORES = new Set([
  'ctrl', 'carbon', 'team', 'hrd', 'light', 'soft', 'air',
  'pro', 'elite', 'attack', 'motion', 'drive', 'match',
  'arrow', 'cross', 'hit', 'rx', 'power', 'speed',
  '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena',
  'sft',     // Joma Blast Pro SFT vs HRD
  'hybrid',  // Bullpadel Vertex 04 Hybrid vs Vertex 04 Comfort — diferenciador de subfamilia
  'lite',    // Nox AT10 Xtreme Lite vs Xtreme
  'x',       // Head Speed Pro X vs Speed Pro
  'proplus', // Oxdog Ultimate Pro+ vs Pro
  'woman',   // Bullpadel versión femenina
  // v4 — diferenciadores de subfamilias Head, Bullpadel, Babolat, NOX...
  'extreme', // Head Extreme Pro vs Head Speed Pro
  'vertex',  // Bullpadel Vertex vs Hack vs Hack Ctrl
  'hack',    // Bullpadel Hack vs Vertex
  'genius',  // NOX AT10 Genius vs AT10 Xtreme
  'viper',   // Babolat Technical Viper vs Air Viper
  // 'coello' — tratado como jugador en JUGADORES_PATTERN, no como diferenciador
  'zephyr',
  'delta',
  'flash',
  'radical',
  'instinct',
  'prestige',
  'xplore',
  'contact',
  // 'xtreme' normalizado a 'xtrem' en tokenizador
  'neuron',  // Bullpadel Hack Neuron vs Hack
  'aquila',
  'galerna',
  'leader',
  'comfort',  // Bullpadel Vertex 04 Comfort vs Vertex 04 Hybrid
  'revolution', // Siux Pegasus Revolution vs Pegasus
  'st1', 'st2', 'st3', 'st4',  // Siux Electra ST2/ST3/ST4 vs Electra Pro/Go/Elite
  'advance',    // Bullpadel Vertex Advance vs Vertex 04/05
  'jr',         // Bullpadel Hack JR (Junior) vs Hack 04/03
  'c6',         // Nox X-One C6 vs X-One 2025
  // Nombres de modelo que deben actuar como diferenciadores fuertes
  // Si el título dice "Trilogy" y el catálogo no tiene "Trilogy" → no_match
  'trilogy',    // Siux Trilogy vs Gea/Electra/Pegasus
  'triton',     // StarVie Triton vs Raptor/Drax/Metheora
  'metheora',   // StarVie Metheora vs Triton/Raptor
  'raptor',     // StarVie Raptor vs Triton/Drax
  'basalto',    // StarVie Basalto
  'drax',       // StarVie Drax vs Kenta
  'kenta',      // StarVie Kenta vs Drax
  'aquila',     // StarVie Aquila
  'brava',      // StarVie Brava
  'fenix',      // Siux Fenix vs Diablo/Electra
  'diablo',     // Siux Diablo vs Fenix
  'gea',        // Siux Gea vs Trilogy/Diablo
  'spyder',     // Siux Spyder
  'yarara',     // Vibora Yarara vs Black Mamba
  'mamba',      // Vibora Black Mamba
  'titan',      // Vibora Titan vs Yarara
  'axion',      // Drop Shot Axion vs Explorer/Canyon
  'conqueror',  // Drop Shot Conqueror
  'canyon',     // Drop Shot Canyon
  'explorer',   // Drop Shot Explorer
  'piton',      // Black Crown Piton vs Patron/Gladius
  'patron',     // Black Crown Patron vs Piton
  'gladius',    // Black Crown Gladius
  'delta',      // Head Delta (modelo antiguo, NO es Speed Pro ni Zephyr)
  'alpha',      // Head Alpha vs Delta/Zephyr
  'summum',     // Varlion Summum vs LF/Avant
  // v16: Colores como diferenciadores
  'black', 'blue', 'grey', 'white', 'red', 'green', 'orange', 'pink',
  'yellow', 'purple', 'gold', 'silver', 'navy', 'lime',
  // Español (variantes de catálogo)
  'negro', 'rojo', 'azul', 'blanco', 'verde', 'naranja', 'rosa',
  'amarillo', 'gris', 'dorado', 'plateado', 'morado', 'violeta', 'turquesa',
])


// Colores opcionales en matching: si están en el CATÁLOGO pero no en el título,
// no bloquean el match. Solo discriminan si el título tiene un color diferente.
const TOKENS_COLOR = new Set<string>([
  'black', 'blue', 'grey', 'white', 'red', 'green', 'orange', 'pink',
  'yellow', 'purple', 'gold', 'silver', 'navy', 'lime',
  'negro', 'rojo', 'azul', 'blanco', 'verde', 'naranja', 'rosa',
  'amarillo', 'gris', 'dorado', 'plateado', 'morado', 'violeta', 'turquesa',
])
// Palabras que indican que el anuncio NO es una pala
const EXCLUIR_ACCESORIOS = new Set([
  // Accesorios pádel
  'bolsa', 'mochila', 'funda', 'paletero', 'grip', 'overgrip',
  'protector', 'muñequera', 'bolas', 'pelota', 'pelotas', 'camiseta',
  'zapatilla', 'zapatillas', 'ropa', 'lote', 'antivibrador',
  // Calzado deportivo (listings en inglés de Vinted)
  'shoe', 'shoes', 'footwear', 'sneaker', 'sneakers',
  // Raquetas de tenis inequívocas (no confundibles con pádel)
  'raqueta tenis', 'raquetas tenis', 'tenis head', 'tenis wilson',
  'pro staff', 'blade v1', 'blade v9', 'blade v10', 'blade 98', 'blade 100',
  'pure drive', 'pure aero', 'pure strike',
  'hierros', 'madera', 'putter',
  // Líneas/modelos de tenis de marcas que también hacen pádel
  'flexpoint',         // Head Flexpoint (línea de raquetas de tenis Head)
  'titanium graphite', // Wilson Titanium Graphite (tenis)
  'graphite ultra',    // Wilson (tenis)
  // Golf / esquí / otros deportes
  'speedback', 'driver golf', 'esquís', 'esqui', 'snowboard',
  // Máquinas y equipamiento
  'máquina padel', 'lanzadora', 'slinger',
  // Modelos sin catálogo — evitar falsos positivos con familia similar
  'essex',  // Adidas Essex 2260 Metalbone
  // Otros deportes que cuelan con marcas de pádel
  'pickleball',
  'bolas de golf', 'bolas golf', 'blade pro v',  // Wilson golf/tenis
  // Tenis en frances (Vinted Francia/Belgica)
  'raquette de tennis', 'raquette tennis',
  // Head Prestige es linea de tenis, nunca padel
  'head prestige', 'prestige mp', 'prestige pro', 'prestige tour', 'prestige mid',
  // Wilson tenis adicionales
  'ultra 99', 'ultra 100', 'ultra tour',
  // Vinted: listings de calzado padel (zapatillas, no palas)
  'padel shoes', 'padel shoe', 'padel boots',
  // Italiano
  'zaino', 'zainetto', 'maglietta', 'calzini', 'monospalla', 'porta racchetta',
  'portaracchetta', 'fodero', 'tracolla', 'racchette',
  // Holandés
  'rugzak', 'padeltas',
  // Francés
  'sac à dos', 'sac a dos',
])

// Versiones de generación estilo "3.4", "2.0", "1.5" — se extraen del modelo
// para usarlas como token de desempate. NO se eliminan del modelo.
// La regex captura el número X.Y tal como aparece en el modelo del catálogo.
const VERSION_PATTERN = /\b(\d+\.\d+)\b/

// Marcas conocidas para detección desde título cuando marca=null
const MARCAS_CONOCIDAS: Record<string, string> = {
  'bullpadel':  'Bullpadel',
  'nox':        'Nox',
  'head':       'Head',
  'adidas':     'Adidas',
  'babolat':    'Babolat',
  'wilson':     'Wilson',
  'dunlop':     'Dunlop',
  'starvie':    'StarVie',
  'star vie':   'StarVie',
  'vibora':     'Vibora',
  'víbora':     'Vibora',
  'siux':       'Siux',
  'royal padel':'Royal Padel',
  // 'royal' eliminado: falso positivo con "Royal Blue" (color), detecta Royal Padel donde no hay
  'drop shot':  'Drop Shot',
  'dropshot':   'Drop Shot',
  'tecnifibre': 'Tecnifibre',
  'black crown':'Black Crown',
  'blackcrown': 'Black Crown',
  'varlion':    'Varlion',
  'volt':       'Volt',
  'tamanaco':   'Tamanaco',
  'kuikma':     'Kuikma',
  'akkeron':    'Akkeron',
  'joma':       'Joma',
  'jhayber':    'Jhayber',
  'harlem':     'Harlem',
  'vibor-a':    'Vibora',
  'kombat':     'Kombat',
  'oxdog':      'Oxdog',
  'kaitt':      'Kaitt',
  'alkemia':    'Alkemia',
  'munich':     'Munich',
  'puma':       'Puma',
  'enebe':      'Enebe',
  'lok':        'Lok',
  'slazenger':  'Slazenger',
  'hirostar':   'Hirostar',
  'cartri':     'Cartri',
  'cork':       'Cork',
  'sane':       'Sane',
  'endless':    'Endless',
  'pallap':     'Pallap',
  'xcalion':        'Xcalion',
  'quad':           'Quad',
  'tactical padel': 'Tactical Padel',
  'racket project': 'Racket Project',
  'rs padel':   'RS Padel',
  'nzn':        'NZN',
  // v10: alias de modelo → marca (títulos sin nombre de marca explícito)
  'vertex':     'Bullpadel',  // "Vertex 05 2026" → Bullpadel
  'hack':       'Bullpadel',  // "Hack 04 Hybrid" → Bullpadel
  'indiga':     'Bullpadel',
  'hack ctrl':  'Bullpadel',
  'at10':       'Nox',        // "AT10 Genius 18K" → Nox
  'ea10':       'Nox',        // "EA10 Ventus Hybrid" → Nox
  'ml10':       'Nox',
  'metalbone':  'Adidas',     // "Metalbone 3.4 HRD+" → Adidas
  'metagame':   'Adidas',
  'metalwrist': 'Adidas',
  'yarara':     'Vibora',
  'electra':    'Siux',       // "Electra ST2" → Siux
  'pegasus':    'Siux',
  'alien pro':  'Hirostar',   // "Alien Pro 26" → Hirostar
  'alien core': 'Hirostar',
  'blackstone': 'Hirostar',
  'redstone':   'Hirostar',
  'unum':       'Xcalion',    // "Unum+ H1" → Xcalion
  'infinity h1':'Xcalion',
  'ventus':     'Nox',        // "ML10 Ventus 2026" → Nox
  'flow':       'Bullpadel',  // "Flow 2026" / "Flow Legend" → Bullpadel
  'xplo':       'Bullpadel',  // "XPLO 2025" → Bullpadel
  'flow legend':'Bullpadel',
}

// ─── Funciones de parsing ──────────────────────────────────────────────────────

function tokenizar(texto: string): string[] {
  return texto
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // v10: quitar tildes ANTES de tokenizar (élite→elite, pádel→padel, González→gonzalez)
    .toLowerCase()
    .replace(/hrd\+/g, 'hrd')          // normalizar hrd+ → hrd
    .replace(/\bhdr\+?(?=\d)/g, 'hrd ')  // normalizar hdr+2026 → hrd 2026 (typo común en Vinted, sin espacio)
    .replace(/\bhdr\+?/g, 'hrd')         // normalizar hdr/hdr+ → hrd (typo común en Vinted)
    .replace(/\bhard\b/g, 'hrd')       // v13: normalizar "hard" → "hrd" (Vinted usa "Blast Pro Hard")
    .replace(/\bsoft\b/g, 'sft')       // v13: normalizar "soft" → "sft" (Joma SFT = Soft)
    .replace(/\bctr\b/g, 'ctrl')       // normalizar ctr → ctrl (Bullpadel usa CTR)
    .replace(/\bpwr\b/g, 'power')      // normalizar "PWR" → "power" (Bullpadel: "Indiga PWR" vs título "Indiga Power")
    .replace(/pro\s*\+/g, 'proplus')   // normalizar "pro +" / "pro+" → proplus (Oxdog)
    .replace(/\bpro plus\b/g, 'proplus') // normalizar "pro plus" → proplus
    .replace(/\b(st|electra st)\s+(\d)\b/g, '$1$2') // normalizar "ST 2" → "st2", "Electra ST 2" → "electra st2"
    .replace(/(\d)w\b/g, '$1 woman')    // "04w" → "04 woman" (Bullpadel Vertex 04W, Hack 03W…)
    .replace(/\bw\b(?=\s|$)/g, 'woman') // normalizar "W" → "woman" (versión femenina standalone)
    .replace(/\bproline\b/g, 'line') // normalizar "proline" → "line" (Bullpadel Flow Pro Line → Flow Line)
    .replace(/\bpro\s+line\b/g, 'line') // v11: "pro line" → "line" (mismo compuesto con espacio)
    .replace(/\btechnivap\b/g, 'technical') // normalizar "technivap" (typo común) → "technical"
    .replace(/\bhibrid\b/g, 'hybrid')       // Kuikma typo frecuente: Hibrid → Hybrid
    .replace(/\bc[.\s](\d)\b/g, 'c$1')    // normalizar "c.6"/"c 6" → "c6" (Nox X-One C6)
    .replace(/\b(hack|vertex|flow)\s+(\d)\b/g, '$1 0$2') // "Hack 3" → "Hack 03", "Vertex 4" → "Vertex 04"
    .replace(/\b(hack|vertex|flow)(0[1-9])\b/g, '$1 $2') // v10: "hack03" → "hack 03" (pegados sin espacio)
    .replace(/\b(hack|vertex|flow)(\s+\w+)\s+(\d)\b/g, '$1$2 0$3') // v11: "Hack Hybrid 3" → "Hack Hybrid 03"
    .replace(/\bcontrol\b/g, 'ctrl')        // normalizar "control" → "ctrl" (Bullpadel Indiga Control = CTR)
    .replace(/\bxtreme\b/g, 'xtrem')       // normalizar xtreme → xtrem (variante ortografica Nox)
    .replace(/\b(\d+)\.(\d+)\b/g, 'v$1p$2') // preservar versiones X.Y como token único antes de quitar puntuación: 3.3 → v3p3
    .replace(/[^\w\s]/g, ' ')          // quitar toda puntuación
    .split(/\s+/)
    .filter(t => t.length >= 2 || t === 'x' || /^\d$/.test(t) || /^\d{3,4}$/.test(t))  // preservar 'x' y dígitos simples (Siux Pro 3, Pro 4...)
    .filter(t =>
      KEEP_WORDS.has(t) ||
      (!STOP_WORDS.has(t) && (!/^\d+$/.test(t) || /^0[1-9]$/.test(t) || /^\d$/.test(t) || /^v\d+p\d+$/.test(t) || (/^\d{3,4}$/.test(t) && !/^20(1[89]|2[0-9])$/.test(t))))
    )  // preservar 01-09, dígitos simples, y versiones vXpY
}

function extraerAnio(texto: string): number | null {
  const m = texto.match(/\b(20(1[89]|2[0-9]))\b/)
  if (m) return parseInt(m[1])
  // Año de 2 dígitos al final: "EVO 25" → 2025
  const m2 = texto.match(/\s(2[0-9])(?:\s|$)/)
  if (m2) {
    const y = 2000 + parseInt(m2[1])
    if (y >= 2020 && y <= 2030) return y
  }
  return null
}

// Jugadores conocidos — se eliminan del modelo del catálogo para tokenizar,
// pero se usan como tokens de desempate cuando aparecen en el título del anuncio.
const JUGADORES_PATTERN = /\b(juan lebron|lebron|ale galan|ale gal[aá]n|martita ortega|marta ortega|alex ruiz|agust[ií]n tapia|arturo coello|paquito navarro|coki nieto|stupa|momo gonz[aá]lez|chingotto|franco chingotto|edu alonso|eduardo alonso)\b/gi

function extraerTokensModelo(modelo: string, marca: string): string[] {
  const sinMarca   = modelo.replace(new RegExp(`^${marca}\\s+`, 'i'), '')
  const sinAnio    = sinMarca.replace(/\b20\d{2}\b/, '').trim()
  const sinJugador = sinAnio.replace(JUGADORES_PATTERN, '').trim()
  return tokenizar(sinJugador)
}

/** Extrae los tokens de jugador del título (para desempate). */
function extraerJugadoresTitulo(titulo: string): string[] {
  const matches: string[] = []
  const re = new RegExp(JUGADORES_PATTERN.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(titulo)) !== null) {
    // Normalizar sin tildes, minúsculas — pero CONSERVAR espacios internos
    // para que coincida con el nombre del modelo ("juan lebron", no "juanlebron")
    matches.push(m[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  }
  return matches
}

/** Extrae el número de versión X.Y de un modelo del catálogo, si lo tiene. Ej: "3.4" de "Metalbone 3.4 HRD+". */
function extraerVersionModelo(modelo: string): string | null {
  const m = modelo.match(VERSION_PATTERN)
  return m ? m[1] : null
}

/** Extrae el número de versión X.Y de un título de anuncio, si lo tiene. */
function extraerVersionTitulo(titulo: string): string | null {
  // Ignorar años (20XX) antes de buscar versiones
  const sinAnio = titulo.replace(/\b20\d{2}\b/g, '')
  const m = sinAnio.match(VERSION_PATTERN)
  return m ? m[1] : null
}

/** Intenta detectar la marca desde el título cuando wallapop_cache.marca es null. */
function detectarMarcaDesideTitulo(titulo: string): string | null {
  // Normalizar tildes igual que tokenizar() para que los alias funcionen
  const tl = titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  // Primero intentar frases de dos palabras (ej: "drop shot", "black crown", "at10")
  for (const [key, val] of Object.entries(MARCAS_CONOCIDAS)) {
    if (key.includes(' ') && tl.includes(key)) return val
  }
  // Luego palabras sueltas — buscar en tokens para evitar falsos positivos
  const tokens = tl.split(/\s+/)
  for (const [key, val] of Object.entries(MARCAS_CONOCIDAS)) {
    if (!key.includes(' ') && tokens.includes(key)) return val
  }
  return null
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface PalaCatalogo {
  id:     string
  marca:  string
  modelo: string
  año:    number
  tokens: string[]
}

interface CacheItem {
  external_id: string
  title:       string
  marca:       string | null
}

// ─── Lógica central de matching (reutilizada por main y matchPalaIds) ─────────

interface MatchResult {
  external_id:  string
  pala_id:      string
  año:          number
  titulo:       string
  modelo:       string
  yearAmbiguous?: boolean  // true → buen match pero año incierto (múltiples versiones)
}

// Umbral de match parcial: % mínimo de tokens del modelo que deben estar en el título
// Se reduce a 0.5 cuando el título contiene año + jugador conocido (identificadores fuertes
// que compensan un nombre abreviado, ej: "Nox AT10 18K 2025 Agustín Tapia")
// Se reduce a 0.4 cuando el título es corto (≤5 tokens útiles) — títulos tipo "Vertex 05 2026"
const PARTIAL_MATCH_THRESHOLD      = 0.75  // subido de 0.6 → menor permisividad
const PARTIAL_MATCH_THRESHOLD_SOFT = 0.65  // con año + jugador en título (antes 0.5)
const PARTIAL_MATCH_THRESHOLD_MIN  = 0.55  // título corto ≤5 tokens (antes 0.4)

function matchearItem(
  item: CacheItem,
  palasPorMarca: Map<string, PalaCatalogo[]>
): MatchResult | 'noMatch' | 'ambiguous' | 'excluido' {
  const titleLower = item.title.toLowerCase()

  // Descartar accesorios
  if (Array.from(EXCLUIR_ACCESORIOS).some(w => titleLower.includes(w))) return 'excluido'

  // Resolver marca: desde wallapop_cache.marca o detectar del título
  let marcaNorm = item.marca?.toLowerCase() ?? null
  if (!marcaNorm) {
    const detectada = detectarMarcaDesideTitulo(item.title)
    if (detectada) marcaNorm = detectada.toLowerCase()
  }

  // Guard: marcas que fabrican TANTO tenis como pádel (Head, Wilson, Babolat, Adidas, Dunlop).
  // Si el título contiene "raqueta" pero NO "padel"/"pala" → probable raqueta de tenis, descartar.
  // Marcas padeleras puras (Bullpadel, Siux, Nox, StarVie…) pueden decir "raqueta" sin problema.
  const MARCAS_MULTIDEPORTE = new Set(['head', 'wilson', 'babolat', 'adidas', 'dunlop'])
  if (
    marcaNorm && MARCAS_MULTIDEPORTE.has(marcaNorm) &&
    titleLower.includes('raqueta') &&
    !titleLower.includes('padel') &&
    !titleLower.includes('pala')
  ) return 'excluido'
  if (!marcaNorm) return 'noMatch'

  // Normalizar variantes ("starvie" puede venir como "star vie" o "StarVie")
  if (marcaNorm === 'star vie') marcaNorm = 'starvie'

  const candidatas = palasPorMarca.get(marcaNorm) ?? []
  if (candidatas.length === 0) return 'noMatch'

  const anioTitulo    = extraerAnio(item.title)
  const versionTitulo = extraerVersionTitulo(item.title)
  let tokensTitle   = tokenizar(titleLower)
  // ── difEnTitulo se calcula con los tokens REALES del título, ANTES de inyecciones ──
  // Así los tokens inyectados (genius, alum, technical…) no aparecen como
  // "diferenciadores extra" del título y no descartan candidatos incorrectamente.
  const difEnTitulo = new Set(tokensTitle.filter(t => TOKENS_DIFERENCIADORES.has(t)))
  // Babolat: "Viper Lebron" siempre es Technical Viper — inyectar "technical" si falta
  if (marcaNorm === 'babolat' && tokensTitle.includes('viper') && tokensTitle.some(t => t === 'lebron' || t === 'juan') && !tokensTitle.includes('technical')) {
    tokensTitle = [...tokensTitle, 'technical']
  }
  // Nox AT10 18K: puede que el título no incluya "genius"/"alum" que sí están en el modelo
  // Solo inyectar tokens Y solo ignorar año si hay UN ÚNICO modelo AT10 18K en catálogo.
  // Con múltiples versiones (2022-2026) hay que respetar el año del título para no mezclar modelos.
  const modelos18k = (palasPorMarca.get('nox') ?? []).filter(p => p.tokens.includes('at10') && p.tokens.includes('18k'))
  const AT10_18K_ACTIVO = marcaNorm === 'nox' && tokensTitle.includes('at10') && tokensTitle.includes('18k') && modelos18k.length === 1
  if (AT10_18K_ACTIVO) {
    if (!tokensTitle.includes('genius')) tokensTitle = [...tokensTitle, 'genius']
    if (!tokensTitle.includes('alum')) tokensTitle = [...tokensTitle, 'alum']
  }
  // AT10 18K con múltiples versiones: inyectar alum+genius si el título no los tiene
  // (vendedores escriben "AT10 18K 2025" sin "alum" aunque el modelo oficial sí lo lleva)
  if (marcaNorm === 'nox' && tokensTitle.includes('at10') && tokensTitle.includes('18k') && modelos18k.length > 1) {
    if (!tokensTitle.includes('genius')) tokensTitle = [...tokensTitle, 'genius']
    if (!tokensTitle.includes('alum'))   tokensTitle = [...tokensTitle, 'alum']
  }
  // AT10 Attack sin 18K → en catálogo siempre es "Genius Attack"
  if (marcaNorm === 'nox' && tokensTitle.includes('at10') && tokensTitle.includes('attack') && !tokensTitle.includes('genius')) {
    tokensTitle = [...tokensTitle, 'genius']
  }
  // AT10 Genius Attack: los modelos del catálogo llevan 12k+alum pero los títulos no siempre
  if (marcaNorm === 'nox' && tokensTitle.includes('at10') && tokensTitle.includes('attack')) {
    if (!tokensTitle.includes('12k'))  tokensTitle = [...tokensTitle, '12k']
    if (!tokensTitle.includes('alum')) tokensTitle = [...tokensTitle, 'alum']
  }
  // AT10 12K sin "genius" → inyectar genius (AT10 Genius 12K es el modelo estándar)
  if (marcaNorm === 'nox' && tokensTitle.includes('at10') && tokensTitle.includes('12k') && !tokensTitle.includes('genius')) {
    tokensTitle = [...tokensTitle, 'genius']
  }
  // difEnTitulo ya calculado arriba, antes de inyecciones — no recalcular aquí
  const jugadoresTitulo = extraerJugadoresTitulo(item.title)

  // ── Fase 1: match ESTRICTO (todos los tokens del modelo en el título) ──────
  let scored = candidatas
    .map(pala => {
      // v11: para AT10 18K, ignorar año del título (vendedores ponen año actual aunque la pala sea 2023/2024)
      if (anioTitulo !== null && pala.año !== anioTitulo && !AT10_18K_ACTIVO) return null
      if (pala.tokens.length === 0) return null
      // Tokens no-color: deben estar TODOS en el título
      const tokensReq = pala.tokens.filter(t => !TOKENS_COLOR.has(t))
      if (tokensReq.some(t => !tokensTitle.includes(t))) return null
      // Colores: solo discriminan si el título tiene un color diferente
      const colorsTituloF1 = tokensTitle.filter(t => TOKENS_COLOR.has(t))
      const colorsCatalogoF1 = pala.tokens.filter(t => TOKENS_COLOR.has(t))
      if (colorsTituloF1.length > 0 && colorsCatalogoF1.length > 0) {
        if (!colorsTituloF1.some(c => colorsCatalogoF1.includes(c))) return null
      }
      const tokensDif = pala.tokens.filter(t => TOKENS_DIFERENCIADORES.has(t) && !TOKENS_COLOR.has(t))
      if (!tokensDif.every(t => tokensTitle.includes(t))) return null
      // FASE 1: también rechazar si el título tiene diferenciadores que el modelo no tiene
      const difExtra1 = Array.from(difEnTitulo).filter(d => !pala.tokens.includes(d) && !TOKENS_COLOR.has(d))
      if (difExtra1.length > 0) return null
      return { pala, score: pala.tokens.length, partial: false }
    })
    .filter(Boolean) as { pala: PalaCatalogo; score: number; partial: boolean }[]

  // ── Fase 2: match PARCIAL si la fase 1 no da nada ────────────────────────
  // Condiciones: ≥60% tokens del modelo en título + todos los diferenciadores presentes
  // Solo se aplica si el resultado es único (evitar falsos positivos por ambigüedad)
  // Excepción: threshold baja a 50% si el título tiene año + jugador (identificadores fuertes)
  if (scored.length === 0) {
    const tieneAnioYJugador = anioTitulo !== null && jugadoresTitulo.length > 0
    const tituloCorto = tokensTitle.length <= 5
    // Marcas multideporte: no bajar umbral por titulo corto (evita shoes/tenis falsos positivos)
    const esMultideporte = marcaNorm ? MARCAS_MULTIDEPORTE.has(marcaNorm) : false
    const threshold = tieneAnioYJugador
      ? PARTIAL_MATCH_THRESHOLD_SOFT
      : (tituloCorto && !esMultideporte)
      ? PARTIAL_MATCH_THRESHOLD_MIN
      : PARTIAL_MATCH_THRESHOLD
    // Extraer números de modelo del título (01-09, v2, v3... pero NO años 20XX)
    // Estos son tokens que identifican la versión exacta del modelo
    const numerosModelo = titleLower
      .replace(/\b20\d{2}\b/g, '')          // quitar años
      .replace(/hrd\+/g, 'hrd')
      .replace(/\b(\d+)\.(\d+)\b/g, 'VER')  // ignorar versiones X.Y — no son números de modelo
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => /^(0[1-9]|v\d+|\d{1,2})$/.test(t) && t !== 'VER')  // 01-09, v2, v10, 3, 4 — excluir versiones

    const parciales = candidatas
      .map(pala => {
        // v11: para AT10 18K, ignorar año del título
        if (anioTitulo !== null && pala.año !== anioTitulo && !AT10_18K_ACTIVO) return null
        if (pala.tokens.length === 0) return null

        // GUARD: si el título contiene un número de modelo (04, 05, v10...)
        // y el modelo del catálogo tiene un número distinto → falso positivo seguro
        if (numerosModelo.length > 0) {
          const numerosModPala = pala.tokens.filter(t => /^(0[1-9]|v\d+|\d{1,2})$/.test(t) && !/^v\d+p\d+$/.test(t))  // excluir versiones vXpY
          if (numerosModPala.length > 0) {
            // El modelo tiene número → debe coincidir con alguno del título
            const hayConflicto = numerosModPala.every(n => !numerosModelo.includes(n))
            if (hayConflicto) return null
          }
        }
        // GUARD: si el modelo tiene número de versión (03, 04...) y el título NO tiene
        // ningún número de modelo → ambiguo, no asignar en match parcial
        if (numerosModelo.length === 0) {
          const numerosModPala = pala.tokens.filter(t => /^0[1-9]$/.test(t))  // solo 01-09 (versiones Bullpadel)
          if (numerosModPala.length > 0) return null
        }

        // Ratio basado en tokens no-color (para no penalizar por colores del catálogo)
        const tokensReqF2 = pala.tokens.filter(t => !TOKENS_COLOR.has(t))
        const tokensMatchF2 = pala.tokens.filter(t => tokensTitle.includes(t))
        const ratioBase = tokensReqF2.length > 0 ? tokensReqF2.filter(t => tokensTitle.includes(t)).length / tokensReqF2.length : 1
        if (ratioBase < threshold) return null
        // Colores: solo discriminan si el título tiene un color diferente
        const colorsTituloF2 = tokensTitle.filter(t => TOKENS_COLOR.has(t))
        const colorsCatalogoF2 = pala.tokens.filter(t => TOKENS_COLOR.has(t))
        if (colorsTituloF2.length > 0 && colorsCatalogoF2.length > 0) {
          if (!colorsTituloF2.some(c => colorsCatalogoF2.includes(c))) return null
        }
        // Los diferenciadores no-color del modelo SÍ deben estar en el título
        const tokensDif = pala.tokens.filter(t => TOKENS_DIFERENCIADORES.has(t) && !TOKENS_COLOR.has(t))
        if (!tokensDif.every(t => tokensTitle.includes(t))) return null
        // Los diferenciadores no-color del título NO pueden apuntar a otro modelo
        const difExtra = Array.from(difEnTitulo).filter(d => !pala.tokens.includes(d) && !TOKENS_COLOR.has(d))
        if (difExtra.length > 0) return null
        return { pala, score: tokensMatchF2.length, partial: true }
      })
      .filter(Boolean) as { pala: PalaCatalogo; score: number; partial: boolean }[]

    // Solo asignar si hay un único candidato parcial claro (o varios del mismo año → más reciente)
    if (parciales.length > 0) {
      // Si el título NO menciona jugador, descartar modelos que tengan jugador
      if (jugadoresTitulo.length === 0) {
        const RE_JUG2 = new RegExp(JUGADORES_PATTERN.source, 'gi')
        const sinJug = parciales.filter(s =>
          !RE_JUG2.test(s.pala.modelo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
        )
        if (sinJug.length > 0) parciales.splice(0, parciales.length, ...sinJug)
      }
      parciales.sort((a, b) => b.score - a.score)
      const maxScore  = parciales[0].score
      const topParc   = parciales.filter(s => s.score === maxScore)
      if (topParc.length === 1) {
        scored = topParc
      } else {
        const maxAnioP = Math.max(...topParc.map(s => s.pala.año))
        const topAñoP  = topParc.filter(s => s.pala.año === maxAnioP)
        if (topAñoP.length === 1) scored = topAñoP
      }
    }
  }

  if (scored.length === 0) return 'noMatch'

  // ── Guard: modelo genérico sin año → NO asignar ──────────────────────────
  // Si el modelo matcheado tiene ≤2 tokens Y el título no tiene año, es demasiado
  // genérico ("Pala bullpadel", "Pala Nox"...) y asignaría al modelo más reciente
  // aunque sea incorrecto. Mejor dejarlo como noMatch para no contaminar el TOP.
  if (scored.length === 1 && scored[0].pala.tokens.length <= 2 && anioTitulo === null) {
    const baseTokens = scored[0].pala.tokens
    const candidatas2 = palasPorMarca.get(marcaNorm!) ?? []
    const sibling = candidatas2.filter(p =>
      p.id !== scored[0].pala.id &&
      baseTokens.every(t => p.tokens.includes(t))
    )
    if (sibling.length > 0) return 'noMatch'  // genérico con múltiples candidatos → descartar
  }

  // ── Desempate 1: fix HRD+→base, Team→base ─────────────────────────────────
  if (difEnTitulo.size > 0) {
    const conDif = scored.filter(s => s.pala.tokens.some(t => TOKENS_DIFERENCIADORES.has(t)))
    if (conDif.length > 0) scored = conDif
  }

  if (scored.length === 0) return 'noMatch'
  if (scored.length === 1) {
    const winner = scored[0].pala
    return { external_id: item.external_id, pala_id: winner.id, año: winner.año, titulo: item.title, modelo: winner.modelo }
  }

  // ── Desempate 1c: más diferenciadores del título coinciden con el modelo ──
  // Ej: "Head Extreme Motion" → extreme+motion en título → gana Head Extreme Motion
  // Ej: "Head Extreme Pro Coello" → extreme+pro+coello en título
  //   Head Extreme Pro tokens:[extreme,pro] → todos sus difs están en título ✓
  //   Head Coello Pro  tokens:[coello,pro]  → todos sus difs están en título ✓ (empate)
  //   → paso siguiente: descartar los que tienen difs que NO están en el título
  if (difEnTitulo.size > 0) {
    // Paso A: preferir los que tienen más difs del título en sus tokens
    const difMatch = (s: { pala: PalaCatalogo }) =>
      Array.from(difEnTitulo).filter(d => s.pala.tokens.includes(d)).length
    const maxDifMatch = Math.max(...scored.map(difMatch))
    const conMaxDif = scored.filter(s => difMatch(s) === maxDifMatch)
    if (conMaxDif.length > 0 && conMaxDif.length < scored.length) scored = conMaxDif

    // Paso B: descartar candidatos que tienen difs propios NO presentes en el título
    // Ej: "Head Extreme Pro Coello" → título tiene [extreme,pro,coello]
    //   Head Extreme Pro [extreme,pro] → todos en título ✓ — conservar
    //   Head Coello Pro  [coello,pro]  → todos en título ✓ — conservar (empate, seguimos)
    // Ej: "Bullpadel Vertex 04 Comfort" → título tiene [vertex,comfort]
    //   Vertex 04 Hybrid [vertex,hybrid] → hybrid NO en título → descartar
    const sinDifExtra = scored.filter(s => {
      const difsPropios = s.pala.tokens.filter(t => TOKENS_DIFERENCIADORES.has(t))
      return difsPropios.every(t => difEnTitulo.has(t))
    })
    if (sinDifExtra.length > 0 && sinDifExtra.length < scored.length) scored = sinDifExtra
  }

  if (scored.length === 0) return 'noMatch'
  if (scored.length === 1) {
    const winner = scored[0].pala
    return { external_id: item.external_id, pala_id: winner.id, año: winner.año, titulo: item.title, modelo: winner.modelo }
  }

  // ── Desempate 1b: jugador en título (Juan Lebron, Ale Galan…) ────────────
  // Si el título menciona un jugador → preferir modelos que lo incluyan.
  // Si el título NO menciona jugador → preferir modelos que NO lo incluyan.
  // Los tokens de jugador se eliminan del modelo en extraerTokensModelo(), así que
  // comparamos contra el nombre completo del modelo (en minúsculas normalizado).
  {
    const RE_JUG = new RegExp(JUGADORES_PATTERN.source, 'gi')
    const modeloTieneJugador = (modelo: string) =>
      RE_JUG.test(modelo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))

    if (jugadoresTitulo.length > 0) {
      // Título CON jugador → filtrar a los que lo incluyen
      const conJugador = scored.filter(s => {
        const modeloNorm = s.pala.modelo.toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        // Alias: "marta ortega" en título busca también "martita ortega" en modelo
        const JUGADOR_ALIAS: Record<string, string[]> = { 'marta ortega': ['martita ortega', 'marta ortega'] }
        return jugadoresTitulo.some(j => {
          const aliases = JUGADOR_ALIAS[j] ?? [j]
          return aliases.some(a => modeloNorm.includes(a))
        })
      })
      if (conJugador.length > 0 && conJugador.length < scored.length) scored = conJugador
    } else {
      // Título SIN jugador → descartar modelos que tengan jugador (no solo en empate)
      const sinJugador = scored.filter(s => {
        const re2 = new RegExp(JUGADORES_PATTERN.source, 'gi')
        return !re2.test(s.pala.modelo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
      })
      if (sinJugador.length > 0) scored = sinJugador
    }
  }

  if (scored.length === 0) return 'noMatch'
  if (scored.length === 1) {
    const winner = scored[0].pala
    return { external_id: item.external_id, pala_id: winner.id, año: winner.año, titulo: item.title, modelo: winner.modelo }
  }

  // ── Desempate 2: número de versión X.Y ───────────────────────────────────
  if (versionTitulo !== null) {
    const conVersion = scored.filter(s => extraerVersionModelo(s.pala.modelo) === versionTitulo)
    if (conVersion.length > 0) scored = conVersion
  }

  if (scored.length === 1) {
    const winner = scored[0].pala
    return { external_id: item.external_id, pala_id: winner.id, año: winner.año, titulo: item.title, modelo: winner.modelo }
  }

  // ── Desempate 3: especificidad de tokens ──────────────────────────────────
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const extraA = a.pala.tokens.filter(t => !tokensTitle.includes(t)).length
    const extraB = b.pala.tokens.filter(t => !tokensTitle.includes(t)).length
    return extraA - extraB
  })

  const maxScore2   = scored[0].score
  const topMatches  = scored.filter(s => s.score === maxScore2)
  const minExtra    = Math.min(...topMatches.map(s => s.pala.tokens.filter(t => !tokensTitle.includes(t)).length))
  const topSinExtra = topMatches.filter(s => s.pala.tokens.filter(t => !tokensTitle.includes(t)).length === minExtra)

  if (topSinExtra.length === 1) {
    const winner = topSinExtra[0].pala
    return { external_id: item.external_id, pala_id: winner.id, año: winner.año, titulo: item.title, modelo: winner.modelo }
  }

  // ── Desempate 4: año más reciente ─────────────────────────────────────────
  const maxAnio     = Math.max(...topSinExtra.map(s => s.pala.año))
  const topRecientes = topSinExtra.filter(s => s.pala.año === maxAnio)

  if (topRecientes.length === 1) {
    const winner = topRecientes[0].pala
    return { external_id: item.external_id, pala_id: winner.id, año: winner.año, titulo: item.title, modelo: winner.modelo }
  }

  return 'ambiguous'
}

// ─── Exports adicionales para el sistema de auditoría ────────────────────────
// El auditor de matches (api/cron/audit-matches) reutiliza estas funciones
// para verificar que los matches en TOP y CHOLLOS son coherentes.
export { tokenizar, extraerAnio, extraerTokensModelo, detectarMarcaDesideTitulo, matchearItem }
export type { PalaCatalogo, CacheItem, MatchResult }
export { STOP_WORDS, KEEP_WORDS, TOKENS_DIFERENCIADORES, EXCLUIR_ACCESORIOS, MARCAS_CONOCIDAS }

// ─── Función exportable para scrapers ────────────────────────────────────────

export async function matchPalaIds(
  supabase: ReturnType<typeof createClient> | any,
  opts?: { verbose?: boolean }
): Promise<{ matched: number; ambiguous: number; noMatch: number }> {
  const verbose = opts?.verbose ?? true

  if (verbose) console.log('\n🔗 Match pala_id iniciado...')

  // Supabase limita a 1000 filas por defecto — paginamos para traer todo el catálogo
  const palasRaw: any[] = []
  const PAGE_SIZE = 1000
  let fromRow = 0
  while (true) {
    const { data, error } = await supabase
      .from('palas')
      .select('id, marca, modelo, año')
      .range(fromRow, fromRow + PAGE_SIZE - 1)
    if (error) {
      console.error('❌ matchPalaIds: Error cargando palas:', error)
      return { matched: 0, ambiguous: 0, noMatch: 0 }
    }
    if (!data || data.length === 0) break
    palasRaw.push(...data)
    if (data.length < PAGE_SIZE) break
    fromRow += PAGE_SIZE
  }
  const palasErr = null

  if (!palasRaw || palasRaw.length === 0) {
    console.error('❌ matchPalaIds: sin datos de palas')
    return { matched: 0, ambiguous: 0, noMatch: 0 }
  }

  const palas: PalaCatalogo[] = palasRaw.map((p: any) => ({
    id:     p.id,
    marca:  p.marca,
    modelo: p.modelo,
    año:    p.año,
    tokens: extraerTokensModelo(p.modelo, p.marca),
  }))

  const palasPorMarca = new Map<string, PalaCatalogo[]>()
  for (const pala of palas) {
    const m = pala.marca.toLowerCase()
    if (!palasPorMarca.has(m)) palasPorMarca.set(m, [])
    palasPorMarca.get(m)!.push(pala)
  }
  // v14: alias star vie ↔ starvie
  // BD usa "Star Vie" (con espacio), detectarMarca() devuelve "Starvie" → sin candidatos
  const starVieList = palasPorMarca.get('star vie') ?? []
  if (starVieList.length > 0) palasPorMarca.set('starvie', starVieList)

  // Cargar anuncios sin pala_id (nunca intentados, no_match previo, o ambiguous previo)
  // — paginado (Supabase limita a 1000 por query)
  const items: CacheItem[] = []
  const PAGE_CACHE = 1000
  let fromCache = 0
  while (true) {
    const { data: batch, error: batchErr } = await supabase
      .from('wallapop_cache')
      .select('external_id, title, marca')
      .is('pala_id', null)
      .or('match_method.is.null,match_method.eq.no_match,match_method.eq.ambiguous')
      .range(fromCache, fromCache + PAGE_CACHE - 1)
    if (batchErr) {
      console.error('❌ matchPalaIds: Error cargando cache:', batchErr)
      return { matched: 0, ambiguous: 0, noMatch: 0 }
    }
    if (!batch || batch.length === 0) break
    items.push(...(batch as CacheItem[]))
    if (batch.length < PAGE_CACHE) break
    fromCache += PAGE_CACHE
  }

  let matched = 0, ambiguous = 0, noMatch = 0
  const updates:            { external_id: string; pala_id: string; año: number; method: string }[] = []
  const noMatchIds:         string[] = []
  const ambiguousIds:       string[] = []

  for (const item of items) {
    const result = matchearItem(item, palasPorMarca)
    if (result === 'noMatch' || result === 'excluido') {
      noMatch++
      noMatchIds.push(item.external_id)
      continue
    }
    if (result === 'ambiguous') {
      ambiguous++
      ambiguousIds.push(item.external_id)
      continue
    }
    matched++
    updates.push({ external_id: result.external_id, pala_id: result.pala_id, año: result.año, method: 'fuzzy_auto' })
  }

  const BATCH = 100

  // Escribir pala_id en los matches
  if (updates.length > 0) {
    for (let i = 0; i < updates.length; i += BATCH) {
      for (const u of updates.slice(i, i + BATCH)) {
        await supabase
          .from('wallapop_cache')
          .update({ pala_id: u.pala_id, año: u.año, match_method: u.method })
          .eq('external_id', u.external_id)
      }
    }
  }

  // Marcar los fallidos con match_method para que se reintenten cuando el catálogo crezca
  if (noMatchIds.length > 0) {
    for (let i = 0; i < noMatchIds.length; i += BATCH) {
      await supabase
        .from('wallapop_cache')
        .update({ match_method: 'no_match' })
        .in('external_id', noMatchIds.slice(i, i + BATCH))
    }
  }
  if (ambiguousIds.length > 0) {
    for (let i = 0; i < ambiguousIds.length; i += BATCH) {
      await supabase
        .from('wallapop_cache')
        .update({ match_method: 'ambiguous' })
        .in('external_id', ambiguousIds.slice(i, i + BATCH))
    }
  }

  if (verbose) {
    console.log(`  ✅ Match pala_id: ${matched} asignados, ${ambiguous} ambiguos, ${noMatch} sin match`)
  }

  return { matched, ambiguous, noMatch }
}

// ─── main (ejecución standalone) ─────────────────────────────────────────────

async function main() {
  console.log(`🔗 HUNTPADEL — Match pala_id${DRY_RUN ? ' [DRY RUN]' : ''}`)
  console.log(`📅 ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  // ── 1. Cargar catálogo de palas ────────────────────────────────────────────
  console.log('📚 Cargando catálogo de palas...')
  // Supabase limita a 1000 filas por defecto — paginamos para traer todo el catálogo
  const palasRaw: any[] = []
  const PAGE = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('palas')
      .select('id, marca, modelo, año')
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('❌ Error cargando palas:', error)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    palasRaw.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  const palasErr = null

  if (!palasRaw || palasRaw.length === 0) {
    console.error('❌ Error cargando palas: sin datos')
    process.exit(1)
  }

  const palas: PalaCatalogo[] = palasRaw.map(p => ({
    id:     p.id,
    marca:  p.marca,
    modelo: p.modelo,
    año:    p.año,
    tokens: extraerTokensModelo(p.modelo, p.marca),
  }))

  const palasPorMarca = new Map<string, PalaCatalogo[]>()
  for (const pala of palas) {
    const m = pala.marca.toLowerCase()
    if (!palasPorMarca.has(m)) palasPorMarca.set(m, [])
    palasPorMarca.get(m)!.push(pala)
  }
  // v14: alias star vie ↔ starvie
  // BD usa "Star Vie" (con espacio), detectarMarca() devuelve "Starvie" → sin candidatos
  const starVieListMain = palasPorMarca.get('star vie') ?? []
  if (starVieListMain.length > 0) palasPorMarca.set('starvie', starVieListMain)

  console.log(`  ${palas.length} palas cargadas, ${palasPorMarca.size} marcas\n`)

  // Debug: tokens de palas problemáticas conocidas
  const ejemplosDebug = [
    'Adidas Metalbone HRD',
    'Adidas Metalbone 3.3',
    'Adidas Metalbone 3.4',
    'Babolat Technical Viper 2024',
    'Bullpadel Vertex 03 2023',
    'Bullpadel Hack CTRL',
  ]
  console.log('🔍 Debug tokens de palas clave:')
  for (const ej of ejemplosDebug) {
    const pala = palas.find(p => p.modelo.toLowerCase().includes(ej.toLowerCase()))
    if (pala) {
      const ver = extraerVersionModelo(pala.modelo)
      console.log(`  "${pala.modelo}": tokens:[${pala.tokens.join(', ')}] versión:${ver ?? 'ninguna'}`)
    }
  }
  console.log()

  // ── 2. Cargar anuncios sin pala_id (paginado — Supabase limita a 1000) ──────
  console.log('📦 Cargando wallapop_cache sin pala_id...')
  const items: CacheItem[] = []
  const PAGE_ITEMS = 1000
  let fromItems = 0
  while (true) {
    const { data: batch, error: batchErr } = await supabase
      .from('wallapop_cache')
      .select('external_id, title, marca')
      .is('pala_id', null)
      .range(fromItems, fromItems + PAGE_ITEMS - 1)
    if (batchErr) {
      console.error('❌ Error cargando wallapop_cache:', batchErr)
      process.exit(1)
    }
    if (!batch || batch.length === 0) break
    items.push(...(batch as CacheItem[]))
    if (batch.length < PAGE_ITEMS) break
    fromItems += PAGE_ITEMS
  }

  console.log(`  ${items.length} anuncios sin pala_id\n`)

  // ── 3. Matchear ───────────────────────────────────────────────────────────
  let matched   = 0
  let ambiguous = 0
  let noMatch   = 0
  let excluidos = 0
  const updates: MatchResult[] = []
  const ambiguousItems: { titulo: string; candidatos: PalaCatalogo[] }[] = []

  // Contadores para --debug-nomatch
  const debugNomatch = {
    sinMarca:       [] as string[],  // 🔴 No se detectó marca
    sinCatalogo:    [] as string[],  // 🟠 Marca detectada pero sin palas en catálogo
    descartDif:     [] as string[],  // 🟡 Descartado por diferenciador extra en título
    ratioInsuf:     [] as string[],  // ⚫ Ratio < threshold — tokens insuficientes
  }

  for (const item of items) {
    // Para debug-nomatch: categorizar los sin-match antes de llamar a matchearItem
    if (DEBUG_NOMATCH && !matchearItem(item, palasPorMarca).toString().startsWith('excluido')) {
      const titleLow = item.title.toLowerCase()
      const accs = Array.from(EXCLUIR_ACCESORIOS).some(w => titleLow.includes(w))
      if (!accs) {
        let mNorm = item.marca?.toLowerCase() ?? null
        if (!mNorm) {
          const det = detectarMarcaDesideTitulo(item.title)
          if (det) mNorm = det.toLowerCase()
        }
        if (mNorm === 'star vie') mNorm = 'starvie'
        if (!mNorm) {
          debugNomatch.sinMarca.push(item.title)
        } else if ((palasPorMarca.get(mNorm) ?? []).length === 0) {
          debugNomatch.sinCatalogo.push(`[${mNorm}] ${item.title}`)
        } else {
          const tokensT = tokenizar(titleLow)
          const difT = new Set(tokensT.filter(t => TOKENS_DIFERENCIADORES.has(t)))
          const cands = (palasPorMarca.get(mNorm) ?? [])
          const conRatio = cands.filter(p => {
            const tm = p.tokens.filter(t => tokensT.includes(t))
            return tm.length / p.tokens.length >= PARTIAL_MATCH_THRESHOLD
          })
          if (conRatio.length > 0) {
            debugNomatch.descartDif.push(item.title)
          } else {
            debugNomatch.ratioInsuf.push(item.title)
          }
        }
      }
    }

    const result = matchearItem(item, palasPorMarca)
    if (result === 'excluido')  { excluidos++; continue }
    if (result === 'noMatch')   { noMatch++;   continue }
    if (result === 'ambiguous') {
      ambiguous++
      // Reconstruir candidatos para el log: filtramos palas de la marca y hacemos match manual
      let marcaNorm = item.marca?.toLowerCase() ?? null
      if (!marcaNorm) {
        const detectada = detectarMarcaDesideTitulo(item.title)
        if (detectada) marcaNorm = detectada.toLowerCase()
      }
      if (marcaNorm === 'star vie') marcaNorm = 'starvie'
      const candidatos = (palasPorMarca.get(marcaNorm ?? '') ?? []).filter(p => {
        const tokensTitle = tokenizar(item.title.toLowerCase())
        const tokensMatch = p.tokens.filter(t => tokensTitle.includes(t))
        return tokensMatch.length >= Math.ceil(p.tokens.length * PARTIAL_MATCH_THRESHOLD)
      })
      ambiguousItems.push({ titulo: item.title, candidatos })
      continue
    }
    matched++
    updates.push(result)
  }

  console.log(`📊 Resultados del matching:`)
  console.log(`  ✅ Matches claros:  ${matched}`)
  console.log(`  ⚠️  Ambiguos:       ${ambiguous}`)
  console.log(`  ❌ Sin match:       ${noMatch}`)
  console.log(`  🚫 Accesorios:      ${excluidos}\n`)

  // ── Debug-nomatch: categorías de fallos ──────────────────────────────────
  if (DEBUG_NOMATCH) {
    console.log('🔍 DEBUG NOMATCH — Categorías de los sin-match:')
    console.log(`  🔴 Sin marca detectada:          ${debugNomatch.sinMarca.length}`)
    console.log(`  🟠 Marca sin catálogo (import!): ${debugNomatch.sinCatalogo.length}`)
    console.log(`  🟡 Descartado por diferenciador: ${debugNomatch.descartDif.length}`)
    console.log(`  ⚫ Ratio insuficiente (<60%):    ${debugNomatch.ratioInsuf.length}`)
    console.log()

    if (debugNomatch.sinCatalogo.length > 0) {
      // Agrupar por marca para saber qué importar
      const porMarca = new Map<string, number>()
      for (const t of debugNomatch.sinCatalogo) {
        const marca = t.match(/^\[([^\]]+)\]/)?.[1] ?? 'desconocida'
        porMarca.set(marca, (porMarca.get(marca) ?? 0) + 1)
      }
      console.log('  🟠 Marcas sin catálogo (anuncios afectados):')
      for (const [m, n] of Array.from(porMarca.entries()).sort((a,b) => b[1]-a[1])) {
        console.log(`     ${m}: ${n} anuncios`)
      }
      console.log()
    }

    if (debugNomatch.sinMarca.length > 0) {
      console.log(`  🔴 Muestra sin marca (primeros 20):`)
      for (const t of debugNomatch.sinMarca.slice(0, 20)) {
        console.log(`     "${t.substring(0, 80)}"`)
      }
      console.log()
    }

    if (debugNomatch.descartDif.length > 0) {
      console.log(`  🟡 Muestra descartados por diferenciador (primeros 20):`)
      for (const t of debugNomatch.descartDif.slice(0, 20)) {
        console.log(`     "${t.substring(0, 80)}"`)
      }
      console.log()
    }

    if (debugNomatch.ratioInsuf.length > 0) {
      console.log(`  ⚫ Muestra ratio insuficiente (primeros 20):`)
      for (const t of debugNomatch.ratioInsuf.slice(0, 20)) {
        console.log(`     "${t.substring(0, 80)}"`)
      }
      console.log()
    }

    // Escribir informe completo a fichero para análisis
    const { writeFileSync } = await import('fs')
    const report = {
      fecha:        new Date().toISOString(),
      totales: {
        sinMarca:    debugNomatch.sinMarca.length,
        sinCatalogo: debugNomatch.sinCatalogo.length,
        descartDif:  debugNomatch.descartDif.length,
        ratioInsuf:  debugNomatch.ratioInsuf.length,
      },
      sinMarca:    debugNomatch.sinMarca,
      sinCatalogo: debugNomatch.sinCatalogo,
      descartDif:  debugNomatch.descartDif,
      ratioInsuf:  debugNomatch.ratioInsuf,
    }
    const outFile = 'debug-nomatch.json'
    writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf-8')
    console.log(`  💾 Informe completo guardado en ${outFile}`)
  }

  if (updates.length === 0) {
    console.log('⚠️  Sin actualizaciones que aplicar.')
    return
  }

  // Muestra de matches para revisión visual
  console.log('📋 Muestra de matches (primeros 20):')
  for (const u of updates.slice(0, 20)) {
    console.log(`  "${u.titulo.substring(0, 55)}"`)
    console.log(`    → ${u.modelo}\n`)
  }

  // Detalle de ambiguos
  if (ambiguousItems.length > 0) {
    console.log(`\n⚠️  Detalle ambiguos (${ambiguousItems.length} casos):`)
    for (const a of ambiguousItems) {
      console.log(`  "${a.titulo.substring(0, 60)}"`)
      if (a.candidatos.length > 0) {
        for (const c of a.candidatos) {
          console.log(`    ↔ ${c.modelo} [${c.año}] tokens:[${c.tokens.join(', ')}]`)
        }
      } else {
        console.log(`    ↔ (empate en desempates finales — mismos tokens y año)`)
      }
      console.log()
    }
  }

  if (DRY_RUN) {
    console.log(`🔍 DRY RUN — se aplicarían ${updates.length} actualizaciones.`)
    return
  }

  // ── 4. Aplicar en batches ───────────────────────────────────────────
  const BATCH_SIZE = 100
  let applied = 0
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    for (const u of updates.slice(i, i + BATCH_SIZE)) {
      const { error } = await supabase
        .from('wallapop_cache')
        .update({ pala_id: u.pala_id, año: u.año, match_method: 'fuzzy_auto' })
        .eq('external_id', u.external_id)
      if (error) {
        console.error(`❌ Error actualizando ${u.external_id}:`, error)
      } else {
        applied++
      }
    }
  }

  console.log(`\n✅ ${applied} actualizaciones aplicadas.`)
}


// Solo ejecutar main() cuando se lanza directamente (no cuando Next.js importa el módulo durante el build)
if (!process.env.NEXT_PHASE && !process.env.NEXT_RUNTIME) {
  main().catch(err => {
    console.error('❌ Error fatal:', err)
    process.exit(1)
  })
}
