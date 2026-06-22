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
  // Opcional: jugador mencionado en el titulo cuando extract-atributos.ts no
  // pudo usarlo ni como linea ni como modelo (ver fix 2026-06-22 en
  // extract-atributos.ts). Solo se usa abajo como pista de RETRY para
  // encontrar una fila YA EXISTENTE cuyo modelo coincida con el jugador
  // (ej. Bullpadel Flow "Ale Salazar") cuando la busqueda normal (sin
  // jugador) no devuelve ningun candidato. Nunca debe usarse para decidir
  // el modelo de una fila nueva.
  jugadorMencionado?: string | null
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
  // Fix real 2026-06-23: varias tiendas (ej. la que genera títulos en mayúsculas
  // "ADIDAS CROSSIT ... PALA DE PÁDEL") escriben la línea de Adidas pegada
  // ("Crossit") en vez de "Cross It". Al no normalizarse, esas filas nunca
  // cruzaban con las de "Cross It" — mismo producto, registrado dos veces.
  'crossit': 'Cross It',
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
  // Fix real 2026-06-23 (Drop Shot Conqueror): 'confort' (sin 'm', ortografía
  // española) generaba una fila distinta de la que usaba 'comfort' — ver
  // mismo fix en extract-atributos.ts (VARIANTES/VARIANTES_ALIAS).
  'confort': 'comfort',
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
  // Fix real 2026-06-23 (Bullpadel Elite, Flow, Indiga, Vertex; Drop Shot
  // Quantum; Head Flash — barrido completo): "W" es la abreviatura estándar
  // de "Woman/Mujer" en TODA la industria de pádel (Adidas, Bullpadel, Drop
  // Shot, Head, Royal Padel, Varlion la usan igual — comprobado contra el
  // catálogo completo). Cada tienda reparte esta palabra de forma distinta:
  // unas la dejan en `variante` ("WOMAN"), otras la dejan pegada en `modelo`
  // como "W", "Mujer" o "Women" — mismo producto, palabra distinta, en campo
  // distinto. Sin esta alias, modeloCompatible()/firmaProducto() veían tokens
  // que no coincidían nunca y creaban una fila nueva por cada variante de
  // escritura. Unificarlas en un solo token soluciona TODOS los casos de este
  // patrón de una vez (no solo Bullpadel Elite), tanto en la detección
  // offline (limpiar-duplicados-catalogo.ts) como en el matching en vivo
  // (buscarPorAtributos, usado por pipeline-tiendas.ts y
  // auto-promote-candidatas.ts) — evita que se sigan creando filas nuevas.
  'w': 'woman', 'mujer': 'woman', 'women': 'woman',
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
      // Bug real 2026-06-21: antes, CUALQUIER número suelto se consideraba "ruido"
      // si había año conocido en cualquiera de los dos lados — pero un número de
      // generación real (ej. "2" en "Valkiria 2", "3" en "Beat 3") también es un
      // número suelto, y el año (2026) no tiene relación con él. Esto generaba el
      // mismo falso positivo que la Valkiria en GestorCandidatas, pero aquí en el
      // matcher de atributos que usa también pipeline-tiendas.ts. Fix: el número
      // solo es "ruido seguro" si coincide con el año (completo o sus 2 últimas
      // cifras, ej. "22" cuando año=2022) — si no coincide, es un dato real
      // (generación) y debe bloquear la compatibilidad.
      const año = añoCat ?? añoExtraido
      const añoCorto = año != null ? String(año % 100) : null
      const seguro = (t: string) =>
        COLORES.has(t) || (/^[0-9]+$/.test(t) && año != null && (t === String(año) || t === añoCorto))
      return extra.every(seguro)
    }
    return !extra.some(esExtraInseguro)
  }
  return false
}

// Fix real 2026-06-23 (Adidas Metalbone, Vibor-A, Drop Shot, Wilson — barrido
// completo del catálogo): limpiar-duplicados-catalogo.ts solo comparaba
// duplicados cuando normalizarVariante(a.variante) === normalizarVariante(b.variante)
// — pero el bug de fondo (extract-atributos.ts reparte las mismas palabras de
// forma distinta entre `modelo` y `variante` según el orden/ortografía exacta
// del título de cada tienda) genera precisamente filas donde la VARIANTE no
// coincide aunque sean el mismo producto. Esa comprobación previa descartaba
// el caso antes de poder detectarlo — punto ciego estructural, no un bug de
// lógica del script.
//
// firmaProducto() es la pieza que cierra ese punto ciego de forma genérica
// (no solo para el caso "Control/Ctrl" ya arreglado en extract-atributos.ts):
// combina TODAS las palabras de modelo+variante en una única bolsa de tokens
// (reutilizando tokenizarModelo, que ya quita acentos/mayúsculas y unifica
// alias de color), quita ruido marketing redundante cuando hay un tier real
// presente, y la deja ordenada y deduplicada. Si dos filas con la misma
// marca+línea+año producen la MISMA firma, son el mismo producto con las
// palabras repartidas de otra forma entre los dos campos — sin importar cuál
// futuro bug de parseo concreto lo cause.
// Fix real 2026-06-23 (Adidas Cross It / Metalbone 2026 — Carbon vs Carbon
// CTRL/Control): se probó tratar "ctrl"/"control" como ruido de marketing
// eliminable cuando había un tier real (carbon/light/team) presente, asumiendo
// que era el mismo bug que el de Cross It arreglado antes. ERROR: comprobado
// contra producto_aliases (14+ tiendas por fila, todas consistentes) y contra
// palas_no_duplicados (alguien ya las había marcado explícitamente como NO
// duplicados), "Carbon" y "Carbon Control/CTRL" son DOS productos reales
// distintos en la gama 2026 de Adidas — control es una variante real con
// firmware/dureza distinta, no una palabra repetida. Quitarla como "ruido"
// habría fusionado dos palas diferentes (falso positivo grave). modeloCompatible()
// ya trataba 'ctrl'/'control' como discriminante real (MODELO_DISCRIMINANTES,
// arriba) — nunca los quitaba. firmaProducto() debe comportarse igual: ningún
// ruido de marketing eliminable, solo bolsa de tokens literal.
//
// Fix real 2026-06-23 (Bullpadel Elite "W 25" vs "Woman 2025"): algunas
// tiendas meten el año corto (ej. "25") dentro de `modelo` aunque el año ya
// se sepa por separado — ese "25" no es información real del producto, es
// ruido del año repetido. Sin quitarlo, la firma de esa fila nunca coincidía
// con la de una fila idéntica sin ese número. Misma cautela que ya existe en
// modeloCompatible() (línea ~217): solo se quita un número si coincide
// exactamente con el año (completo o sus 2 últimas cifras) — un número de
// generación real (ej. "2" en "Valkiria 2") que no coincida con el año NO se
// toca, porque sí es información real del producto.
export function firmaProducto(modelo: string | null, variante: string | null, año: number | null = null): string {
  let tokens = [...tokenizarModelo(modelo ?? ''), ...tokenizarModelo(variante ?? '')]
  if (año != null) {
    const añoCorto = String(año % 100)
    tokens = tokens.filter(t => !(/^[0-9]+$/.test(t) && (t === String(año) || t === añoCorto)))
  }
  return Array.from(new Set(tokens)).sort().join('|')
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

  const filtrarConModelo = (modeloParaFiltrar: string | null) => data.filter(p => {
    const variantesCoinciden = normalizarVariante(p.variante) === normalizarVariante(attrs.variante)
    const añoCompatible = !attrs.año || !p.año || p.año === attrs.año
    const modeloOk = modeloCompatible(p.modelo, modeloParaFiltrar, p.año, attrs.año)
    const cruzado = !modeloParaFiltrar && !!attrs.variante && !p.variante
      && normalizarVariante(p.modelo) === normalizarVariante(attrs.variante)
    return (variantesCoinciden && modeloOk || cruzado) && añoCompatible
  })

  let filtrados = filtrarConModelo(attrs.modelo)

  // Retry con jugadorMencionado (ver comentario en AtributosExtraidos): solo si
  // la busqueda normal no encontro NADA y no habia modelo extraido. Sirve para
  // encontrar una fila YA EXISTENTE en el catalogo que use el nombre del
  // jugador como modelo (ej. Bullpadel Flow "Ale Salazar") sin arriesgarse a
  // que jugadorMencionado se use luego para poblar el modelo de una fila
  // nueva — auto-promote-candidatas.ts sigue usando attrs.modelo (no este
  // resultado) para decidir que insertar.
  if (filtrados.length === 0 && !attrs.modelo && attrs.jugadorMencionado) {
    filtrados = filtrarConModelo(attrs.jugadorMencionado)
  }

  // Fix real 2026-06-23 (mismo punto ciego que ya tenía
  // limpiar-duplicados-catalogo.ts, pero AQUÍ — en el matching EN VIVO — es
  // donde realmente importa: este es el sitio donde se decide si una fila
  // nueva hace falta o no. El filtro de arriba exige variante exacta; si una
  // tienda reparte las mismas palabras de otra forma entre modelo/variante
  // (ej. "CTRL CARBON" vs "Carbon Control", o "W 25" vs variante=WOMAN), no
  // encuentra nada y auto-promote-candidatas.ts/pipeline-tiendas.ts crea una
  // fila DUPLICADA nueva — el catálogo se ensucia otra vez en el próximo
  // pipeline aunque limpiar-duplicados-catalogo.ts lo arregle hoy. Antes de
  // rendirse, se prueba la firma combinada (misma lógica que el pase 2 del
  // script de limpieza): si exactamente UNA fila del catálogo tiene la misma
  // bolsa de palabras, es el mismo producto — se reutiliza en vez de duplicar.
  // Si hay 0 o 2+ coincidencias por firma no se decide nada aquí (ambigüedad
  // real va al Gestor, no se resuelve a ciegas).
  if (filtrados.length === 0) {
    const firmaExtraida = firmaProducto(attrs.modelo ?? attrs.jugadorMencionado ?? null, attrs.variante, attrs.año)
    if (firmaExtraida !== '') {
      const porFirma = data.filter(p => {
        const añoCompatible = !attrs.año || !p.año || p.año === attrs.año
        return añoCompatible && firmaProducto(p.modelo, p.variante, p.año ?? attrs.año) === firmaExtraida
      })
      if (porFirma.length === 1) filtrados = porFirma
    }
  }

  filtrados = preferirModeloEspecifico(filtrados, attrs.modelo ?? attrs.jugadorMencionado ?? null)

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

  return resolverAmbiguosPorColor(filtrados, attrs.modelo ?? attrs.jugadorMencionado ?? null)
}
