/**
 * scripts/extract-atributos.ts
 * =============================================================================
 * Extractor rule-based de atributos canónicos de palas de pádel.
 *
 * Entrada : título crudo de cualquier tienda (o campo model de Padelful)
 * Salida  : { marca, linea, modelo, variante, año }
 *
 * Principio: la identidad de una pala NO es su nombre — es la combinación
 * de atributos estructurados. Este módulo los extrae con reglas explícitas,
 * no con similitud textual ni embeddings.
 *
 * Jerarquía de extracción:
 *   1. Marca   → diccionario con aliases normalizados
 *   2. Año     → regex sobre el texto completo
 *   3. Línea   → diccionario por marca (orden de especificidad descendente)
 *   4. Variante → diccionario global de variantes conocidas
 *   5. Modelo  → lo que queda tras extraer marca, línea, variante y año
 * =============================================================================
 */

// ─── Normalización ────────────────────────────────────────────────────────────

export function normalizar(texto: string): string {
  return texto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // quitar acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')                       // solo alfanumérico
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Diccionario de marcas ────────────────────────────────────────────────────
// key: alias normalizado → value: nombre canónico

export const MARCAS: Record<string, string> = {
  // Bullpadel
  'bullpadel': 'Bullpadel', 'bull padel': 'Bullpadel', 'bull-padel': 'Bullpadel',
  // Nox
  'nox': 'Nox', 'nox padel': 'Nox',
  // Adidas
  'adidas': 'Adidas', 'adidas padel': 'Adidas',
  // Head
  'head': 'Head', 'head padel': 'Head',
  // Babolat
  'babolat': 'Babolat',
  // Wilson
  'wilson': 'Wilson', 'wilson padel': 'Wilson',
  // Star Vie
  'star vie': 'StarVie', 'starvie': 'StarVie',
  // Siux
  'siux': 'Siux',
  // Vibor-A
  'vibor-a': 'Vibor-A', 'vibora': 'Vibor-A', 'vibor a': 'Vibor-A',
  // Drop Shot
  'drop shot': 'Drop Shot', 'dropshot': 'Drop Shot',
  // Black Crown
  'black crown': 'Black Crown', 'blackcrown': 'Black Crown',
  // Dunlop
  'dunlop': 'Dunlop',
  // Joma
  'joma': 'Joma',
  // Enebe
  'enebe': 'Enebe',
  // Varlion
  'varlion': 'Varlion',
  // Royal Padel
  'royal padel': 'Royal Padel',
  // Tecnifibre
  'tecnifibre': 'Tecnifibre',
  // Oxdog
  'oxdog': 'Oxdog',
  // Kuikma (Decathlon)
  'kuikma': 'Kuikma',
  // Akkeron
  'akkeron': 'Akkeron',
  // Puma
  'puma': 'Puma',
  // Alkemia
  'alkemia': 'Alkemia',
  // Lok
  'lok': 'Lok',
  // Kombat
  'kombat': 'Kombat',
  // Munich
  'munich': 'Munich',
  // Hirostar
  'hirostar': 'Hirostar',
  // Cartri
  'cartri': 'Cartri',
  // Softee
  'softee': 'Softee',
  // Xcalion
  'xcalion': 'Xcalion',
  // Vairo
  'vairo': 'Vairo',
  // Legend
  'legend': 'Legend',
  // Prince
  'prince': 'Prince',
  // Harlem
  'harlem': 'Harlem',
  // J-Hayber
  'j-hayber': 'J-Hayber', 'j.hayber': 'J-Hayber', 'j hayber': 'J-Hayber',
  // K-Swiss
  'k-swiss': 'K-Swiss', 'kswiss': 'K-Swiss', 'k swiss': 'K-Swiss',
  // Mystica
  'mystica': 'Mystica',
  // Slazenger
  'slazenger': 'Slazenger',
  // Asics
  'asics': 'Asics',
}

// ─── Líneas por marca ─────────────────────────────────────────────────────────
// Orden: de más específico a menos específico dentro de cada marca.
// El extractor prueba en orden y se queda con el primer match.

export const LINEAS_POR_MARCA: Record<string, string[]> = {
  'Bullpadel': [
    'vertex', 'hack', 'spike', 'flow', 'neuron', 'indiga', 'ionic', 'wonder',
    'pearl', 'elite', 'legend', 'ava', 'bp10',
    'game', 'discover', 'icon', 'raider', 'k2', 'black dragon',
  ],
  'Nox': [
    'at10', 'ml10', 'x-one', 'x one', 'vk10', 'tl10', 'la10', 'ea10',
    'x-zero', 'x-hero', 'x-pro',
    'future', 'equation', 'nextgen', 'tempo', 'ventus', 'quantum', 'ultimate',
  ],
  'Adidas': [
    'metalbone', 'adipower multiweight', 'adipower carbon', 'adipower',
    'drive', 'match', 'rx series', 'rx',
    'cross it', 'arrow', 'essnova', 'neuvortx', 'ctrl team',
    'velara', 'kardex',
  ],
  'Head': [
    'delta', 'extreme', 'speed', 'radical', 'flash', 'spark', 'bolt',
    'gravity', 'alpha', 'zephyr', 'instinct', 'tour',
    'edge', 'vibe', 'evo', 'one', 'concord', 'coello',
  ],
  'Babolat': [
    'technical viper', 'counter viper', 'air viper', 'viper',
    'technical veron', 'counter veron', 'air veron', 'veron',
    'technical vertuo', 'counter vertuo', 'air vertuo', 'vertuo',
    'xplo', 'dyna energy', 'stima vita', 'air origin', 'alioth', 'lamborghini',
  ],
  'Wilson': [
    'bela', 'defy', 'optix', 'ultra', 'carbon force', 'endure', 'blade',
  ],
  'StarVie': [
    'black titan', 'black mamba',
    'triton', 'metheora', 'raptor', 'basalto', 'drax', 'kenta', 'aquila',
    'brava', 'gea', 'titania', 'astrum',
    'polaris', 'nyra', 'arkos', 'radar', 'kraken', 'exodus', 'vesta',
  ],
  'Siux': [
    'electra', 'fenix', 'pegasus', 'diablo', 'adrenaline', 'savage',
    'trilogy', 'spyder', 'velox', 'beat', 'gea', 'astra', 'valkiria',
    'fusion', 'invicta',
  ],
  'Vibor-A': [
    'black mamba', 'king cobra',
    'yarara', 'mamba', 'titan', 'bamboo', 'boa', 'naya', 'vipera', 'lethal',
  ],
  'Drop Shot': [
    'explorer', 'axion', 'canyon', 'renegade', 'conqueror',
    'quantum', 'bronco', 'blitz', 'cyber', 'flame', 'furia', 'prime', 'x-drive',
  ],
  'Black Crown': [
    'piton', 'hurricane', 'gladius', 'epic', 'iconic',
    'special', 'patron', 'snake', 'wolf', 'rebel', 'win', 'shark', 'coyote', 'viva',
  ],
  'Dunlop': [
    'aero star', 'tristorm',
    'rocket', 'blast', 'fury', 'elite', 'strike', 'megamax',
    'galactica', 'titan', 'inferno', 'nemesis', 'fx', 'galaxy',
    'impact', 'infinity', 'samurai', 'fusion',
  ],
  'Joma': [
    'valkiria', 'master', 'open', 'slam', 'hyper', 'blast', 'recon',
  ],
  'Enebe': [
    'suburban', 'spitfire', 'combat',
    'response', 'mustang', 'supra', 'rsx', 'space', 'genius', 'massive',
    'aerox', 'point', 'cross', 'astra', 'break',
  ],
  'Varlion': [
    'lethal', 'summum', 'carbon', 'baseline',
  ],
  'Royal Padel': [
    'aniversario', 'fury', 'r-ace', 'hi-lander', 'factor',
    'whip', 'control', 'race',
  ],
  'Tecnifibre': [
    'wall breaker', 'wall master', 'curva', 'bomba',
  ],
  'Oxdog': [
    'ultimate', 'hyper tour',
  ],
  'Vairo': [
    'black karbon', 'everlast', 'grapheno', 'genetic', 'columns', 'compact', 'across',
  ],
  'Legend': [
    'invictus', 'odyssey', 'revenant', 'shadow', 'stealth',
  ],
  'Prince': [
    'falcon', 'premier', 'quartz', 'rocket',
  ],
  'Harlem': [
    'pro helix', 'bionic', 'euphoria',
  ],
  'J-Hayber': [
    'warrior fit', 'warrior', 'attack',
  ],
  'K-Swiss': [
    'supreme',
  ],
  'Mystica': [
    'legacy',
  ],
  'Slazenger': [
    'epic pro', 'epic',
  ],
  'Asics': [
    'hybrid',
  ],
  'Kombat': [
    'vesubio', 'etna', 'galeras', 'teide', 'arenal', 'osorno', 'krakatoa',
    'fuji', 'black', 'delta', 'hunter', 'swat', 'sas', 'troya', 'obus',
    'xifos', 'magnum', 'geo', 'apache', 'navy',
  ],
}

// ─── Variantes conocidas ──────────────────────────────────────────────────────
// Palabras que identifican una VARIANTE (diferenciador secundario),
// no la línea ni el modelo principal.
// Orden: de más específico a menos específico.

export const VARIANTES: string[] = [
  // Técnicas
  'hrd+', 'hrd', 'ctrl', 'control', 'light', 'team', 'carbon',
  'comfort', 'cmf', 'hybrid', 'hyb', 'attack', 'soft', 'air', 'pro',
  'elite', 'tour', 'ltd', 'limited', 'xtreme', 'xtrem', 'lite',
  'power', 'pwr', 'speed', 'motion',
  // Género
  'woman', 'women', 'mujer', 'junior', 'jr',
  // Numeradas (generaciones Bullpadel)
  '18k', '12k',
  // Materiales
  'carbon', 'alum', 'aluminium',
  // Series especiales (solo nombres que SÍ aparecen como variante en el catálogo;
  // "premier padel" y "wpt" se quitaron porque son nombres de circuitos/torneos,
  // no atributos de producto, y nunca existirán como variante en `palas`)
  'master final', 'world padel tour',
  'gold edition', 'black edition', 'limited edition',
]

// ─── Jugadores conocidos ──────────────────────────────────────────────────────
// Se eliminan del título antes de extraer la línea/modelo/variante

const JUGADORES = [
  // ── FIP Top 50 Men (ranking junio 2026) ──────────────────────────────────
  // #1-2
  'arturo coello',          // ⚠️  NO 'coello' solo — es nombre del modelo Head Coello Pro
  'agustin tapia', 'agustín tapia', 'agustin', 'agustín', 'tapia',
  // #3-4
  'ale galan', 'ale galán', 'alejandro galan', 'alejandro galán', 'galan', 'galán',
  'federico chingotto', 'chingotto',
  // #5-10
  'juan lebron', 'juan lebrón', 'lebron',
  'leo augsburger', 'leandro augsburger', 'augsburger',
  'franco stupaczuk', 'stupaczuk', 'stupa',
  'miguel yanguas', 'mike yanguas', 'yanguas',
  'coki nieto', 'jorge nieto',
  'paquito navarro', 'francisco navarro',
  // #11-20
  'jon sanz',
  'martin di nenno', 'martín di nenno', 'di nenno',
  'francisco guerrero', 'guerrero',
  'jeronimo gonzalez', 'jerónimo gonzalez', 'momo gonzalez', 'momo gonzález',
  'lucas bergamini', 'bergamini',
  'edu alonso', 'eduardo alonso',
  'javier leal', 'javi leal',
  'lucas campagnolo', 'campagnolo',
  'javier garrido',
  'juan tello', 'tello',
  'federico chingotto', 'fede chingotto', 'chingotto',
  // #21-30
  'alex ruiz', 'alejandro ruiz',
  'javier garcia bernal',
  'jairo bautista',
  'juanlu esbri', 'esbri',
  'javier barahona', 'barahona',
  'alejandro arroyo',
  'leo aguirre', 'leonel aguirre',
  'alex chozas', 'chozas',
  'david gala',
  'gonzalo alfonso',
  // #31-40
  'pol hernandez',
  'guillermo collado', 'collado',
  'carlos gutierrez',
  'jose jimenez casas',
  'maxi arce',
  'inigo jofre', 'jofre',
  'aimar goni',
  'pablo garcia belen',
  'maxi sanchez blasco',
  'victor ruiz benito',
  // #41-50
  'gonzalo rubio',
  'jose antonio diestro', 'diestro',
  'javier ruiz llorente',
  'tino libaak', 'valentino libaak', 'libaak',
  'pablo lijo', 'lijo',
  'alvaro cepero', 'cepero',
  'franco dal bianco', 'dal bianco',
  'enzo jensen',
  'pablo cardona',
  // ── FIP Top 50 Women (ranking junio 2026) ────────────────────────────────
  // #1-10
  'gemma triay', 'triay',
  'delfina brea', 'delfi brea', 'delfi',  // ⚠️  NO 'brea' solo — falso positivo en "Enebe Break"
  'bea gonzalez', 'bea gonzález', 'beatriz gonzalez',
  'paula josemaria', 'josemaria', 'josemaría',
  'ari sanchez', 'ariana sanchez',
  'claudia fernandez sanchez',
  'andrea ustero', 'ustero',
  'sofia araujo', 'araujo',
  'tamara icardo', 'icardo',
  'martita ortega', 'marta ortega',
  // #11-20
  'claudia jensen',
  'alejandra salazar', 'ale salazar', 'salazar',
  'martina calvo',
  'alejandra alonso de villa',
  'veronica virseda', 'virseda',
  'marina guinart', 'guinart',
  'beatriz caldera',
  'carmen goenaga',
  'aranzazu osoro', 'osoro',
  'victoria iglesias',
  // #21-30
  'lucia sainz', 'lucía sainz',
  'mapi sanchez', 'mapi sánchez',
  'patricia llaguno', 'patty llaguno', 'llaguno',
  'martina fassio', 'fassio',
  'raquel eugenio',
  'jessica castello',
  'lorena rufo',
  'jimena velasco',
  'marta barrera',
  'carolina orsi',
  // #31-40
  'giulia dal pozzo',
  'virginia riera',
  'alix collombon', 'collombon',
  'noa canovas',
  'araceli martinez arandia',
  'agueda perez',
  'lucia martinez gomez',
  'julieta bidahorria',
  'marta caparros',
  'marta talavan', 'talavan',
  // #41-50
  'marta borrero',
  'lara arruabarrena', 'arruabarrena',
  'sofia saiz',
  'jana montes',
  'noemi aguilar',
  'melania merino',
  'ana catarina nogueira',
  // ── Otros / nicknames ────────────────────────────────────────────────────
  'alex galán',
  'carolina navarro',
  'miguel lamperti', 'lamperti',
  'moyano',
  'pablo lima', 'lima',
  'manu martin', 'juan martin diaz', 'juan martin',
]

// ─── Utilidades ───────────────────────────────────────────────────────────────

function quitarMarca(texto: string, marca: string): string {
  const alias = Object.entries(MARCAS)
    .filter(([, v]) => v === marca)
    .map(([k]) => k)
  for (const a of alias.sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`^${a.replace(/[-]/g, '[-\\s]?')}\\s*`, 'i')
    texto = texto.replace(re, '')
  }
  return texto.trim()
}

function quitarAño(texto: string): string {
  return texto.replace(/\b(20[2-9]\d)\b/g, '').replace(/\s+/g, ' ').trim()
}

function quitarJugadores(texto: string): string {
  // Strip accents first so patterns like 'agustin tapia' match 'AGUSTÍN TAPIA'
  let result = texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
  for (const j of JUGADORES.sort((a, b) => b.length - a.length)) {
    const jSinAcentos = j.normalize('NFD').replace(/[̀-ͯ]/g, '')
    result = result.replace(new RegExp(jSinAcentos, 'gi'), '').replace(/\s+/g, ' ').trim()
  }
  return result.replace(/\s+/g, ' ').trim()
}

// ─── Extractor principal ──────────────────────────────────────────────────────

export interface Atributos {
  marca:    string | null
  linea:    string | null
  modelo:   string | null
  variante: string | null
  año:      number | null
}

export function extraerAtributos(titulo: string): Atributos {
  // Pre-procesar: "+" suelto (precedido de espacio o al final) → "PLUS"
  // Ej: "STARVIE ASTRUM +" → "STARVIE ASTRUM PLUS"
  // "HRD+" se deja intacto porque no tiene espacio antes del +.
  titulo = titulo.replace(/(?<=\S) \+(?=\s|$)/g, ' PLUS').replace(/(?<=\s)\+(?=\s|$)/g, 'PLUS')

  // Normalizar versiones de año tipo "2.6" → "2026" (Babolat usa X.Y como código de año)
  // "2.4"→2024, "2.5"→2025, "2.6"→2026, etc.
  titulo = titulo.replace(/\b2\.([4-9])\b/g, (_m, d) => String(2020 + parseInt(d)))
  // 'Special Edition' → 'SE' para mapear contra modelos tipo 'V1 SE' en catálogo
  titulo = titulo.replace(/\bspecial\s+edition\b/gi, 'SE')

  const norm = normalizar(titulo)

  // 1. AÑO — primero 4 dígitos, luego 2 dígitos al final (ej: "25" → 2025)
  const añoMatch4 = titulo.match(/\b(20[2-9]\d)\b/)
  const añoMatch2 = !añoMatch4
    ? titulo.match(/\b(2[0-9])\b(?=\s|$)/)
    : null
  const año = añoMatch4
    ? parseInt(añoMatch4[1])
    : añoMatch2 ? 2000 + parseInt(añoMatch2[1]) : null

  // 2. MARCA — buscar alias de más largo a más corto
  let marcaDetectada: string | null = null
  const marcaAliases = Object.entries(MARCAS).sort((a, b) => b[0].length - a[0].length)
  for (const [alias, canonico] of marcaAliases) {
    if (norm.startsWith(alias) || norm.includes(' ' + alias + ' ') || norm.includes(' ' + alias)) {
      marcaDetectada = canonico
      break
    }
  }

  if (!marcaDetectada) return { marca: null, linea: null, modelo: null, variante: null, año }

  // 3. Limpiar título: quitar marca, año, jugadores y "by" residual
  let resto = quitarMarca(titulo, marcaDetectada)
  resto = quitarAño(resto)
  if (añoMatch2) {
    const añoCorto = añoMatch2[1]
    resto = resto.replace(new RegExp(`\\b${añoCorto}\\b`, 'g'), '').replace(/\s+/g, ' ').trim()
  }
  resto = quitarJugadores(resto)
  // "BY" queda como residuo cuando se elimina "BY JUGADOR" — limpiarlo
  resto = resto.replace(/\bby\b/gi, '').replace(/\s+/g, ' ').trim()
  const restoNorm = normalizar(resto)

  // 4. LÍNEA — buscar en el diccionario de esta marca (más específico primero)
  let lineaDetectada: string | null = null
  const lineas = LINEAS_POR_MARCA[marcaDetectada] || []
  for (const linea of lineas) {
    if (restoNorm.includes(linea)) {
      lineaDetectada = linea
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
      break
    }
  }

  if (!lineaDetectada) {
    const palabras = restoNorm.split(' ').filter(w => w.length > 1)
    lineaDetectada = palabras[0]
      ? palabras[0].charAt(0).toUpperCase() + palabras[0].slice(1)
      : null
  }

  // 5. Quitar la línea del resto para extraer modelo y variante
  let sinLinea = resto
  if (lineaDetectada) {
    // Permitir que separadores (espacio o guión) coincidan con el título original.
    // Ej: "Aero Star" debe quitar tanto "AERO STAR" como "AERO-STAR".
    const lineaPattern = lineaDetectada
      .replace(/[-+]/g, '[-+]?')
      .replace(/\s+/g, '[-\\s]+')
    const lineaRe = new RegExp(lineaPattern, 'gi')
    sinLinea = sinLinea.replace(lineaRe, '').replace(/\s+/g, ' ').trim()
  }

  // Mapeo de alias de variante → nombre canónico
  const VARIANTES_ALIAS: Record<string, string> = {
    'mujer': 'WOMAN', 'mujeres': 'WOMAN', 'women': 'WOMAN',
    'junior': 'JUNIOR', 'jr': 'JUNIOR',
    'hrd+': 'HRD+', 'hrd': 'HRD',
    'ctrl': 'CTRL', 'control': 'CTRL',
    'cmf': 'COMFORT', 'comfort': 'COMFORT',
  }

  // 6. VARIANTE — buscar en el texto restante (más específico primero)
  let varianteDetectada: string | null = null
  const sinLineaNorm = normalizar(sinLinea)
  for (const v of VARIANTES.sort((a, b) => b.length - a.length)) {
    const vNorm = normalizar(v)
    if (sinLineaNorm.includes(vNorm)) {
      varianteDetectada = VARIANTES_ALIAS[v] ?? VARIANTES_ALIAS[vNorm] ?? v.toUpperCase()
      sinLinea = sinLinea.replace(new RegExp(v, 'gi'), '').replace(/\s+/g, ' ').trim()
      break
    }
  }

  // 7. MODELO — lo que queda
  let modeloDetectado: string | null = sinLinea.trim() || null

  if (modeloDetectado) {
    modeloDetectado = modeloDetectado
      .replace(/\b(pala|padel|de|la|el|by|raqueta|edition|edicion)\b/gi, '')
      .replace(/\(\s*\)/g, '')
      .replace(/^[\s+\-/|]+|[\s+\-/|]+$/g, '')
      .replace(/\s+[\+\-\/\|]\s+/g, ' ')
      .replace(/(\d(?:\.\d+)?)[+\-](?=\s|$)/g, '$1')
      .replace(/(^|\s)[+\-](?=\s|$)/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim()
    if (!modeloDetectado) modeloDetectado = null
  }

  return {
    marca:    marcaDetectada,
    linea:    lineaDetectada,
    modelo:   modeloDetectado,
    variante: varianteDetectada,
    año,
  }
}

// ─── Generador de nombre canónico ─────────────────────────────────────────────

export function nombreCanonico(a: Atributos): string {
  const partes = [a.marca, a.linea, a.modelo, a.variante, a.año?.toString()]
  return partes.filter(Boolean).join(" ")
}
