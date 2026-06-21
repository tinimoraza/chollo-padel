/**
 * scripts/lib/modelo-matching.ts
 * =============================================================================
 * Lógica de matching marca+línea+modelo+variante+año extraída de
 * pipeline-tiendas.ts (2026-06-21) para que NO viva duplicada en dos sitios.
 *
 * Motivo (causa raíz de las 277 filas huérfanas de auto_promoted, 2026-06-20/21):
 * auto-promote-candidatas.ts decidía "¿ya existe esto en el catálogo?" con
 * NINGUNA lógica (solo el unique-constraint de `slug`, que no detecta
 * duplicados semánticos tipo "Metalbone Lite 3.1" vs "Metalbone LITE"
 * existente). pipeline-tiendas.ts sí tenía esa lógica, pero solo él la usaba.
 * Dos sitios decidiendo lo mismo con reglas distintas = divergencia garantizada.
 * Ahora ambos importan de aquí — una sola fuente de verdad.
 *
 * IMPORTANTE: este módulo NO debe importar pipeline-tiendas.ts directamente
 * (ese archivo ejecuta main() incondicionalmente al cargarse y hace
 * process.exit(1) si no recibe argv[2] — importarlo dispararía un scraping
 * real). Por eso esta lógica se extrajo a un módulo nuevo, sin efectos
 * secundarios al importar.
 */

export interface AtributosExtraidos {
  marca:    string | null
  linea:    string | null
  modelo:   string | null
  variante: string | null
  // eslint-disable-next-line @typescript-eslint/naming-convention
  año:      number | null
}

export interface PalaCandidata {
  id: string
  nombre?: string
  marca: string | null
  linea: string | null
  modelo: string | null
  variante: string | null
  // eslint-disable-next-line @typescript-eslint/naming-convention
  año: number | null
}

const LINEA_EQUIVALENCIAS: Record<string, string> = {
  'jr': 'Junior',
  'copa del mundo': 'World Cup',
  'world cup': 'World Cup',
}

export function normalizarLinea(l: string | null): string | null {
  if (!l) return null
  const norm = l.toLowerCase().trim()
  return LINEA_EQUIVALENCIAS[norm] ?? l
}

const VARIANTE_EQUIVALENCIAS: Record<string, string> = {
  'paises bajos': 'netherlands',
  'estados unidos': 'usa',
  'control': 'ctrl', 'ctrl': 'ctrl', 'ctr': 'ctrl',
  'hybrid': 'hybrid', 'hyb': 'hybrid',
  'power': 'power', 'pwr': 'power',
  'xtrem': 'xtrem', 'xtreme': 'xtrem',
  'cmf': 'comfort',
  'wpt': 'world padel tour', 'world padel tour': 'world padel tour',
}

export function normalizarVariante(v: string | null): string | null {
  if (!v) return null
  const norm = v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  return VARIANTE_EQUIVALENCIAS[norm] ?? norm
}

export const MODELO_DISCRIMINANTES = new Set([
  'ctrl', 'control', 'team', 'hybrid', 'air', 'carbon', 'light',
  'plus', 'elite', 'power', 'soft', 'iron', 'speed', 'hard', 'free',
  'betis', 'miami', 'se', 'gen', 'cloud', 'geo', 'premier', 'energy',
  'luxury', 'black', 'ls', 'prisma', 'pansy', 'world', 'lite',
])

export function tokensCompatibles(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 4 || b.length < 4) return false
  if (Math.abs(a.length - b.length) === 1) return a.startsWith(b) || b.startsWith(a)
  return false
}

export function tokenIn(t: string, arr: string[]): boolean {
  return arr.some(x => tokensCompatibles(t, x))
}

export const COLORES = new Set([
  'black', 'white', 'red', 'green', 'yellow', 'blue',
  'grey', 'orange', 'pink', 'silver', 'gold', 'purple', 'brown',
])

export const MODELO_TOKEN_ALIAS: Record<string, string> = {
  'mtw': 'multiweight',
  'negra': 'black', 'negro': 'black',
  'blanca': 'white', 'blanco': 'white',
  'roja': 'red', 'rojo': 'red',
  'verde': 'green',
  'amarilla': 'yellow', 'amarillo': 'yellow',
  'azul': 'blue',
  'gris': 'grey',
  'naranja': 'orange',
  'rosa': 'pink',
  'plata': 'silver', 'plateado': 'silver', 'plateada': 'silver',
  'oro': 'gold', 'dorado': 'gold', 'dorada': 'gold',
  'morado': 'purple', 'morada': 'purple', 'lila': 'purple', 'violeta': 'purple',
  'marron': 'brown', 'marrón': 'brown',
  'bk': 'black',
  'bl': 'blue',
  'rd': 'red',
  'wh': 'white',
  'yl': 'yellow',
}

export function tokensDeModelo(s: string | null): string[] {
  if (!s) return []
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean)
    .map(t => MODELO_TOKEN_ALIAS[t] ?? t)
}

export function colorDeModelo(s: string | null): string | null {
  return tokensDeModelo(s).find(t => COLORES.has(t)) ?? null
}

export function modeloSinColor(s: string | null): string {
  return tokensDeModelo(s).filter(t => !COLORES.has(t)).join(' ')
}

export function resolverAmbiguosPorColor<T extends { marca: string | null; linea: string | null; modelo: string | null; variante: string | null; año: number | null }>(
  candidatos: T[], modeloExtraido: string | null,
): T[] {
  if (candidatos.length <= 1) return candidatos
  const clave = (p: T) =>
    `${(p.marca ?? '').toLowerCase()}|${(p.linea ?? '').toLowerCase()}|${normalizarVariante(p.variante) ?? ''}|${p.año ?? ''}|${modeloSinColor(p.modelo)}`
  if (new Set(candidatos.map(clave)).size !== 1) return candidatos

  const colorTienda = colorDeModelo(modeloExtraido)
  if (colorTienda) {
    const exacto = candidatos.filter(p => colorDeModelo(p.modelo) === colorTienda)
    if (exacto.length === 1) return exacto
  } else {
    const sinColor = candidatos.filter(p => colorDeModelo(p.modelo) === null)
    if (sinColor.length === 1) return sinColor
  }
  return candidatos
}

export function tokenizarModelo(s: string): string[] {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(\d+)\.(\d+)\b/g, '$1$2')
    .replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean)
    .map(t => MODELO_TOKEN_ALIAS[t] ?? t)
}

export function preferirModeloEspecifico<T extends { modelo: string | null }>(
  candidatos: T[], modeloExtraido: string | null,
): T[] {
  if (candidatos.length <= 1 || !modeloExtraido) return candidatos
  const tExt = tokenizarModelo(modeloExtraido)
  const exactos = candidatos.filter(c => {
    const tCat = c.modelo ? tokenizarModelo(c.modelo) : []
    return tCat.length > 0 && tExt.every(t => tokenIn(t, tCat)) && tCat.every(t => tokenIn(t, tExt))
  })
  return (exactos.length > 0 && exactos.length < candidatos.length) ? exactos : candidatos
}

export function modeloCompatible(
  modeloCat: string | null, modeloExtraido: string | null,
  añoCat: number | null = null, añoExtraido: number | null = null,
): boolean {
  if (!modeloExtraido) {
    if (!modeloCat) return true
    return /^[\d.]+$/.test(modeloCat.trim())
  }
  const tokenizar = tokenizarModelo
  const tCat = modeloCat ? tokenizar(modeloCat) : []
  const tExt = tokenizar(modeloExtraido)
  const esExtraInseguro = (t: string) =>
    MODELO_DISCRIMINANTES.has(t) || /^v\d+p\d+$/.test(t) || (/^[0-9]+$/.test(t) && añoCat == null && añoExtraido == null)
  if (tExt.every(t => tokenIn(t, tCat))) {
    const extra = tCat.filter(t => !tokenIn(t, tExt))
    return !extra.some(esExtraInseguro)
  }
  if (tCat.every(t => tokenIn(t, tExt))) {
    const extra = tExt.filter(t => !tokenIn(t, tCat))
    if (tCat.length === 0) {
      const seguro = (t: string) => COLORES.has(t) || (/^[0-9]+$/.test(t) && (añoCat != null || añoExtraido != null))
      return extra.every(seguro)
    }
    return !extra.some(esExtraInseguro)
  }
  return false
}

/**
 * Busca en `palas` candidatos compatibles con `attrs`. Recibe el cliente de
 * supabase como parámetro (en vez de leerlo de un módulo con efectos
 * secundarios) para poder llamarse tanto desde pipeline-tiendas.ts como desde
 * auto-promote-candidatas.ts sin arrastrar nada más de ninguno de los dos.
 */
export async function buscarPorAtributos(
  supabase: { from: (table: string) => any },
  attrs: AtributosExtraidos,
): Promise<PalaCandidata[]> {
  if (!attrs.marca || !attrs.linea) return []

  const q = supabase
    .from('palas')
    .select('id, nombre, marca, linea, modelo, variante, año')
    .eq('marca', attrs.marca)
    .eq('linea', normalizarLinea(attrs.linea))

  const { data: _rawData } = await q
  const data = (_rawData ?? []) as PalaCandidata[]

  let filtrados = data.filter(p => {
    const variantesCoinciden = normalizarVariante(p.variante) === normalizarVariante(attrs.variante)
    const añoCompatible = !attrs.año || !p.año || p.año === attrs.año
    const modeloOk = modeloCompatible(p.modelo, attrs.modelo, p.año, attrs.año)
    const cruzado = !attrs.modelo && !!attrs.variante && !p.variante
      && normalizarVariante(p.modelo) === normalizarVariante(attrs.variante)
    return (variantesCoinciden && modeloOk || cruzado) && añoCompatible
  })

  filtrados = preferirModeloEspecifico(filtrados, attrs.modelo)

  // Si el título SÍ trae año y, tras filtrar por modelo, queda ambiguo entre
  // una fila con ese año exacto y una o más filas sin año (placeholder), la
  // fila con año exacto es estrictamente más específica — preferirla. Solo se
  // aplica cuando hay EXACTAMENTE una fila con año exacto (si hay dos o más
  // —p.ej. dos modelos distintos publicados el mismo año—, eso es ambigüedad
  // real de catálogo y debe seguir yendo al Gestor, no resolverse a ciegas).
  if (attrs.año && filtrados.length > 1) {
    const conAñoExacto = filtrados.filter(p => p.año === attrs.año)
    const sinAño = filtrados.filter(p => p.año == null)
    if (conAñoExacto.length === 1 && conAñoExacto.length + sinAño.length === filtrados.length) {
      filtrados = conAñoExacto
    }
  }

  if (!attrs.año && filtrados.length > 1) {
    const claveSinAño = (p: PalaCandidata) =>
      `${(p.marca ?? '').toLowerCase()}|${(p.linea ?? '').toLowerCase()}|${(p.modelo ?? '').toLowerCase()}|${normalizarVariante(p.variante) ?? ''}`
    const claves = new Set(filtrados.map(claveSinAño))
    if (claves.size === 1) {
      const masReciente = filtrados.reduce((best, p) => (p.año ?? 0) > (best.año ?? 0) ? p : best)
      return [masReciente]
    }
  }

  return resolverAmbiguosPorColor(filtrados, attrs.modelo)
}
