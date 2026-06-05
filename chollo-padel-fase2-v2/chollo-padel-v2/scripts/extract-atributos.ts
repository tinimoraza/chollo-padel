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
  'star vie': 'Star Vie', 'starvie': 'Star Vie',
  // Siux
  'siux': 'Siux',
  // Vibora / Vibor-A
  'vibora': 'Vibora', 'vibor-a': 'Vibora', 'vibor a': 'Vibora',
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
}

// ─── Líneas por marca ─────────────────────────────────────────────────────────
// Orden: de más específico a menos específico dentro de cada marca.
// El extractor prueba en orden y se queda con el primer match.

export const LINEAS_POR_MARCA: Record<string, string[]> = {
  'Bullpadel': [
    'vertex', 'hack', 'spike', 'flow', 'neuron', 'indiga', 'ionic', 'wonder',
    'pearl', 'elite', 'legend', 'ava', 'bp10',
  ],
  'Nox': [
    'at10', 'ml10', 'x-one', 'x one', 'vk10', 'x-zero', 'x-hero', 'x-pro',
    'future', 'equation', 'nextgen', 'tempo',
  ],
  'Adidas': [
    'metalbone', 'adipower', 'adipower multiweight', 'drive', 'match',
    'rx series', 'rx', 'cross it', 'cross-it', 'arrow', 'essnova',
    'neuvortx', 'ctrl team',
  ],
  'Head': [
    'delta', 'extreme', 'speed', 'radical', 'flash', 'spark', 'bolt',
    'gravity', 'alpha', 'zephyr', 'instinct', 'tour',
  ],
  'Babolat': [
    'technical viper', 'viper', 'counter viper', 'air viper',
    'technical veron', 'veron', 'air veron',
    'xplo', 'vertuo',
  ],
  'Wilson': [
    'bela', 'defy', 'optix', 'ultra', 'carbon force',
  ],
  'Star Vie': [
    'triton', 'metheora', 'raptor', 'basalto', 'drax', 'kenta', 'aquila',
    'brava', 'gea', 'titania', 'astrum',
  ],
  'Siux': [
    'electra', 'fenix', 'pegasus', 'diablo', 'adrenaline', 'savage',
  ],
  'Vibora': [
    'yarara', 'mamba', 'black mamba', 'titan',
  ],
  'Drop Shot': [
    'explorer', 'axion', 'canyon', 'renegade', 'conqueror',
  ],
  'Black Crown': [
    'piton', 'hurricane', 'gladius', 'epic', 'iconic',
  ],
  'Dunlop': [
    'rocket', 'blast', 'fury', 'elite', 'tristorm', 'strike', 'megamax',
  ],
  'Joma': [
    'valkiria', 'master', 'open', 'slam', 'hyper', 'blast', 'recon',
  ],
  'Enebe': [
    'suburban', 'break', 'spitfire', 'combat',
  ],
  'Varlion': [
    'lethal', 'summum', 'carbon', 'baseline',
  ],
  'Royal Padel': [
    'aniversario', 'fury', 'r-ace', 'hi-lander', 'factor',
  ],
  'Tecnifibre': [
    'curva', 'wall breaker',
  ],
  'Oxdog': [
    'ultimate', 'hyper tour',
  ],
}

// ─── Variantes conocidas ──────────────────────────────────────────────────────
// Palabras que identifican una VARIANTE (diferenciador secundario),
// no la línea ni el modelo principal.
// Orden: de más específico a menos específico.

export const VARIANTES: string[] = [
  // Técnicas
  'hrd+', 'hrd', 'ctrl', 'control', 'light', 'team', 'carbon',
  'comfort', 'hybrid', 'hyb', 'attack', 'soft', 'air', 'pro',
  'elite', 'tour', 'ltd', 'limited', 'xtreme', 'xtrem', 'lite',
  'power', 'pwr', 'speed', 'motion',
  // Género
  'woman', 'women', 'mujer', 'junior', 'jr',
  // Numeradas (generaciones Bullpadel)
  '18k', '12k',
  // Materiales
  'carbon', 'alum', 'aluminium',
  // Series especiales
  'master final', 'premier padel', 'world padel tour', 'wpt',
  'gold edition', 'black edition', 'limited edition',
]

// ─── Jugadores conocidos ──────────────────────────────────────────────────────
// Se eliminan del título antes de extraer la línea/modelo/variante

const JUGADORES = [
  'ale galan', 'ale galán', 'juan lebron', 'juan lebrón',
  'arturo coello', 'agustin tapia', 'agustín tapia',
  'martita ortega', 'marta ortega',
  'paquito navarro', 'pablo cardona', 'juan tello',
  'alex ruiz', 'alex galán',
  'momo gonzalez', 'momo gonzález',
  'franco chingotto', 'chingotto',
  'stupa', 'edu alonso', 'coki nieto',
  'gemma triay', 'mapi sanchez', 'mapi sánchez',
  'carolina navarro', 'lucia sainz', 'lucía sainz',
  'bea gonzalez', 'bea gonzález',
  'ari sanchez', 'ariana sanchez',
  'lebron', 'galán', 'galan', 'tapia', 'coello',
]

// ─── Utilidades ───────────────────────────────────────────────────────────────

function quitarMarca(texto: string, marca: string): string {
  // Quitar la marca del inicio (puede tener variantes de escritura)
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
  const norm = normalizar(texto)
  for (const j of JUGADORES.sort((a, b) => b.length - a.length)) {
    if (norm.includes(j)) {
      texto = texto.replace(new RegExp(j, 'gi'), '')
    }
  }
  return texto.replace(/\s+/g, ' ').trim()
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
  const norm = normalizar(titulo)

  // 1. AÑO
  const añoMatch = titulo.match(/\b(20[2-9]\d)\b/)
  const año = añoMatch ? parseInt(añoMatch[1]) : null

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

  // 3. Limpiar título: quitar marca, año y jugadores
  let resto = quitarMarca(titulo, marcaDetectada)
  resto = quitarAño(resto)
  resto = quitarJugadores(resto)
  const restoNorm = normalizar(resto)

  // 4. LÍNEA — buscar en el diccionario de esta marca (más específico primero)
  let lineaDetectada: string | null = null
  const lineas = (LINEAS_POR_MARCA[marcaDetectada] || []).sort((a, b) => b.length - a.length)
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
    // Si no hay línea conocida, usar la primera palabra significativa del resto
    const palabras = restoNorm.split(' ').filter(w => w.length > 1)
    lineaDetectada = palabras[0]
      ? palabras[0].charAt(0).toUpperCase() + palabras[0].slice(1)
      : null
  }

  // 5. Quitar la línea del resto para extraer modelo y variante
  let sinLinea = resto
  if (lineaDetectada) {
    const lineaRe = new RegExp(lineaDetectada.replace(/[-+]/g, '[-+]?'), 'gi')
    sinLinea = sinLinea.replace(lineaRe, '').replace(/\s+/g, ' ').trim()
  }

  // 6. VARIANTE — buscar en el texto restante (más específico primero)
  let varianteDetectada: string | null = null
  const sinLineaNorm = normalizar(sinLinea)
  for (const v of VARIANTES.sort((a, b) => b.length - a.length)) {
    const vNorm = normalizar(v)
    if (sinLineaNorm.includes(vNorm)) {
      varianteDetectada = v.toUpperCase()
      sinLinea = sinLinea.replace(new RegExp(v, 'gi'), '').replace(/\s+/g, ' ').trim()
      break
    }
  }

  // 7. MODELO — lo que queda: número de generación, versión X.Y, sufijo
  // Ej: "04", "3.4", "Genius 18K", "Pro Cup"
  let modeloDetectado: string | null = sinLinea.trim() || null

  // Normalizar modelo: quitar "pala", "padel", artículos sueltos
  if (modeloDetectado) {
    modeloDetectado = modeloDetectado
      .replace(/\b(pala|padel|de|la|el|raqueta)\b/gi, '')
      .replace(/\s+/g, ' ')
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
  return partes.filter(Boolean).join(' ')
}

// ─── Generador de slug ────────────────────────────────────────────────────────

export function generarSlug(a: Atributos): string {
  return nombreCanonico(a)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}
