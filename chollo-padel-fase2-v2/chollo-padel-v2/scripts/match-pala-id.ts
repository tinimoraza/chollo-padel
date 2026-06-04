/**
 * scripts/match-pala-id.ts
 * ===========================================
 * Cruza los anuncios de wallapop_cache (pala_id = null) contra
 * la tabla palas del catÃ¡logo e intenta asignar el pala_id correcto.
 *
 * Estrategia de matching:
 *  1. Filtra candidatos por marca (campo marca en wallapop_cache, o detectada del tÃ­tulo)
 *  2. Extrae tokens del modelo del catÃ¡logo (sin marca ni aÃ±o)
 *  3. Comprueba que TODOS los tokens aparecen en el tÃ­tulo del anuncio
 *  4. Si el tÃ­tulo contiene un token diferenciador (hrd, team, ctrlâ¦) y hay candidatos
 *     que NO lo requieren compitiendo con los que SÃ â descarta los que no lo requieren
 *  5. Si hay aÃ±o en el tÃ­tulo, debe coincidir con el aÃ±o del catÃ¡logo
 *  6. Si hay un Ãºnico match â asigna pala_id
 *     Si hay varios matches â elige el de mÃ¡s tokens (mÃ¡s especÃ­fico)
 *     Si hay empate â no asigna (ambiguo)
 *
 * v17 (2026-05-31):
 *  - tokenizar: normaliza "c.6"/"c 6" â "c6" (Nox X-One C.6 se escribÃ­a con punto en Vinted)
 *  - KEEP_WORDS + TOKENS_DIFERENCIADORES: aÃ±adido "c6"
 *    Fix: anuncios "Nox X-One C.6" se asignaban a "Nox X-One 2025" en vez de "Nox X-One C6 2023"
 *
 * v16 (2026-05-26):
 *  - KEEP_WORDS: aÃ±adidos colores (black, blue, grey, white, red, green, orange, pink, yellow, purple, gold, silver, navy, lime)
 *    Problema: "Adidas Drive Black 2026" y "Adidas Drive Blue 2026" eran indistinguibles
 *    porque los colores no estaban en KEEP_WORDS â tokenizador los descartaba.
 *    Con este fix los colores se preservan y actÃºan como tokens diferenciadores.
 *  - TOKENS_DIFERENCIADORES: mismos colores aÃ±adidos.
 *    Efecto: "Drive Black" matchea solo con "Drive Black", no con "Drive Blue".
 *
 * v15 (2026-05-25):
 *  - MARCAS_CONOCIDAS: eliminado 'royal' (falso positivo con "Royal Blue" â marca Royal Padel incorrecta)
 *    Se mantiene 'royal padel' (dos palabras) que sÃ­ es inequÃ­voco.
 *  - MARCAS_CONOCIDAS: aÃ±adidos 'jhayber' â Jhayber y 'harlem' â Harlem
 *
 * v14 (2026-05-24):
 *  - palasPorMarca: alias 'starvie' â palas de 'Star Vie'
 *    detectarMarca() devuelve 'Starvie' pero BD tiene marca='Star Vie' â 0 candidatos
 *
 * v13 (2026-05-24):
 *  - tokenizar: normaliza "hard" â "hrd" y "soft" â "sft" en tÃ­tulos de anuncios
 *    (Vinted usa "Blast Pro Hard" en vez de "Blast Pro HRD")
 *  - KEEP_WORDS + TOKENS_DIFERENCIADORES: aÃ±adido "sft"
 *
 * v12 (2026-05-22):
 *  - matchPalaIds: carga tambiÃ©n anuncios con match_method=no_match o ambiguous
 *    para reintentarlos cuando el catÃ¡logo crece (fix ratio bajando con el tiempo)
 *  - matchPalaIds: escribe match_method='no_match'/'ambiguous' en los fallidos
 *    para distinguirlos de anuncios nuevos sin intentar
 *  - matchPalaIds: en matches exitosos tambiÃ©n escribe match_method='fuzzy_auto'
 *
 * v11 (2026-05-22):
 *  - "pro line" â "line" en tokenizar (Flow Pro Line matchea con tÃ­tulo "Flow Proline")
 *  - nÃºmero suelto 1-9 tras modelo normaliza a 0X ("Hack Hybrid 3" â token "03")
 *  - AT10_18K_ACTIVO: cuando inyecciÃ³n 18k activa, ignorar aÃ±o del tÃ­tulo en fases 1 y 2
 *    (vendedores ponen aÃ±o actual 2026 pero la pala AT10 18K es 2023/2024)
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

// âââ Constantes compartidas (una Ãºnica fuente de verdad) ââââââââââââââââââââââ

// Palabras a ignorar al tokenizar el modelo (artÃ­culos, preposiciones, etc.)
const STOP_WORDS = new Set([
  'de', 'da', 'del', 'la', 'el', 'y', 'e', 'con', 'para', 'pala', 'padel',
  'raqueta', 'serie', 'series', 'edition', 'version', 'by',
  'a22', 'a23', 'a24', 'rc',  // Akkeron â nunca aparecen en tÃ­tulos Wallapop
])

// Palabras que diferencian modelos â nunca ignorar aunque sean cortas
const KEEP_WORDS = new Set([
  'hrd', 'ctrl', 'soft', 'air', 'light', 'team', 'carbon',
  'match', 'drive', 'arrow', 'cross', 'hit', 'rx',
  '18k', '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena', 'hard',
  'pro', 'evo', 'plus', 'motion', 'elite', 'genius', 'attack',
  'lite',    // Nox AT10 Xtreme Lite
  'x',       // Head Speed Pro X vs Speed Pro
  'proplus', // Oxdog Ultimate Pro+ vs Pro
  'woman',   // Bullpadel versiÃ³n femenina (W normalizado â woman)
  'sft',     // Joma Blast Pro SFT vs HRD
  'c6',      // Nox X-One C6 vs X-One 2025
  // Nombres de modelo (para que tokenizar no los descarte)
  'trilogy', 'triton', 'metheora', 'raptor', 'basalto', 'drax', 'kenta', 'aquila', 'brava',
  'fenix', 'diablo', 'gea', 'spyder', 'yarara', 'mamba', 'titan',
  'axion', 'conqueror', 'canyon', 'explorer',
  'piton', 'patron', 'gladius',
  'summum',
  // v16: Colores â diferencian variantes de una misma familia
  // Ej: Adidas Drive Black 2026 vs Drive Blue 2026 vs Drive Grey 2026
  // Ej: Vibora Yarara Pro White 2.0 vs otras variantes
  'black', 'blue', 'grey', 'white', 'red', 'green', 'orange', 'pink',
  'yellow', 'purple', 'gold', 'silver', 'navy', 'lime',
  // EspaÃ±ol (variantes de catÃ¡logo: Negro-Rojo, Azul-Verdeâ¦)
  'negro', 'rojo', 'azul', 'blanco', 'verde', 'naranja', 'rosa',
  'amarillo', 'gris', 'dorado', 'plateado', 'morado', 'violeta', 'turquesa',
])

// Tokens que diferencian variantes dentro de una misma familia.
// Si el TÃTULO los contiene, los modelos que no los requieren son descartados.
// CLAVE: usar los tokens YA normalizados (hrd, no hrd+) igual que tokenizar().
const TOKENS_DIFERENCIADORES = new Set([
  'ctrl', 'carbon', 'team', 'hrd', 'light', 'soft', 'air',
  'pro', 'elite', 'attack', 'motion', 'drive', 'match',
  'arrow', 'cross', 'hit', 'rx', 'power', 'speed',
  '12k', 'alum', 'luxury', 'ltd', 'xtrem', 'arena',
  'sft',     // Joma Blast Pro SFT vs HRD
  'hybrid',  // Bullpadel Vertex 04 Hybrid vs Vertex 04 Comfort â diferenciador de subfamilia
  'lite',    // Nox AT10 Xtreme Lite vs Xtreme
  'x',       // Head Speed Pro X vs Speed Pro
  'proplus', // Oxdog Ultimate Pro+ vs Pro
  'woman',   // Bullpadel versiÃ³n femenina
  // v4 â diferenciadores de subfamilias Head, Bullpadel, Babolat, NOX...
  'extreme', // Head Extreme Pro vs Head Speed Pro
  'vertex',  // Bullpadel Vertex vs Hack vs Hack Ctrl
  'hack',    // Bullpadel Hack vs Vertex
  'genius',  // NOX AT10 Genius vs AT10 Xtreme
  'viper',   // Babolat Technical Viper vs Air Viper
  // 'coello' â tratado como jugador en JUGADORES_PATTERN, no como diferenciador
  'zephyr',
  'delta',
  'flash',
  'radical',
  'instinct',
  'prestige',
  'xplore',
  'contact',
  // 'xtreme' — normalizado a 'xtrem' en tokenizador, no necesario aqui
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
  // Si el tÃ­tulo dice "Trilogy" y el catÃ¡logo no tiene "Trilogy" â no_match
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
  // EspaÃ±ol (variantes de catÃ¡logo)
  'negro', 'rojo', 'azul', 'blanco', 'verde', 'naranja', 'rosa',
  'amarillo', 'gris', 'dorado', 'plateado', 'morado', 'violeta', 'turquesa',
])


// Colores opcionales en matching: si estÃ¡n en el CATÃLOGO pero no en el tÃ­tulo,
// no bloquean el match. Solo discriminan si el tÃ­tulo tiene un color diferente.
const TOKENS_COLOR = new Set<string>([
  'black', 'blue', 'grey', 'white', 'red', 'green', 'orange', 'pink',
  'yellow', 'purple', 'gold', 'silver', 'navy', 'lime',
  'negro', 'rojo', 'azul', 'blanco', 'verde', 'naranja', 'rosa',
  'amarillo', 'gris', 'dorado', 'plateado', 'morado', 'violeta', 'turquesa',
])
// Palabras que indican que el anuncio NO es una pala
const EXCLUIR_ACCESORIOS = new Set([
  // Accesorios pÃ¡del
  'bolsa', 'mochila', 'funda', 'paletero', 'grip', 'overgrip',
  'protector', 'muÃ±equera', 'bolas', 'pelota', 'pelotas', 'camiseta',
  'zapatilla', 'zapatillas', 'ropa', 'lote', 'antivibrador',
  // Calzado deportivo (listings en inglÃ©s de Vinted)
  'shoe', 'shoes', 'footwear', 'sneaker', 'sneakers',
  // Raquetas de tenis inequÃ­vocas (no confundibles con pÃ¡del)
  'raqueta tenis', 'raquetas tenis', 'tenis head', 'tenis wilson',
  'pro staff', 'blade v1', 'blade v9', 'blade v10', 'blade 98', 'blade 100',
  'pure drive', 'pure aero', 'pure strike',
  'hierros', 'madera', 'putter',
  // LÃ­neas/modelos de tenis de marcas que tambiÃ©n hacen pÃ¡del
  'flexpoint',         // Head Flexpoint (lÃ­nea de raquetas de tenis Head)
  'titanium graphite', // Wilson Titanium Graphite (tenis)
  'graphite ultra',    // Wilson (tenis)
  // Golf / esquÃ­ / otros deportes
  'speedback', 'driver golf', 'esquÃ­s', 'esqui', 'snowboard',
  // MÃ¡quinas y equipamiento
  'mÃ¡quina padel', 'lanzadora', 'slinger',
  // Modelos sin catÃ¡logo â evitar falsos positivos con familia similar
  'essex',  // Adidas Essex 2260 Metalbone
  // Otros deportes que cuelan con marcas de pÃ¡del
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
  // HolandÃ©s
  'rugzak', 'padeltas',
  // FrancÃ©s
  'sac Ã  dos', 'sac a dos',
])

// Versiones de generaciÃ³n estilo "3.4", "2.0", "1.5" â se extraen del modelo
// para usarlas como token de desempate. NO se eliminan del modelo.
// La regex captura el nÃºmero X.Y tal como aparece en el modelo del catÃ¡logo.
const VERSION_PATTERN = /\b(\d+\.\d+)\b/

// Marcas conocidas para detecciÃ³n desde tÃ­tulo cuando marca=null
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
  'vÃ­bora':     'Vibora',
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
  'tactical padel': 'Tactical Padel',
  'racket project': 'Racket Project',
  'rs padel':   'RS Padel',
  'nzn':        'NZN',
  // v10: alias de modelo â marca (tÃ­tulos sin nombre de marca explÃ­cito)
  'vertex':     'Bullpadel',  // "Vertex 05 2026" â Bullpadel
  'hack':       'Bullpadel',  // "Hack 04 Hybrid" â Bullpadel
  'indiga':     'Bullpadel',
  'hack ctrl':  'Bullpadel',
  'at10':       'Nox',        // "AT10 Genius 18K" â Nox
  'ea10':       'Nox',        // "EA10 Ventus Hybrid" â Nox
  'ml10':       'Nox',
  'metalbone':  'Adidas',     // "Metalbone 3.4 HRD+" â Adidas
  'metagame':   'Adidas',
  'metalwrist': 'Adidas',
  'yarara':     'Vibora',
  'electra':    'Siux',       // "Electra ST2" â Siux
  'pegasus':    'Siux',
}

// âââ Funciones de parsing ââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function tokenizar(texto: string): string[] {
  return texto
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // v10: quitar tildes ANTES de tokenizar (Ã©liteâelite, pÃ¡delâpadel, GonzÃ¡lezâgonzalez)
    .toLowerCase()
    .replace(/hrd\+/g, 'hrd')          // normalizar hrd+ â hrd
    .replace(/\bhdr\+?(?=\d)/g, 'hrd ')  // normalizar hdr+2026 â hrd 2026 (typo comÃºn en Vinted, sin espacio)
    .replace(/\bhdr\+?/g, 'hrd')         // normalizar hdr/hdr+ â hrd (typo comÃºn en Vinted)
    .replace(/\bhard\b/g, 'hrd')       // v13: normalizar "hard" â "hrd" (Vinted usa "Blast Pro Hard")
    .replace(/\bsoft\b/g, 'sft')       // v13: normalizar "soft" â "sft" (Joma SFT = Soft)
    .replace(/\bctr\b/g, 'ctrl')       // normalizar ctr â ctrl (Bullpadel usa CTR)
    .replace(/\bpwr\b/g, 'power')      // normalizar "PWR" â "power" (Bullpadel: "Indiga PWR" vs tÃ­tulo "Indiga Power")
    .replace(/pro\s*\+/g, 'proplus')   // normalizar "pro +" / "pro+" â proplus (Oxdog)
    .replace(/\bpro plus\b/g, 'proplus') // normalizar "pro plus" â proplus
    .replace(/\b(st|electra st)\s+(\d)\b/g, '$1$2') // normalizar "ST 2" â "st2", "Electra ST 2" â "electra st2"
    .replace(/(\d)w\b/g, '$1 woman')    // "04w" â "04 woman" (Bullpadel Vertex 04W, Hack 03Wâ¦)
    .replace(/\bw\b(?=\s|$)/g, 'woman') // normalizar "W" â "woman" (versiÃ³n femenina standalone)
    .replace(/\bproline\b/g, 'line') // normalizar "proline" â "line" (Bullpadel Flow Pro Line â Flow Line)
    .replace(/\bpro\s+line\b/g, 'line') // v11: "pro line" â "line" (mismo compuesto con espacio)
    .replace(/\btechnivap\b/g, 'technical') // normalizar "technivap" (typo comÃºn) â "technical"
    .replace(/\bhibrid\b/g, 'hybrid')       // Kuikma typo frecuente: Hibrid â Hybrid
    .replace(/\bc[.\s](\d)\b/g, 'c$1')    // normalizar "c.6"/"c 6" â "c6" (Nox X-One C6)
    .replace(/\b(hack|vertex|flow)\s+(\d)\b/g, '$1 0$2') // "Hack 3" â "Hack 03", "Vertex 4" â "Vertex 04"
    .replace(/\b(hack|vertex|flow)(0[1-9])\b/g, '$1 $2') // v10: "hack03" â "hack 03" (pegados sin espacio)
    .replace(/\b(hack|vertex|flow)(\s+\w+)\s+(\d)\b/g, '$1$2 0$3') // v11: "Hack Hybrid 3" â "Hack Hybrid 03"
    .replace(/\bcontrol\b/g, 'ctrl')        // normalizar "control" â "ctrl" (Bullpadel Indiga Control = CTR)
    .replace(/\b(\d+)\.(\d+)\b/g, 'v$1p$2') // preservar versiones X.Y como token Ãºnico antes de quitar puntuaciÃ³n: 3.3 â v3p3
    .replace(/[^\w\s]/g, ' ')          // quitar toda puntuaciÃ³n
    .split(/\s+/)
    .filter(t => t.length >= 2 || t === 'x' || /^\d$/.test(t) || /^\d{3,4}$/.test(t))  // preservar 'x' y dÃ­gitos simples (Siux Pro 3, Pro 4...)
    .filter(t =>
      KEEP_WORDS.has(t) ||
      (!STOP_WORDS.has(t) && (!/^\d+$/.test(t) || /^0[1-9]$/.test(t) || /^\d$/.test(t) || /^v\d+p\d+$/.test(t) || (/^\d{3,4}$/.test(t) && !/^20(1[89]|2[0-9])$/.test(t))))
    )  // preservar 01-09, dÃ­gitos simples, y versiones vXpY
}

function extraerAnio(texto: string): number | null {
  const m = texto.match(/\b(20(1[89]|2[0-9]))\b/)
  if (m) return parseInt(m[1])
  // AÃ±o de 2 dÃ­gitos al final: "EVO 25" â 2025
  const m2 = texto.match(/\s(2[0-9])(?:\s|$)/)
  if (m2) {
    const y = 2000 + parseInt(m2[1])
    if (y >= 2020 && y <= 2030) return y
  }
  return null
}

// Jugadores conocidos â se eliminan del modelo del catÃ¡logo para tokenizar,
// pero se usan como tokens de desempate cuando aparecen en el tÃ­tulo del anuncio.
const JUGADORES_PATTERN = /\b(juan lebron|lebron|ale galan|ale gal[aÃ¡]n|martita ortega|marta ortega|alex ruiz|agust[iÃ­]n tapia|arturo coello|paquito navarro|coki nieto|stupa|momo gonz[aÃ¡]lez|chingotto|franco chingotto|edu alonso|eduardo alonso)\b/gi

function extraerTokensModelo(modelo: string, marca: string): string[] {
  const sinMarca   = modelo.replace(new RegExp(`^${marca}\\s+`, 'i'), '')
  const sinAnio    = sinMarca.replace(/\b20\d{2}\b/, '').trim()
  const sinJugador = sinAnio.replace(JUGADORES_PATTERN, '').trim()
  return tokenizar(sinJugador)
}

/** Extrae los tokens de jugador del tÃ­tulo (para desempate). */
function extraerJugadoresTitulo(titulo: string): string[] {
  const matches: string[] = []
  const re = new RegExp(JUGADORES_PATTERN.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(titulo)) !== null) {
    // Normalizar sin tildes, minÃºsculas â pero CONSERVAR espacios internos
    // para que coincida con el nombre del modelo ("juan lebron", no "juanlebron")
    matches.push(m[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  }
  return matches
}

/** Extrae el nÃºmero de versiÃ³n X.Y de un modelo del catÃ¡logo, si lo tiene. Ej: "3.4" de "Metalbone 3.4 HRD+". */
function extraerVersionModelo(modelo: string): string | null {
  const m = modelo.match(VERSION_PATTERN)
  return m ? m[1] : null
}

/** Extrae el nÃºmero de versiÃ³n X.Y de un tÃ­tulo de anuncio, si lo tiene. */
function extraerVersionTitulo(titulo: string): string | null {
  // Ignorar aÃ±os (20XX) antes de buscar versiones
  const sinAnio = titulo.replace(/\b20\d{2}\b/g, '')
  const m = sinAnio.match(VERSION_PATTERN)
  return m ? m[1] : null
}

/** Intenta detectar la marca desde el tÃ­tulo cuando wallapop_cache.marca es null. */
function detectarMarcaDesideTitulo(titulo: string): string | null {
  // Normalizar tildes igual que tokenizar() para que los alias funcionen
  const tl = titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  // Primero intentar frases de dos palabras (ej: "drop shot", "black crown", "at10")
  for (const [key, val] of Object.entries(MARCAS_CONOCIDAS)) {
    if (key.includes(' ') && tl.includes(key)) return val
  }
  // Luego palabras sueltas â buscar en tokens para evitar falsos positivos
  const tokens = tl.split(/\s+/)
  for (const [key, val] of Object.entries(MARCAS_CONOCIDAS)) {
    if (!key.includes(' ') && tokens.includes(key)) return val
  }
  return null
}

// âââ Tipos ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

interface PalaCatalogo {
  id:     string
  marca:  string
  modelo: string
  aÃ±o:    number
  tokens: string[]
}

interface CacheItem {
  external_id: string
  title:       string
  marca:       string | null
}

// âââ LÃ³gica central de matching (reutilizada por main y matchPalaIds) âââââââââ

interface MatchResult {
  external_id:  string
  pala_id:      string
  aÃ±o:          number
  titulo:       string
  modelo:       string
  yearAmbiguous?: boolean  // true â buen match pero aÃ±o incierto (mÃºltiples versiones)
}

// Umbral de match parcial: % mÃ­nimo de tokens del modelo que deben estar en el tÃ­tulo
// Se reduce a 0.5 cuando el tÃ­tulo contiene aÃ±o + jugador conocido (identificadores fuertes
// que compensan un nombre abreviado, ej: "Nox AT10 18K 2025 AgustÃ­n Tapia")
// Se reduce a 0.4 cuando el tÃ­tulo es corto (â¤5 tokens Ãºtiles) â tÃ­tulos tipo "Vertex 05 2026"
const PARTIAL_MATCH_THRESHOLD      = 0.75  // subido de 0.6 â menor permisividad
const PARTIAL_MATCH_THRESHOLD_SOFT = 0.65  // con aÃ±o + jugador en tÃ­tulo (antes 0.5)
const PARTIAL_MATCH_THRESHOLD_MIN  = 0.55  // tÃ­tulo corto â¤5 tokens (antes 0.4)

function matchearItem(
  item: CacheItem,
  palasPorMarca: Map<string, PalaCatalogo[]>
): MatchResult | 'noMatch' | 'ambiguous' | 'excluido' {
  const titleLower = item.title.toLowerCase()

  // Descartar accesorios
  if (Array.from(EXCLUIR_ACCESORIOS).some(w => titleLower.includes(w))) return 'excluido'

  // Resolver marca: desde wallapop_cache.marca o detectar del tÃ­tulo
  let marcaNorm = item.marca?.toLowerCase() ?? null
  if (!marcaNorm) {
    const detectada = detectarMarcaDesideTitulo(item.title)
    if (detectada) marcaNorm = detectada.toLowerCase()
  }

  // Guard: marcas que fabrican TANTO tenis como pÃ¡del (Head, Wilson, Babolat, Adidas, Dunlop).
  // Si el tÃ­tulo contiene "raqueta" pero NO "padel"/"pala" â probable raqueta de tenis, descartar.
  // Marcas padeleras puras (Bullpadel, Siux, Nox, StarVieâ¦) pueden decir "raqueta" sin problema.
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
  // ââ difEnTitulo se calcula con los tokens REALES del tÃ­tulo, ANTES de inyecciones ââ
  // AsÃ­ los tokens inyectados (genius, alum, technicalâ¦) no aparecen como
  // "diferenciadores extra" del tÃ­tulo y no descartan candidatos incorrectamente.
  const difEnTitulo = new Set(tokensTitle.filter(t => TOKENS_DIFERENCIADORES.has(t)))
  // Babolat: "Viper Lebron" siempre es Technical Viper â inyectar "technical" si falta
  if (marcaNorm === 'babolat' && tokensTitle.includes('viper') && tokensTitle.some(t => t === 'lebron' || t === 'juan') && !tokensTitle.includes('technical')) {
    tokensTitle = [...tokensTitle, 'technical']
  }
  // Nox AT10 18K: puede que el tÃ­tulo no incluya "genius"/"alum" que sÃ­ estÃ¡n en el modelo
  // Solo inyectar tokens Y solo ignorar aÃ±o si hay UN ÃNICO modelo AT10 18K en catÃ¡logo.
  // Con mÃºltiples versiones (2022-2026) hay que respetar el aÃ±o del tÃ­tulo para no mezclar modelos.
  const modelos18k = (palasPorMarca.get('nox') ?? []).filter(p => p.tokens.includes('at10') && p.tokens.includes('18k'))
  const AT10_18K_ACTIVO = marcaNorm === 'nox' && tokensTitle.includes('at10') && tokensTitle.includes('18k') && modelos18k.length === 1
  if (AT10_18K_ACTIVO) {
    if (!tokensTitle.includes('genius')) tokensTitle = [...tokensTitle, 'genius']
    if (!tokensTitle.includes('alum')) tokensTitle = [...tokensTitle, 'alum']
  }
  // AT10 18K con mÃºltiples versiones: inyectar alum+genius si el tÃ­tulo no los tiene
  // (vendedores escriben "AT10 18K 2025" sin "alum" aunque el modelo oficial sÃ­ lo lleva)
  if (marcaNorm === 'nox' && tokensTitle.includes('at10') && tokensTitle.includes('18k') && modelos18k.length > 1) {
    if (!tokensTitle.includes('genius')) tokensTitle = [...tokensTitle, 'genius']
    if (!tokensTitle.includes('alum'))   tokensTitle = [...tokensTitle, 'alum']
  }
  // AT10 Attack sin 18K â en catÃ¡logo siempre es "Genius Attack"
  if (marcaNorm === 'nox' && tokensTitle.includes('at10') && tokensTitle.includes('attack') && !tokensTitle.includes('genius')) {
    tokensTitle = [...tokensTitle, 'genius']
  }
  // AT10 Genius Attack: los modelos del catÃ¡logo llevan 12k+alum pero los tÃ­tulos no siempre
  if (marcaNorm === 'nox' && tokensTitle.includes('at10') && tokensTitle.includes('attack')) {
    if (!tokensTitle.includes('12k'))  tokensTitle = [...tokensTitle, '12k']
    if (!tokensTitle.includes('alum')) tokensTitle = [...tokensTitle, 'alum']
  }
  // AT10 12K sin "genius" â inyectar genius (AT10 Genius 12K es el modelo estÃ¡ndar)
  if (marcaNorm === 'nox' && tokensTitle.includes('at10') && tokensTitle.includes('12k') && !tokensTitle.includes('genius')) {
    tokensTitle = [...tokensTitle, 'genius']
  }
  // difEnTitulo ya calculado arriba, antes de inyecciones â no recalcular aquÃ­
  const jugadoresTitulo = extraerJugadoresTitulo(item.title)

  // ââ Fase 1: match ESTRICTO (todos los tokens del modelo en el tÃ­tulo) ââââââ
  let scored = candidatas
    .map(pala => {
      // v11: para AT10 18K, ignorar aÃ±o del tÃ­tulo (vendedores ponen aÃ±o actual aunque la pala sea 2023/2024)
      if (anioTitulo !== null && pala.aÃ±o !== anioTitulo && !AT10_18K_ACTIVO) return null
      if (pala.tokens.length === 0) return null
      // Tokens no-color: deben estar TODOS en el tÃ­tulo
      const tokensReq = pala.tokens.filter(t => !TOKENS_COLOR.has(t))
      if (tokensReq.some(t => !tokensTitle.includes(t))) return null
      // Colores: solo discriminan si el tÃ­tulo tiene un color diferente
      const colorsTituloF1 = tokensTitle.filter(t => TOKENS_COLOR.has(t))
      const colorsCatalogoF1 = pala.tokens.filter(t => TOKENS_COLOR.has(t))
      if (colorsTituloF1.length > 0 && colorsCatalogoF1.length > 0) {
        if (!colorsTituloF1.some(c => colorsCatalogoF1.includes(c))) return null
      }
      const tokensDif = pala.tokens.filter(t => TOKENS_DIFERENCIADORES.has(t) && !TOKENS_COLOR.has(t))
      if (!tokensDif.every(t => tokensTitle.includes(t))) return null
      // FASE 1: tambiÃ©n rechazar si el tÃ­tulo tiene diferenciadores que el modelo no tiene
      const difExtra1 = Array.from(difEnTitulo).filter(d => !pala.tokens.includes(d) && !TOKENS_COLOR.has(d))
      if (difExtra1.length > 0) return null
      return { pala, score: pala.tokens.length, partial: false }
    })
    .filter(Boolean) as { pala: PalaCatalogo; score: number; partial: boolean }[]

  // ââ Fase 2: match PARCIAL si la fase 1 no da nada ââââââââââââââââââââââââ
  // Condiciones: â¥60% tokens del modelo en tÃ­tulo + todos los diferenciadores presentes
  // Solo se aplica si el resultado es Ãºnico (evitar falsos positivos por ambigÃ¼edad)
  // ExcepciÃ³n: threshold baja a 50% si el tÃ­tulo tiene aÃ±o + jugador (identificadores fuertes)
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
    // Extraer nÃºmeros de modelo del tÃ­tulo (01-09, v2, v3... pero NO aÃ±os 20XX)
    // Estos son tokens que identifican la versiÃ³n exacta del modelo
    const numerosModelo = titleLower
      .replace(/\b20\d{2}\b/g, '')          // quitar aÃ±os
      .replace(/hrd\+/g, 'hrd')
      .replace(/\b(\d+)\.(\d+)\b/g, 'VER')  // ignorar versiones X.Y â no son nÃºmeros de modelo
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => /^(0[1-9]|v\d+|\d{1,2})$/.test(t) && t !== 'VER')  // 01-09, v2, v10, 3, 4 â excluir versiones

    const parciales = candidatas
      .map(pala => {
        // v11: para AT10 18K, ignorar aÃ±o del tÃ­tulo
        if (anioTitulo !== null && pala.aÃ±o !== anioTitulo && !AT10_18K_ACTIVO) return null
        if (pala.tokens.length === 0) return null

        // GUARD: si el tÃ­tulo contiene un nÃºmero de modelo (04, 05, v10...)
        // y el modelo del catÃ¡logo tiene un nÃºmero distinto â falso positivo seguro
        if (numerosModelo.length > 0) {
          const numerosModPala = pala.tokens.filter(t => /^(0[1-9]|v\d+|\d{1,2})$/.test(t) && !/^v\d+p\d+$/.test(t))  // excluir versiones vXpY
          if (numerosModPala.length > 0) {
            // El modelo tiene nÃºmero â debe coincidir con alguno del tÃ­tulo
            const hayConflicto = numerosModPala.every(n => !numerosModelo.includes(n))
            if (hayConflicto) return null
          }
        }
        // GUARD: si el modelo tiene nÃºmero de versiÃ³n (03, 04...) y el tÃ­tulo NO tiene
        // ningÃºn nÃºmero de modelo â ambiguo, no asignar en match parcial
        if (numerosModelo.length === 0) {
          const numerosModPala = pala.tokens.filter(t => /^0[1-9]$/.test(t))  // solo 01-09 (versiones Bullpadel)
          if (numerosModPala.length > 0) return null
        }

        // Ratio basado en tokens no-color (para no penalizar por colores del catÃ¡logo)
        const tokensReqF2 = pala.tokens.filter(t => !TOKENS_COLOR.has(t))
        const tokensMatchF2 = pala.tokens.filter(t => tokensTitle.includes(t))
        const ratioBase = tokensReqF2.length > 0 ? tokensReqF2.filter(t => tokensTitle.includes(t)).length / tokensReqF2.length : 1
        if (ratioBase < threshold) return null
        // Colores: solo discriminan si el tÃ­tulo tiene un color diferente
        const colorsTituloF2 = tokensTitle.filter(t => TOKENS_COLOR.has(t))
        const colorsCatalogoF2 = pala.tokens.filter(t => TOKENS_COLOR.has(t))
        if (colorsTituloF2.length > 0 && colorsCatalogoF2.length > 0) {
          if (!colorsTituloF2.some(c => colorsCatalogoF2.includes(c))) return null
        }
        // Los diferenciadores no-color del modelo SÃ deben estar en el tÃ­tulo
        const tokensDif = pala.tokens.filter(t => TOKENS_DIFERENCIADORES.has(t) && !TOKENS_COLOR.has(t))
        if (!tokensDif.every(t => tokensTitle.includes(t))) return null
        // Los diferenciadores no-color del tÃ­tulo NO pueden apuntar a otro modelo
        const difExtra = Array.from(difEnTitulo).filter(d => !pala.tokens.includes(d) && !TOKENS_COLOR.has(d))
        if (difExtra.length > 0) return null
        return { pala, score: tokensMatchF2.length, partial: true }
      })
      .filter(Boolean) as { pala: PalaCatalogo; score: number; partial: boolean }[]

    // Solo asignar si hay un Ãºnico candidato parcial claro (o varios del mismo aÃ±o â mÃ¡s reciente)
    if (parciales.length > 0) {
      // Si el tÃ­tulo NO menciona jugador, descartar modelos que tengan jugador
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
        const maxAnioP = Math.max(...topParc.map(s => s.pala.aÃ±o))
        const topAÃ±oP  = topParc.filter(s => s.pala.aÃ±o === maxAnioP)
        if (topAÃ±oP.length === 1) scored = topAÃ±oP
      }
    }
  }

  if (scored.length === 0) return 'noMatch'

  // ââ Guard: modelo genÃ©rico sin aÃ±o â NO asignar ââââââââââââââââââââââââââ
  // Si el modelo matcheado tiene â¤2 tokens Y el tÃ­tulo no tiene aÃ±o, es demasiado
  // genÃ©rico ("Pala bullpadel", "Pala Nox"...) y asignarÃ­a al modelo mÃ¡s reciente
  // aunque sea incorrecto. Mejor dejarlo como noMatch para no contaminar el TOP.
  if (scored.length === 1 && scored[0].pala.tokens.length <= 2 && anioTitulo === null) {
    const baseTokens = scored[0].pala.tokens
    const candidatas2 = palasPorMarca.get(marcaNorm!) ?? []
    const sibling = candidatas2.filter(p =>
      p.id !== scored[0].pala.id &&
      baseTokens.every(t => p.tokens.includes(t))
    )
    if (sibling.length > 0) return 'noMatch'  // genÃ©rico con mÃºltiples candidatos â descartar
  }

  // ââ Desempate 1: fix HRD+âbase, Teamâbase âââââââââââââââââââââââââââââââââ
  if (difEnTitulo.size > 0) {
    const conDif = scored.filter(s => s.pala.tokens.some(t => TOKENS_DIFERENCIADORES.has(t)))
    if (conDif.length > 0) scored = conDif
  }

  if (scored.length === 0) return 'noMatch'
  if (scored.length === 1) {
    const winner = scored[0].pala
    return { external_id: item.external_id, pala_id: winner.id, aÃ±o: winner.aÃ±o, titulo: item.title, modelo: winner.modelo }
  }

  // ââ Desempate 1c: mÃ¡s diferenciadores del tÃ­tulo coinciden con el modelo ââ
  // Ej: "Head Extreme Motion" â extreme+motion en tÃ­tulo â gana Head Extreme Motion
  // Ej: "Head Extreme Pro Coello" â extreme+pro+coello en tÃ­tulo
  //   Head Extreme Pro tokens:[extreme,pro] â todos sus difs estÃ¡n en tÃ­tulo â
  //   Head Coello Pro  tokens:[coello,pro]  â todos sus difs estÃ¡n en tÃ­tulo â (empate)
  //   â paso siguiente: descartar los que tienen difs que NO estÃ¡n en el tÃ­tulo
  if (difEnTitulo.size > 0) {
    // Paso A: preferir los que tienen mÃ¡s difs del tÃ­tulo en sus tokens
    const difMatch = (s: { pala: PalaCatalogo }) =>
      Array.from(difEnTitulo).filter(d => s.pala.tokens.includes(d)).length
    const maxDifMatch = Math.max(...scored.map(difMatch))
    const conMaxDif = scored.filter(s => difMatch(s) === maxDifMatch)
    if (conMaxDif.length > 0 && conMaxDif.length < scored.length) scored = conMaxDif

    // Paso B: descartar candidatos que tienen difs propios NO presentes en el tÃ­tulo
    // Ej: "Head Extreme Pro Coello" â tÃ­tulo tiene [extreme,pro,coello]
    //   Head Extreme Pro [extreme,pro] â todos en tÃ­tulo â â conservar
    //   Head Coello Pro  [coello,pro]  â todos en tÃ­tulo â â conservar (empate, seguimos)
    // Ej: "Bullpadel Vertex 04 Comfort" â tÃ­tulo tiene [vertex,comfort]
    //   Vertex 04 Hybrid [vertex,hybrid] â hybrid NO en tÃ­tulo â descartar
    const sinDifExtra = scored.filter(s => {
      const difsPropios = s.pala.tokens.filter(t => TOKENS_DIFERENCIADORES.has(t))
      return difsPropios.every(t => difEnTitulo.has(t))
    })
    if (sinDifExtra.length > 0 && sinDifExtra.length < scored.length) scored = sinDifExtra
  }

  if (scored.length === 0) return 'noMatch'
  if (scored.length === 1) {
    const winner = scored[0].pala
    return { external_id: item.external_id, pala_id: winner.id, aÃ±o: winner.aÃ±o, titulo: item.title, modelo: winner.modelo }
  }

  // ââ Desempate 1b: jugador en tÃ­tulo (Juan Lebron, Ale Galanâ¦) ââââââââââââ
  // Si el tÃ­tulo menciona un jugador â preferir modelos que lo incluyan.
  // Si el tÃ­tulo NO menciona jugador â preferir modelos que NO lo incluyan.
  // Los tokens de jugador se eliminan del modelo en extraerTokensModelo(), asÃ­ que
  // comparamos contra el nombre completo del modelo (en minÃºsculas normalizado).
  {
    const RE_JUG = new RegExp(JUGADORES_PATTERN.source, 'gi')
    const modeloTieneJugador = (modelo: string) =>
      RE_JUG.test(modelo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))

    if (jugadoresTitulo.length > 0) {
      // TÃ­tulo CON jugador â filtrar a los que lo incluyen
      const conJugador = scored.filter(s => {
        const modeloNorm = s.pala.modelo.toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        // Alias: "marta ortega" en tÃ­tulo busca tambiÃ©n "martita ortega" en modelo
        const JUGADOR_ALIAS: Record<string, string[]> = { 'marta ortega': ['martita ortega', 'marta ortega'] }
        return jugadoresTitulo.some(j => {
          const aliases = JUGADOR_ALIAS[j] ?? [j]
          return aliases.some(a => modeloNorm.includes(a))
        })
      })
      if (conJugador.length > 0 && conJugador.length < scored.length) scored = conJugador
    } else {
      // TÃ­tulo SIN jugador â descartar modelos que tengan jugador (no solo en empate)
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
    return { external_id: item.external_id, pala_id: winner.id, aÃ±o: winner.aÃ±o, titulo: item.title, modelo: winner.modelo }
  }

  // ââ Desempate 2: nÃºmero de versiÃ³n X.Y âââââââââââââââââââââââââââââââââââ
  if (versionTitulo !== null) {
    const conVersion = scored.filter(s => extraerVersionModelo(s.pala.modelo) === versionTitulo)
    if (conVersion.length > 0) scored = conVersion
  }

  if (scored.length === 1) {
    const winner = scored[0].pala
    return { external_id: item.external_id, pala_id: winner.id, aÃ±o: winner.aÃ±o, titulo: item.title, modelo: winner.modelo }
  }

  // ââ Desempate 3: especificidad de tokens ââââââââââââââââââââââââââââââââââ
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
    return { external_id: item.external_id, pala_id: winner.id, aÃ±o: winner.aÃ±o, titulo: item.title, modelo: winner.modelo }
  }

  // ââ Desempate 4: aÃ±o mÃ¡s reciente âââââââââââââââââââââââââââââââââââââââââ
  const maxAnio     = Math.max(...topSinExtra.map(s => s.pala.aÃ±o))
  const topRecientes = topSinExtra.filter(s => s.pala.aÃ±o === maxAnio)

  if (topRecientes.length === 1) {
    const winner = topRecientes[0].pala
    return { external_id: item.external_id, pala_id: winner.id, aÃ±o: winner.aÃ±o, titulo: item.title, modelo: winner.modelo }
  }

  return 'ambiguous'
}

// âââ Exports adicionales para el sistema de auditorÃ­a ââââââââââââââââââââââââ
// El auditor de matches (api/cron/audit-matches) reutiliza estas funciones
// para verificar que los matches en TOP y CHOLLOS son coherentes.
export { tokenizar, extraerAnio, extraerTokensModelo, detectarMarcaDesideTitulo, matchearItem }
export type { PalaCatalogo, CacheItem, MatchResult }
export { STOP_WORDS, KEEP_WORDS, TOKENS_DIFERENCIADORES, EXCLUIR_ACCESORIOS, MARCAS_CONOCIDAS }

// âââ FunciÃ³n exportable para scrapers ââââââââââââââââââââââââââââââââââââââââ

export async function matchPalaIds(
  supabase: ReturnType<typeof createClient> | any,
  opts?: { verbose?: boolean }
): Promise<{ matched: number; ambiguous: number; noMatch: number }> {
  const verbose = opts?.verbose ?? true

  if (verbose) console.log('\nð Match pala_id iniciado...')

  // Supabase limita a 1000 filas por defecto â paginamos para traer todo el catÃ¡logo
  const palasRaw: any[] = []
  const PAGE_SIZE = 1000
  let fromRow = 0
  while (true) {
    const { data, error } = await supabase
      .from('palas')
      .select('id, marca, modelo, aÃ±o')
      .range(fromRow, fromRow + PAGE_SIZE - 1)
    if (error) {
      console.error('â matchPalaIds: Error cargando palas:', error)
      return { matched: 0, ambiguous: 0, noMatch: 0 }
    }
    if (!data || data.length === 0) break
    palasRaw.push(...data)
    if (data.length < PAGE_SIZE) break
    fromRow += PAGE_SIZE
  }
  const palasErr = null

  if (!palasRaw || palasRaw.length === 0) {
    console.error('â matchPalaIds: sin datos de palas')
    return { matched: 0, ambiguous: 0, noMatch: 0 }
  }

  const palas: PalaCatalogo[] = palasRaw.map((p: any) => ({
    id:     p.id,
    marca:  p.marca,
    modelo: p.modelo,
    aÃ±o:    p.aÃ±o,
    tokens: extraerTokensModelo(p.modelo, p.marca),
  }))

  const palasPorMarca = new Map<string, PalaCatalogo[]>()
  for (const pala of palas) {
    const m = pala.marca.toLowerCase()
    if (!palasPorMarca.has(m)) palasPorMarca.set(m, [])
    palasPorMarca.get(m)!.push(pala)
  }
  // v14: alias star vie â starvie
  // BD usa "Star Vie" (con espacio), detectarMarca() devuelve "Starvie" â sin candidatos
  const starVieList = palasPorMarca.get('star vie') ?? []
  if (starVieList.length > 0) palasPorMarca.set('starvie', starVieList)

  // Cargar anuncios sin pala_id (nunca intentados, no_match previo, o ambiguous previo)
  // â paginado (Supabase limita a 1000 por query)
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
      console.error('â matchPalaIds: Error cargando cache:', batchErr)
      return { matched: 0, ambiguous: 0, noMatch: 0 }
    }
    if (!batch || batch.length === 0) break
    items.push(...(batch as CacheItem[]))
    if (batch.length < PAGE_CACHE) break
    fromCache += PAGE_CACHE
  }

  let matched = 0, ambiguous = 0, noMatch = 0
  const updates:            { external_id: string; pala_id: string; aÃ±o: number; method: string }[] = []
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
    updates.push({ external_id: result.external_id, pala_id: result.pala_id, aÃ±o: result.aÃ±o, method: 'fuzzy_auto' })
  }

  const BATCH = 100

  // Escribir pala_id en los matches
  if (updates.length > 0) {
    for (let i = 0; i < updates.length; i += BATCH) {
      for (const u of updates.slice(i, i + BATCH)) {
        await supabase
          .from('wallapop_cache')
          .update({ pala_id: u.pala_id, aÃ±o: u.aÃ±o, match_method: u.method })
          .eq('external_id', u.external_id)
      }
    }
  }

  // Marcar los fallidos con match_method para que se reintenten cuando el catÃ¡logo crezca
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
    console.log(`  â Match pala_id: ${matched} asignados, ${ambiguous} ambiguos, ${noMatch} sin match`)
  }

  return { matched, ambiguous, noMatch }
}

// âââ main (ejecuciÃ³n standalone) âââââââââââââââââââââââââââââââââââââââââââââ

async function main() {
  console.log(`ð HUNTPADEL â Match pala_id${DRY_RUN ? ' [DRY RUN]' : ''}`)
  console.log(`ð ${new Date().toISOString()}\n`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

  // ââ 1. Cargar catÃ¡logo de palas ââââââââââââââââââââââââââââââââââââââââââââ
  console.log('ð Cargando catÃ¡logo de palas...')
  // Supabase limita a 1000 filas por defecto â paginamos para traer todo el catÃ¡logo
  const palasRaw: any[] = []
  const PAGE = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('palas')
      .select('id, marca, modelo, aÃ±o')
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('â Error cargando palas:', error)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    palasRaw.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  const palasErr = null

  if (!palasRaw || palasRaw.length === 0) {
    console.error('â Error cargando palas: sin datos')
    process.exit(1)
  }

  const palas: PalaCatalogo[] = palasRaw.map(p => ({
    id:     p.id,
    marca:  p.marca,
    modelo: p.modelo,
    aÃ±o:    p.aÃ±o,
    tokens: extraerTokensModelo(p.modelo, p.marca),
  }))

  const palasPorMarca = new Map<string, PalaCatalogo[]>()
  for (const pala of palas) {
    const m = pala.marca.toLowerCase()
    if (!palasPorMarca.has(m)) palasPorMarca.set(m, [])
    palasPorMarca.get(m)!.push(pala)
  }
  // v14: alias star vie â starvie
  // BD usa "Star Vie" (con espacio), detectarMarca() devuelve "Starvie" â sin candidatos
  const starVieListMain = palasPorMarca.get('star vie') ?? []
  if (starVieListMain.length > 0) palasPorMarca.set('starvie', starVieListMain)

  console.log(`  ${palas.length} palas cargadas, ${palasPorMarca.size} marcas\n`)

  // Debug: tokens de palas problemÃ¡ticas conocidas
  const ejemplosDebug = [
    'Adidas Metalbone HRD',
    'Adidas Metalbone 3.3',
    'Adidas Metalbone 3.4',
    'Babolat Technical Viper 2024',
    'Bullpadel Vertex 03 2023',
    'Bullpadel Hack CTRL',
  ]
  console.log('ð Debug tokens de palas clave:')
  for (const ej of ejemplosDebug) {
    const pala = palas.find(p => p.modelo.toLowerCase().includes(ej.toLowerCase()))
    if (pala) {
      const ver = extraerVersionModelo(pala.modelo)
      console.log(`  "${pala.modelo}": tokens:[${pala.tokens.join(', ')}] versiÃ³n:${ver ?? 'ninguna'}`)
    }
  }
  console.log()

  // ââ 2. Cargar anuncios sin pala_id (paginado â Supabase limita a 1000) ââââââ
  console.log('ð¦ Cargando wallapop_cache sin pala_id...')
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
      console.error('â Error cargando wallapop_cache:', batchErr)
      process.exit(1)
    }
    if (!batch || batch.length === 0) break
    items.push(...(batch as CacheItem[]))
    if (batch.length < PAGE_ITEMS) break
    fromItems += PAGE_ITEMS
  }

  console.log(`  ${items.length} anuncios sin pala_id\n`)

  // ââ 3. Matchear âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  let matched   = 0
  let ambiguous = 0
  let noMatch   = 0
  let excluidos = 0
  const updates: MatchResult[] = []
  const ambiguousItems: { titulo: string; candidatos: PalaCatalogo[] }[] = []

  // Contadores para --debug-nomatch
  const debugNomatch = {
    sinMarca:       [] as string[],  // ð´ No se detectÃ³ marca
    sinCatalogo:    [] as string[],  // ð  Marca detectada pero sin palas en catÃ¡logo
    descartDif:     [] as string[],  // ð¡ Descartado por diferenciador extra en tÃ­tulo
    ratioInsuf:     [] as string[],  // â« Ratio < threshold â tokens insuficientes
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

  console.log(`ð Resultados del matching:`)
  console.log(`  â Matches claros:  ${matched}`)
  console.log(`  â ï¸  Ambiguos:       ${ambiguous}`)
  console.log(`  â Sin match:       ${noMatch}`)
  console.log(`  ð« Accesorios:      ${excluidos}\n`)

  // ââ Debug-nomatch: categorÃ­as de fallos ââââââââââââââââââââââââââââââââââ
  if (DEBUG_NOMATCH) {
    console.log('ð DEBUG NOMATCH â CategorÃ­as de los sin-match:')
    console.log(`  ð´ Sin marca detectada:          ${debugNomatch.sinMarca.length}`)
    console.log(`  ð  Marca sin catÃ¡logo (import!): ${debugNomatch.sinCatalogo.length}`)
    console.log(`  ð¡ Descartado por diferenciador: ${debugNomatch.descartDif.length}`)
    console.log(`  â« Ratio insuficiente (<60%):    ${debugNomatch.ratioInsuf.length}`)
    console.log()

    if (debugNomatch.sinCatalogo.length > 0) {
      // Agrupar por marca para saber quÃ© importar
      const porMarca = new Map<string, number>()
      for (const t of debugNomatch.sinCatalogo) {
        const marca = t.match(/^\[([^\]]+)\]/)?.[1] ?? 'desconocida'
        porMarca.set(marca, (porMarca.get(marca) ?? 0) + 1)
      }
      console.log('  ð  Marcas sin catÃ¡logo (anuncios afectados):')
      for (const [m, n] of Array.from(porMarca.entries()).sort((a,b) => b[1]-a[1])) {
        console.log(`     ${m}: ${n} anuncios`)
      }
      console.log()
    }

    if (debugNomatch.sinMarca.length > 0) {
      console.log(`  ð´ Muestra sin marca (primeros 20):`)
      for (const t of debugNomatch.sinMarca.slice(0, 20)) {
        console.log(`     "${t.substring(0, 80)}"`)
      }
      console.log()
    }

    if (debugNomatch.descartDif.length > 0) {
      console.log(`  ð¡ Muestra descartados por diferenciador (primeros 20):`)
      for (const t of debugNomatch.descartDif.slice(0, 20)) {
        console.log(`     "${t.substring(0, 80)}"`)
      }
      console.log()
    }

    if (debugNomatch.ratioInsuf.length > 0) {
      console.log(`  â« Muestra ratio insuficiente (primeros 20):`)
      for (const t of debugNomatch.ratioInsuf.slice(0, 20)) {
        console.log(`     "${t.substring(0, 80)}"`)
      }
      console.log()
    }

    // Escribir informe completo a fichero para anÃ¡lisis
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
    console.log(`  ð¾ Informe completo guardado en ${outFile}`)
  }

  if (updates.length === 0) {
    console.log('â ï¸  Sin actualizaciones que aplicar.')
    return
  }

  // Muestra de matches para revisiÃ³n visual
  console.log('ð Muestra de matches (primeros 20):')
  for (const u of updates.slice(0, 20)) {
    console.log(`  "${u.titulo.substring(0, 55)}"`)
    console.log(`    â ${u.modelo}\n`)
  }

  // Detalle de ambiguos
  if (ambiguousItems.length > 0) {
    console.log(`\nâ ï¸  Detalle ambiguos (${ambiguousItems.length} casos):`)
    for (const a of ambiguousItems) {
      console.log(`  "${a.titulo.substring(0, 60)}"`)
      if (a.candidatos.length > 0) {
        for (const c of a.candidatos) {
          console.log(`    â ${c.modelo} [${c.aÃ±o}] tokens:[${c.tokens.join(', ')}]`)
        }
      } else {
        console.log(`    â (empate en desempates finales â mismos tokens y aÃ±o)`)
      }
      console.log()
    }
  }

  if (DRY_RUN) {
    console.log(`ð DRY RUN â se aplicarÃ­an ${updates.length} actualizaciones.`)
    return
  }

  // ââ 4. Aplicar en batches âââââââââââââââââââââââââââââââââââââââââââ
  const BATCH_SIZE = 100
  let applied = 0
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    for (const u of updates.slice(i, i + BATCH_SIZE)) {
      const { error } = await supabase
        .from('wallapop_cache')
        .update({ pala_id: u.pala_id, aÃ±o: u.aÃ±o, match_method: 'fuzzy_auto' })
        .eq('external_id', u.external_id)
      if (error) {
        console.error(`â Error actualizando ${u.external_id}:`, error)
      } else {
        applied++
      }
    }
  }

  console.log(`\nâ ${applied} actualizaciones aplicadas.`)
}


// Solo ejecutar main() cuando se lanza directamente (no cuando Next.js importa el mÃ³dulo durante el build)
if (!process.env.NEXT_PHASE && !process.env.NEXT_RUNTIME) {
  main().catch(err => {
    console.error('â Error fatal:', err)
    process.exit(1)
  })
}
