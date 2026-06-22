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
  'nox': 'Nox', 'nox padel': 'Nox', 'ea10': 'Nox',
  // Adidas
  'adidas': 'Adidas', 'adidas padel': 'Adidas', 'adipower': 'Adidas',
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
  'j-hayber': 'J-Hayber', 'j.hayber': 'J-Hayber', 'j hayber': 'J-Hayber', 'jhayber': 'J-Hayber',
  // K-Swiss
  'k-swiss': 'K-Swiss', 'kswiss': 'K-Swiss', 'k swiss': 'K-Swiss',
  // Mystica
  'mystica': 'Mystica',
  // Slazenger
  'slazenger': 'Slazenger',
  // Asics
  'asics': 'Asics',
  // NOTA (fix 2026-06-19): marcas confirmadas como "sin match" en
  // pipeline_run_20260618_230627.json (originalpadel, tiendapadelpoint,
  // justpadel) — no estaban en este listado, así que el extractor nunca
  // detectaba marca y caían directo a sin_match en vez de pasar a ambiguos
  // (donde el Gestor puede decidir si se añaden al catálogo o no).
  'alacran': 'Alacran',
  'kelme': 'Kelme',
  'hbl': 'HBL',
  'goliat': 'Goliat',
  'endless': 'Endless',
  'stiga': 'Stiga',
  'osaka': 'Osaka',
  'indian maharadja': 'Indian Maharadja', 'maharadja': 'Indian Maharadja',
  'by vp': 'By VP',
  'tactical': 'Tactical',
}

// ─── Líneas por marca ─────────────────────────────────────────────────────────
// Orden: de más específico a menos específico dentro de cada marca.
// El extractor prueba en orden y se queda con el primer match.

export let LINEAS_POR_MARCA: Record<string, string[]> = {
  'Bullpadel': [
    'vertex', 'hack', 'spike', 'flow', 'neuron', 'indiga', 'ionic', 'wonder',
    'pearl', 'elite', 'legend', 'ava', 'bp10',
    'game', 'discover', 'icon', 'raider', 'k2', 'black dragon',
  ],
  'Nox': [
    'at10', 'ml10', 'x-one', 'x one', 'vk10', 'tl10', 'la10', 'ea10',
    // 'x-zero'/'x-hero'/'x-pro' (con guión) nunca matchean: normalizar() convierte
    // guiones en espacios antes de comparar, así que el título normalizado nunca
    // contiene el guión literal. Mismo bug que 'x-one' (ver versión sin guión
    // arriba) y que Adidas 'x-treme' (real, 2026-06-21) — se añaden las versiones
    // con espacio, que son las que de verdad pueden matchear.
    'x-zero', 'x zero', 'x-hero', 'x hero', 'x-pro', 'x pro',
    'future', 'equation', 'nextgen', 'tempo', 'ventus', 'quantum', 'ultimate',
  ],
  'Adidas': [
    'metalbone', 'adipower multiweight', 'adipower carbon', 'adipower',
    'drive', 'match', 'rx series', 'rx',
    'cross it', 'crossit', 'arrow', 'essnova', 'neuvortx', 'ctrl team',
    'velara', 'kardex',
    // 'x treme' (sin guión: normalizar() convierte "X-Treme" → "x treme" antes
    // de comparar, igual que Nox usa 'x one' en vez de 'x-one' — ver esa marca
    // más arriba). Bug real 2026-06-21: sin esta entrada, "ADIDAS X-TREME..."
    // no reconocía línea, "x" se descartaba como palabra de 1 letra y "treme"
    // quedaba mal detectado como línea nueva (catálogo ya tiene 1 fila sucia
    // linea='Treme' de este mismo bug).
    'x treme',
    'copa del mundo', 'world cup',
  ],
  'Head': [
    'delta', 'extreme', 'speed', 'radical', 'flash', 'spark', 'bolt',
    'gravity', 'alpha', 'zephyr', 'instinct', 'tour',
    'edge', 'vibe', 'vive', 'evo', 'one', 'concord', 'coello',
  ],
  'Babolat': [
    'technical viper', 'counter viper', 'air viper', 'viper',
    'technical veron', 'air veron', 'veron',
    'vertuo',
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
    // 'astral' (con "l" final): variante ortográfica que usan algunas tiendas
    // para la línea "Astra" (bug real 2026-06-21: "Pala Siux Astral Control
    // 2026" generaba linea="Astra"+modelo="l" suelto y no matcheaba la fila
    // ya existente en catálogo → duplicado auto_promoted). Va antes que
    // 'astra' en LINEAS_ALIAS (más larga primero) para que se pruebe primero.
    'astral',
  ],
  'Vibor-A': [
    'black mamba', 'king cobra', 'king kobra',
    'yarara', 'mamba', 'titan', 'bamboo', 'boa', 'naya', 'vipera', 'lethal',
    'taipan', // bug real 2026-06-20: existe en catálogo (Vibora Taipan Liquid 2023) pero faltaba aquí → siempre sin_match
  ],
  'Drop Shot': [
    'explorer', 'axion', 'canyon', 'renegade', 'conqueror',
    'quantum', 'bronco', 'blitz', 'cyber', 'flame', 'furia', 'prime',
    // 'x-drive' (con guión) nunca matchea — mismo bug del guión, ver Nox arriba.
    'x-drive', 'x drive',
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
    'gold', 'tournament', 'pro', 'rookie',
  ],
  'Enebe': [
    'suburban', 'spitfire', 'combat',
    'response', 'mustang', 'supra', 'rsx', 'space', 'genius', 'massive',
    'aerox', 'point', 'cross', 'astra', 'break',
    'arrow', 'full', 'matrix', 'nitro', 'rs', 'venom',
  ],
  'Varlion': [
    'lethal', 'summum', 'carbon', 'baseline',
  ],
  'Royal Padel': [
    'aniversario', 'fury',
    // 'hi-lander' (con guión) nunca matchea — mismo bug del guión, ver Nox arriba.
    'hi-lander', 'hi lander', 'factor',
    'whip', 'control',
    // 'race' antes que 'ace': si "race" estuviera después, "ace" la interceptaría
    // como substring ("race".includes("ace")) y la línea real "Race" (modelo
    // "RP", catálogo) se detectaría mal como "Ace".
    'race',
    // 'ace' SOLO (no 'r ace'/'r-ace'): el catálogo usa modelo="R" para esta línea
    // (linea=Ace, modelo=R/R LIGHT). Si el diccionario consume "r ace" entero como
    // línea, la "R" desaparece y el modelo queda vacío — rompe "R-Ace Light 2025"
    // (regresión real 2026-06-21, detectada tras el fix de "M27 R-Ace 2026").
    // Dejando solo 'ace', la "R" sobrevive como modelo en ambos casos: en
    // "M27 R-Ace 2026" el extra "M27" queda en modelo (no hay esa fila en
    // catálogo para 2026 → sin_match correcto, por catálogo incompleto, no por
    // línea mal detectada); en "R-Ace Light 2025" el modelo queda limpio "R" y
    // matchea bien contra la fila real.
    'ace',
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
// ─── Sincronización automática desde BD ──────────────────────────────────────
// Enriquece LINEAS_POR_MARCA con todas las lineas que existan en palas.
// Llamar al inicio del pipeline para que los matches sean siempre actuales.
export async function cargarLineasDesdeBD(supabase: any): Promise<void> {
  const { data } = await supabase
    .from('palas')
    .select('marca, linea')
    .not('linea', 'is', null)
  if (!data) return
  // Agrupamos las líneas nuevas (no presentes ya en el array hardcoded) por marca,
  // SIN tocar el orden de las líneas hardcoded — ese orden está curado a mano
  // ("más específico primero" por diseño, no necesariamente por longitud) y
  // reordenarlo globalmente por longitud rompió matches de otras marcas
  // (ej. Bullpadel, Joma...) que no tienen nada que ver con el bug que motivó esto.
  // Las líneas que vienen de BD sí pueden tener problemas de substring entre ellas
  // (caso real: Lok tiene 'carb' y 'carbon' — si 'carb' queda antes en el array,
  // "Lok Carbon Hype Gen 2" matchea 'carb' por substring antes de llegar a 'carbon').
  // Por eso, solo el bloque de líneas NUEVAS (cargadas dinámicamente) se ordena por
  // longitud descendente entre sí, y se añade al final, detrás de las hardcoded.
  const nuevasPorMarca: Record<string, string[]> = {}
  for (const row of data as { marca: string; linea: string }[]) {
    const { marca, linea } = row
    if (!marca || !linea) continue
    const lineaNorm = linea.toLowerCase().trim()
    const yaExiste = LINEAS_POR_MARCA[marca]?.includes(lineaNorm)
    if (yaExiste) continue
    if (!nuevasPorMarca[marca]) nuevasPorMarca[marca] = []
    if (!nuevasPorMarca[marca].includes(lineaNorm)) nuevasPorMarca[marca].push(lineaNorm)
  }
  for (const [marca, nuevas] of Object.entries(nuevasPorMarca)) {
    nuevas.sort((a, b) => b.length - a.length)
    if (!LINEAS_POR_MARCA[marca]) {
      LINEAS_POR_MARCA[marca] = nuevas
    } else {
      LINEAS_POR_MARCA[marca].push(...nuevas)
    }
  }
}

// no la línea ni el modelo principal.
// Orden: de más específico a menos específico.

export const VARIANTES: string[] = [
  // Técnicas
  'hrd+', 'hrd', 'ctrl', 'control', 'light', 'team', 'carbon',
  'comfort', 'confort', 'cmf', 'hybrid', 'hyb', 'attack', 'soft', 'air', 'pro',
  'elite', 'tour', 'ltd', 'limited', 'xtreme', 'xtrem', 'lite',
  'power', 'pwr', 'speed', 'motion',
  // Género
  'woman', 'women', 'mujer', 'junior', 'jr',
  'hrd plus',  // Hrd + con espacio → alias de HRD+
  // Países (Copa del Mundo Adidas) — formas en español
  'espana', 'alemania', 'argentina', 'belgica', 'colombia', 'francia',
  'inglaterra', 'italia', 'mexico', 'paises bajos', 'estados unidos', 'holanda', 'eeuu', 'multination',
  // Países — formas en inglés (algunas tiendas, ej. zonadepadel, listan el título
  // original en inglés: "World Cup Spain 2026", "World Cup England 2026"...)
  'spain', 'germany', 'belgium', 'france', 'england', 'italy', 'netherlands', 'usa',
  // Numeradas (generaciones Bullpadel)
  '18k', '12k',
  // Materiales
  'carbon', 'alum', 'aluminium',
  // Series especiales (solo nombres que SÍ aparecen como variante en el catálogo;
  // "premier padel" se quitó porque es nombre de circuito/torneo, no atributo de
  // producto, y nunca existirá como variante en `palas`.
  // "wpt" SÍ se reincorpora: es la abreviatura que usan las tiendas (ej. "NOX EQUATION
  // WPT ADVANCED SERIES 2022") para lo que en el catálogo está guardado como variante
  // "WORLD PADEL TOUR" — sin esto, "wpt" queda suelto en el modelo y nunca matchea.
  'master final', 'world padel tour', 'wpt',
  'gold edition', 'black edition', 'limited edition',
]

// ─── Jugadores conocidos ──────────────────────────────────────────────────────
// Se eliminan del título antes de extraer la línea/modelo/variante

const JUGADORES = [
  // ── FIP Top 50 Men (ranking junio 2026) ──────────────────────────────────
  // #1-2
  'arturo coello', 'ale coello', 'alejandro coello', 'coello',  // Head Coello Pro/Motion/Junior (DB no usa 'coello' como atributo)
  'agustin tapia', 'agustín tapia', 'agustin', 'agustín', 'tapia',
  // #3-4
  'ale galan', 'ale galán', 'alejandro galan', 'alejandro galán', 'galan', 'galán',
  'federico chingotto', 'chingotto',
  // #5-10
  'juan lebron', 'juan lebrón', 'j lebron', 'j lebrón', 'lebron',
  'leo augsburger', 'leandro augsburger', 'augsburger',
  'franco stupaczuk', 'stupaczuk', 'stupa',
  'miguel yanguas', 'mike yanguas', 'yanguas',
  'coki nieto', 'jorge nieto',
  'paquito navarro', 'francisco navarro',
  // #11-20
  'jon sanz', 'j sanz',
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
  'mafalda fernandes',
  // ── Otros / nicknames ────────────────────────────────────────────────────
  'alex galán',
  'carolina navarro',
  'fernando belasteguin', 'belasteguín', 'belasteguin',  // Wilson Bela line player
  'fede',  // Federico Chingotto standalone (belt+suspenders con 'fede chingotto')
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

function detectarJugador(texto: string): string | null {
  // Devuelve el nombre del jugador encontrado en el texto (en forma canónica Title Case)
  // para usarlo como linea cuando no se detecta ninguna otra.
  const sinAcentos = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  for (const j of JUGADORES.sort((a, b) => b.length - a.length)) {
    const jNorm = j.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    if (new RegExp(jNorm, 'gi').test(sinAcentos)) {
      return j.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    }
  }
  return null
}

export interface Atributos {
  marca:    string | null
  linea:    string | null
  modelo:   string | null
  variante: string | null
  año:      number | null
  // Jugador mencionado en el titulo cuando no se uso ni como linea ni como
  // modelo (ver fix 2026-06-22 mas abajo). Solo sirve como pista de RETRY para
  // encontrar una fila YA EXISTENTE en el catalogo cuyo campo modelo coincida
  // con el nombre del jugador (ej. Bullpadel Flow "Ale Salazar") — nunca se usa
  // para rellenar el modelo de una fila NUEVA, porque muchas lineas con codigo
  // de jugador (Nox AT10, La10, Tl10...) tienen filas reales con modelo=null y
  // promocionar ahi metiendo el jugador como modelo crearia una fila duplicada.
  jugadorMencionado: string | null
}

export function extraerAtributos(titulo: string): Atributos {
  // ── Strip ruido inglés (tiendas UK como pdhsports) ───────────────────────────
  // Patrón: "Brand Model Padel Racket Black/Orange" → "Brand Model"
  // "Padel Racket" es ruido equivalente a "Pala de Padel" en español.
  // Los colores al final (solos o slash-separados: "Grey Black", "Black/Orange")
  // no aportan identidad — se quitan para que el extractor vea solo marca+modelo.
  // Quitar ruido de prefijo/sufijo genérico que confunde la extracción de línea:
  // - "Pala de pádel / Pala de padel" (allforpadel, romasport, tiendapadel5…)
  // - "Padel Racket" (pdhsports UK)
  // NO quitamos colores: "Siux Fenix Pro Black", "Lava Orange" son identidad del producto.
  titulo = titulo
    .replace(/^pala\s+de\s+p[aá]del/gi, '')
    .replace(/^pala\s+de\s+p[aá]del/gi, '')  // doble por si hay variante con tilde
    .replace(/padel\s+racket/gi, '')
    .replace(/^pala/gi, '')
    .trim()

  // Normalizar 'Carb-on' (Lok) → 'carbon' antes de separar por guión
  titulo = titulo.replace(/carb-on/gi, 'carbon')
  // Typo real de la tienda outletdepadel.com (no es bug nuestro): escriben
  // "Gravitity" en vez de "Gravity" (línea real de Head) — normalizar antes
  // de buscar línea, ya que otros títulos con la ortografía correcta sí matchean.
  titulo = titulo.replace(/\bgravitity\b/gi, 'gravity')
  // Normalizar guiones especiales (em dash –, en dash –) a espacio
  titulo = titulo.replace(/[\u2013\u2014]/g, ' ')
  // Pre-procesar "+": "Raptor+" → "Raptor PLUS", "Astrum +" → "Astrum PLUS"
  titulo = titulo.replace(/(\w)\+/g, '$1 PLUS')  // + pegado a letra (sin espacio)
  titulo = titulo.replace(/(?<=\S) \+(?=\s|$)/g, ' PLUS').replace(/(?<=\s)\+(?=\s|$)/g, 'PLUS')

  // Normalizar versiones de año tipo "2.6" → "2026" (Babolat usa X.Y como código de año)
  // "2.4"→2024, "2.5"→2025, "2.6"→2026, etc.
  titulo = titulo.replace(/\b2\.([4-9])\b/g, (_m, d) => String(2020 + parseInt(d)))
  // 'Special Edition' → 'SE' para mapear contra modelos tipo 'V1 SE' en catálogo
  titulo = titulo.replace(/\bspecial\s+edition\b/gi, 'SE')

  // Quitar sufijos numéricos tipo SKU (≥5 dígitos, ej: "13894", "228272") que algunas
  // tiendas (Softee, Head…) añaden al final del título y que contaminan la extracción
  // del modelo. Los años (4 dígitos, 2020-2030) y los tokens de peso ("12K", "18K") no
  // se ven afectados porque tienen como máximo 4 ó 2 dígitos respectivamente.
  titulo = titulo.replace(/\b\d{5,}\b/g, '').replace(/\s+/g, ' ').trim()

  // Generaciones Adidas (y otras marcas): 3.1→2022, 3.2→2023, 3.3→2024, 3.4→2025
  // Se convierte a año para que el filtro de año resuelva la ambigüedad en el matching.
  // Solo se aplica si no hay ya un año de 4 dígitos en el título.
  // Guardamos el código original ("3.4") porque si no queda NINGÚN otro texto que
  // identifique el modelo (título = solo "MARCA LINEA 3.4"), el año por sí solo no
  // basta para desambiguar: pueden existir varias filas con ese mismo año y modelos
  // distintos (bug real 2026-06-21: "Adidas Metalbone 3.4" colisionaba como ambiguo
  // contra "Adidas Metalbone 09", ambas año 2025). Se usa como modelo de respaldo
  // más abajo solo si tras quitar marca/línea/variante no queda nada más.
  let generacionOriginal: string | null = null
  if (!/\b20[2-9]\d\b/.test(titulo)) {
    titulo = titulo.replace(/\b3\.([1-4])\b/g, (_m: string, d: string) => {
      generacionOriginal = `3.${d}`
      return String(2021 + parseInt(d))
    })
  }

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

  if (!marcaDetectada) return { marca: null, linea: null, modelo: null, variante: null, año, jugadorMencionado: null }

  // 3. Limpiar título: quitar marca, año, jugadores y "by" residual
  let resto = quitarMarca(titulo, marcaDetectada)
  resto = quitarAño(resto)
  if (añoMatch2) {
    const añoCorto = añoMatch2[1]
    resto = resto.replace(new RegExp(`\\b${añoCorto}\\b`, 'g'), '').replace(/\s+/g, ' ').trim()
  }
  const restoAntesDeJugadores = resto  // guardamos para detectar jugador si linea=null
  resto = quitarJugadores(resto)
  // "BY" queda como residuo cuando se elimina "BY JUGADOR" — limpiarlo
  resto = resto.replace(/\bby\b/gi, '').replace(/\s+/g, ' ').trim()
  const restoNorm = normalizar(resto)

  // 4. LÍNEA — buscar en el diccionario de esta marca (más específico primero).
  // Primera que matchee, en el orden del array — ese orden está curado a mano
  // por marca (no por longitud). El problema de substrings entre líneas
  // cargadas dinámicamente desde BD (ej. Lok 'carb'/'carbon') se resuelve
  // ordenando ESE bloque por longitud al cargarlo (ver cargarLineasDesdeBD),
  // no aquí — hacerlo aquí (más larga de TODAS las que matcheen) rompía el
  // orden curado de otras marcas y empeoró el matching global.
  // LINEAS_ALIAS: variantes ortograficas que usan algunas tiendas para una linea
  // que en el catalogo (y en LINEAS_POR_MARCA) tiene otro nombre canonico.
  // Ej: m1padel escribe "Crossit" (sin espacio) y "Vive" (typo de "Vibe").
  const LINEAS_ALIAS: Record<string, string> = {
    'crossit': 'Cross It',
    'vive': 'Vibe',
    'astral': 'Astra',
    'king kobra': 'King Cobra',
    'x treme': 'Xtreme',
    'ace': 'Ace',
    'hi lander': 'Hi-Lander',
    'x zero': 'X-Zero',
    'x hero': 'X-Hero',
    'x pro': 'X-Pro',
    // Catálogo Drop Shot llama a esta línea solo "Drive" (no "X-Drive").
    'x drive': 'Drive',
  }
  let lineaDetectada: string | null = null
  let lineaAliasMatched: string | null = null  // texto realmente matcheado en el título (puede diferir del canónico, ej. "vive" → "Vibe")
  const lineas = LINEAS_POR_MARCA[marcaDetectada] || []
  for (const linea of lineas) {
    // Bug real detectado 2026-06-21: el match era con .includes() (substring
    // puro), así que una línea conocida que es prefijo de OTRA palabra del
    // título (ej. "Astra" dentro de "Astral") matcheaba igual, dejando suelta
    // la letra restante ("l") que acababa contaminando `modelo`. Resultado:
    // "Siux Astral Control 2026" se parseaba como linea="Astra", modelo="l",
    // que ya NO coincide con la fila real existente en catálogo
    // (linea="Astra", modelo=null) → buscarPorAtributos() no la encontraba →
    // auto-promote-candidatas.ts creaba una fila NUEVA duplicada (sin imagen,
    // sin price_reference, exactamente el patrón que aparece en GestorCandidatas).
    // Fix: exigir que el carácter inmediatamente antes/después del match (si
    // existe) no sea otra letra — así "astra" sigue matcheando en "Astra 2.0"
    // o "Astra Control" pero no dentro de "Astral".
    const lineaPatternCheck = linea
      .replace(/[-+]/g, '[-+]?')
      .replace(/\s+/g, '[-\\s]+')
    const lineaReCheck = new RegExp('(?<![a-z])' + lineaPatternCheck + '(?![a-z])', 'i')
    if (lineaReCheck.test(restoNorm) || lineaReCheck.test(norm)) {
      lineaAliasMatched = linea
      lineaDetectada = LINEAS_ALIAS[linea] ?? linea
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
  // Si aun sin linea, usar el jugador detectado (ej: "Babolat Juan Lebron 2025" → linea="Juan Lebron")
  if (!lineaDetectada) {
    lineaDetectada = detectarJugador(restoAntesDeJugadores)
  }

  // 5. Quitar la línea del resto para extraer modelo y variante
  let sinLinea = resto
  if (lineaDetectada) {
    // Importante: para quitar la línea del texto hay que usar el ALIAS realmente
    // matcheado (lineaAliasMatched, ej. "vive"), no el nombre canónico de salida
    // (lineaDetectada, ej. "Vibe") — si la tienda escribe una variante ortográfica
    // distinta del canónico, una regex basada en el canónico no matchea nada y la
    // palabra original queda contaminando el modelo (ej. modelo="Vive ..." en vez
    // de limpio).
    const textoAQuitar = lineaAliasMatched
      ? lineaAliasMatched.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      : lineaDetectada
    // Permitir que separadores (espacio o guión) coincidan con el título original.
    // Ej: "Aero Star" debe quitar tanto "AERO STAR" como "AERO-STAR".
    const lineaPattern = textoAQuitar
      .replace(/[-+]/g, '[-+]?')
      .replace(/\s+/g, '[-\\s]+')
    const lineaRe = new RegExp(lineaPattern, 'gi')
    sinLinea = sinLinea.replace(lineaRe, '').replace(/\s+/g, ' ').trim()
    // Si parte de la línea ya fue quitada por quitarMarca (ej: "adipower" en "Adipower Multiweight"),
    // la regex anterior no matchea el resto. Eliminamos token a token los que queden en sinLinea.
    const lineaTokens = normalizar(textoAQuitar).split(/\s+/).filter(t => t.length >= 3)
    for (const tok of lineaTokens) {
      sinLinea = sinLinea.replace(new RegExp('\\b' + tok + '\\b', 'gi'), '').replace(/\s+/g, ' ').trim()
    }
  }

  // Mapeo de alias de variante → nombre canónico
  const VARIANTES_ALIAS: Record<string, string> = {
    'mujer': 'WOMAN', 'mujeres': 'WOMAN', 'women': 'WOMAN',
    'junior': 'JUNIOR', 'jr': 'JUNIOR',
    'hrd+': 'HRD+', 'hrd plus': 'HRD+', 'hrd': 'HRD+',
    'ctrl': 'CTRL', 'control': 'CTRL',
    'cmf': 'COMFORT', 'comfort': 'COMFORT',
    // Fix real 2026-06-23 (Drop Shot Conqueror): 'confort' (ortografía española,
    // sin 'm') no es un substring de 'comfort' — antes nunca matcheaba ningún
    // elemento de VARIANTES, así que la palabra entera se quedaba en el modelo
    // (ej. modelo="Confort 1.0" en vez de variante="COMFORT"). Misma tienda u
    // otra escribiendo "Comfort" sí generaba variante=COMFORT → dos filas para
    // el mismo producto. 'confort' ya está también en VARIANTES (arriba).
    'confort': 'COMFORT',
    'wpt': 'WORLD PADEL TOUR', 'world padel tour': 'WORLD PADEL TOUR',
    // Países Copa del Mundo — formas en español
    'espana': 'España', 'alemania': 'Alemania', 'argentina': 'Argentina',
    'belgica': 'Bélgica', 'colombia': 'Colombia', 'francia': 'Francia',
    'inglaterra': 'Inglaterra', 'italia': 'Italia', 'mexico': 'Mexico',
    'paises bajos': 'Netherlands', 'estados unidos': 'USA', 'holanda': 'Netherlands', 'eeuu': 'USA', 'multination': 'Multination',
    // Países Copa del Mundo — formas en inglés → mismo canónico que el catálogo
    'spain': 'España', 'germany': 'Alemania', 'belgium': 'Bélgica',
    'france': 'Francia', 'england': 'Inglaterra', 'italy': 'Italia',
    'netherlands': 'Netherlands', 'usa': 'USA',
  }

  // Fix real 2026-06-23 (Adidas Cross It): "Control"/"CTRL" es ruido de marketing
  // cuando el título YA trae un tier real (Carbon/Light/Team) — Adidas (y algunas
  // tiendas) añaden "Control"/"CTRL" de forma redundante a cualquiera de los tres
  // tiers. Antes, el bucle de abajo elegía SOLO la palabra más larga como variante
  // ('control'=7 letras gana a 'carbon'=6, pero 'carbon'=6 gana a 'ctrl'=4) y la
  // otra palabra se quedaba suelta y colaba en el modelo — el mismo título
  // ("Carbon Control" vs "Control Carbon" vs "Carbon Ctrl"...) acababa repartido
  // de 3 formas distintas entre modelo/variante según qué palabra usara cada
  // tienda, generando duplicados reales en `palas` que el comparador de
  // variante exacta (limpiar-duplicados-catalogo.ts) no podía detectar porque
  // la variante ya venía distinta entre las dos filas. Fix: si hay un tier real
  // (carbon/light/team) en el texto, quitamos "control"/"ctrl" ANTES de elegir
  // variante, para que nunca compita ni quede suelto en el modelo.
  const TIERS_REALES = ['carbon', 'light', 'team']
  const tieneTierReal = TIERS_REALES.some(t => normalizar(sinLinea).includes(t))
  if (tieneTierReal && /\b(ctrl|control)\b/i.test(sinLinea)) {
    sinLinea = sinLinea.replace(/\b(ctrl|control)\b/gi, '').replace(/\s+/g, ' ').trim()
  }

  // Fix real 2026-06-23 (Vibor-A "ÉLITE"): la línea de abajo quitaba la variante
  // detectada del texto con `new RegExp(v, 'gi')`, donde `v` es la palabra SIN
  // acento tal cual está en VARIANTES (ej. "elite"). Esa regex es insensible a
  // mayúsculas pero NO a acentos, así que si el título traía la palabra
  // acentuada ("ÉLITE"), la detección (que sí compara sobre texto normalizado)
  // funcionaba, pero la limpieza posterior no la encontraba en el texto
  // original y la dejaba intacta — se quedaba duplicada dentro del modelo
  // ("ÉLITE 3K 2.0" en vez de "3K 2.0") mientras la variante quedaba correcta
  // ("ELITE"). Resultado: misma fila físicamente repartida con residuo según
  // si la tienda acentuaba o no. Fix: construir la regex de limpieza letra a
  // letra, aceptando la vocal con o sin cualquier acento/diéresis común.
  const ACENTOS: Record<string, string> = {
    a: '[aàáâä]', e: '[eèéêë]', i: '[iìíîï]', o: '[oòóôö]', u: '[uùúûü]',
  }
  function regexInsensibleAAcentos(palabra: string): RegExp {
    const patron = palabra.split('').map(c => ACENTOS[c.toLowerCase()] ?? c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')
    // OJO: \b NO sirve aquí — \b se basa en \w, que en JS (sin flag /u con
    // \p{}) NO incluye letras acentuadas. Si la palabra empieza/acaba en una
    // vocal acentuada (ej. "Élite"), el carácter previo (espacio) y la É
    // serían los dos "no-word" para \b → nunca se consideraría límite y la
    // regex no matchearía nada. Por eso el límite se comprueba a mano con
    // lookaround contra una clase de caracteres que SÍ incluye acentos.
    const limite = '[a-z0-9àáâäèéêëìíîïòóôöùúûü]'
    return new RegExp(`(?<!${limite})${patron}(?!${limite})`, 'gi')
  }

  // 6. VARIANTE — buscar en el texto restante (más específico primero)
  let varianteDetectada: string | null = null
  const sinLineaNorm = normalizar(sinLinea)
  for (const v of VARIANTES.sort((a, b) => b.length - a.length)) {
    const vNorm = normalizar(v)
    if (sinLineaNorm.includes(vNorm)) {
      varianteDetectada = VARIANTES_ALIAS[v] ?? VARIANTES_ALIAS[vNorm] ?? v.toUpperCase()
      sinLinea = sinLinea.replace(regexInsensibleAAcentos(v), '').replace(/\s+/g, ' ').trim()
      break
    }
  }

  // 7. MODELO — lo que queda
  let modeloDetectado: string | null = sinLinea.trim() || null

  // Si no queda nada para modelo pero había un código de generación tipo "3.4"
  // (convertido arriba a año), lo recuperamos como modelo — sin esto, títulos
  // como "Adidas Metalbone 3.4" quedan con modelo=null y año=2025, lo que puede
  // matchear contra CUALQUIER otra fila con año=2025 de esa línea (ambiguo falso).
  if (!modeloDetectado && generacionOriginal) {
    modeloDetectado = generacionOriginal
  }

  // Bug real 2026-06-22: si tras quitar marca/línea/variante no queda nada
  // para el modelo, pero el título sí mencionaba un jugador conocido (que
  // quitarJugadores ya eliminó del texto en el paso 3), el nombre del jugador
  // se perdía sin dejar rastro. Algunas líneas usan el nombre del jugador como
  // modelo en el catálogo (ej. Bullpadel Flow "Ale Salazar", Vairo "Coki
  // Nieto") — sin esta pista, la candidata salía con modelo=null mientras
  // la fila real del catálogo tenía modelo="Ale Salazar", modeloCompatible()
  // los consideraba incompatibles y auto-promote generaba un duplicado
  // (caso real: "Pala Bullpadel Ale Salazar Flow Woman 2025" duplicando
  // "BULLPADEL FLOW WOMAN 2025").
  //
  // OJO (revisión 2026-06-22): la primera versión de este fix asignaba el
  // jugador directamente a modeloDetectado. Eso es peligroso: muchas líneas
  // usan códigos con nombre de jugador (Nox AT10, La10, Tl10...) donde la fila
  // real del catálogo tiene modelo=null a propósito (línea plana sin variante
  // de modelo). Si auto-promote crea una fila NUEVA usando ese jugador como
  // modelo, se generaría una fila distinta a la placeholder modelo=null en vez
  // de matchear con ella. Por eso el jugador se guarda en un campo separado
  // (jugadorMencionado) que SOLO se usa como pista de retry en buscarPorAtributos
  // (modelo-matching.ts) para encontrar una fila YA EXISTENTE — nunca para
  // rellenar el modelo de una fila nueva. Solo aplica si la línea no se
  // resolvió ya usando ese mismo jugador (evitar duplicarlo como línea Y modelo).
  let jugadorMencionado: string | null = null
  if (!modeloDetectado) {
    const jugadorDetectado = detectarJugador(restoAntesDeJugadores)
    if (jugadorDetectado && jugadorDetectado !== lineaDetectada) {
      jugadorMencionado = jugadorDetectado
    }
  }

  if (modeloDetectado) {
    modeloDetectado = modeloDetectado
      .replace(/\b(pala|padel|de|la|el|by|raqueta|edition|edicion|series|nfa)\b/gi, '')
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
    jugadorMencionado,
  }
}

// ─── Generador de nombre canónico ─────────────────────────────────────────────

export function nombreCanonico(a: Atributos): string {
  const partes = [a.marca, a.linea, a.modelo, a.variante, a.año?.toString()]
  return partes.filter(Boolean).join(" ")
}
