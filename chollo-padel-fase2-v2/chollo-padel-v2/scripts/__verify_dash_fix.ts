import { createClient } from '@supabase/supabase-js'
import { extraerAtributos, normalizar } from './extract-atributos'

try { require('dotenv').config({ path: '.env.local' }) } catch (_) {}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)

const ENTIDADES_HTML: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', hellip: '…', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', mdash: '—', ndash: '–',
}
function decodeHtmlEntities(texto: string): string {
  if (!texto) return texto
  return texto
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, nombre) => ENTIDADES_HTML[nombre] ?? m)
}

const LINEA_EQUIVALENCIAS: Record<string, string> = {
  jr: 'Junior', 'copa del mundo': 'World Cup', 'world cup': 'World Cup',
}
function normalizarLinea(l: string | null): string | null {
  if (!l) return null
  const norm = l.toLowerCase().trim()
  return LINEA_EQUIVALENCIAS[norm] ?? l
}
const VARIANTE_EQUIVALENCIAS: Record<string, string> = {
  'paises bajos': 'netherlands', 'estados unidos': 'usa',
  control: 'ctrl', ctrl: 'ctrl', ctr: 'ctrl',
  hybrid: 'hybrid', hyb: 'hybrid', power: 'power', pwr: 'power',
  xtrem: 'xtrem', xtreme: 'xtrem', cmf: 'comfort',
  wpt: 'world padel tour', 'world padel tour': 'world padel tour',
}
function normalizarVariante(v: string | null): string | null {
  if (!v) return null
  const norm = v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  return VARIANTE_EQUIVALENCIAS[norm] ?? norm
}
const MODELO_DISCRIMINANTES = new Set([
  'ctrl', 'control', 'team', 'hybrid', 'air', 'carbon', 'light', 'plus', 'elite',
  'power', 'soft', 'iron', 'speed', 'hard', 'free', 'betis', 'miami', 'se', 'gen',
  'cloud', 'geo', 'premier', 'energy', 'luxury', 'black', 'ls', 'prisma', 'pansy',
  'world', 'lite',
])
const MODELO_TOKEN_ALIAS: Record<string, string> = {
  mtw: 'multiweight', negra: 'black', negro: 'black', blanca: 'white', blanco: 'white',
  roja: 'red', rojo: 'red', verde: 'green', amarilla: 'yellow', amarillo: 'yellow',
  azul: 'blue', gris: 'grey', naranja: 'orange', rosa: 'pink', plata: 'silver',
  plateado: 'silver', plateada: 'silver', oro: 'gold', dorado: 'gold', dorada: 'gold',
  morado: 'purple', morada: 'purple', lila: 'purple', violeta: 'purple', marron: 'brown',
  bk: 'black', bl: 'blue', rd: 'red', wh: 'white', yl: 'yellow',
}
function tokensCompatibles(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 4 || b.length < 4) return false
  if (Math.abs(a.length - b.length) === 1) return a.startsWith(b) || b.startsWith(a)
  return false
}
function tokenIn(t: string, arr: string[]): boolean { return arr.some(x => tokensCompatibles(t, x)) }
function modeloCompatible(
  modeloCat: string | null, modeloExtraido: string | null,
  anioCat: number | null = null, anioExtraido: number | null = null,
): boolean {
  if (!modeloExtraido) {
    if (!modeloCat) return true
    return /^[\d.]+$/.test(modeloCat.trim())
  }
  if (!modeloCat) return /^[\d.]+$/.test(modeloExtraido.trim())
  const tokenizar = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/\b(\d+)\.(\d+)\b/g, '$1$2')
      .replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean)
      .map(t => MODELO_TOKEN_ALIAS[t] ?? t)
  const tCat = tokenizar(modeloCat)
  const tExt = tokenizar(modeloExtraido)
  const esExtraInseguro = (t: string) =>
    MODELO_DISCRIMINANTES.has(t) || (/^[0-9]+$/.test(t) && anioCat == null && anioExtraido == null)
  if (tExt.every(t => tokenIn(t, tCat))) {
    const extra = tCat.filter(t => !tokenIn(t, tExt))
    return !extra.some(esExtraInseguro)
  }
  if (tCat.every(t => tokenIn(t, tExt))) {
    const extra = tExt.filter(t => !tokenIn(t, tCat))
    return !extra.some(esExtraInseguro)
  }
  return false
}

const TITULOS_SIN_MATCH = [
  "Pala Adidas Cross It Pro EDT &#8211; Martita Ortega 2026",
  "Pala Adidas Metalbone 2026 &#8211; Ale Galán",
  "Pala Bullpadel XPLO 2026 &#8211; Martín Di Nenno",
  "Pala Bullpadel Neuron 02 2026 &#8211; Fede Chingotto",
  "Pala Bullpadel Elite 2026 &#8211; Gemma Triay",
  "Pala Bullpadel Pearl 2026 &#8211; Bea González",
  "Pala Bullpadel Vertex 05 Woman 2026 &#8211; Delfi Brea",
  "Pala Black Crown Iconic Crown 2026",
  "Pala Bullpadel Xplo Geo 2026 &#8211; Premier Padel",
  "Pala Bullpadel Vertex 05 Geo 2026 &#8211; Premier Padel",
  "Pala Bullpadel Vertex 05 Light 2026 &#8211; Premier Padel",
  "Pala Adidas Cross It Carbon 2026 &#8211; Maxi Arce",
  "Pala Adidas Arrow Hit Carbon Control 2026",
  "Pala Adidas Cross It Carbon Control 2026",
  "Pala NOX AT10 Genius Attack 18K Alum 2026",
  "Pala NOX Nextgen Pro Hybrid 12K NFA Series 2026",
  "Pala Bullpadel Icon 2026 &#8211; Juan Martin Diaz",
  "Pala HEAD Extreme Pro 2026",
  "Pala Adidas Cross It Carbon 2025 &#8211; Maxi Arce",
  "Pala Vibora King Cobra Xtreme 2025",
  "Pala Wilson Bela Pro V2.5 2025",
  "Pala Adidas Cross It Carbon Control 3.4 2025",
  "Pala StarVie Kenta Ultra Speed Soft",
  "Pala StarVie Aquila Soft 2024",
  "Pala StarVie Aquila Ultra Speed Soft 2024",
  "Pala StarVie Titania Soft 2024",
  "Pala StarVie Titania Ultra Speed Soft 2024",
  "Pala Yarara Xtreme Fiber Black 2025",
  "Pala Kelme Grey Wolf",
  "Pala Kelme Shark",
  "Pala Kelme Falcon",
  "Pala SET Hyena",
  "Pala SET Coyote",
  "Pala Dunlop Galactica Pro &#8211; Juani Mieres",
]

async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 5): Promise<T> {
  let lastErr: any
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      console.error('  retry ' + label + ' ' + (i + 1) + '/' + attempts)
      await new Promise(r => setTimeout(r, 1500))
    }
  }
  throw lastErr
}

async function main() {
  const decoded = TITULOS_SIN_MATCH.map(t => decodeHtmlEntities(t))
  const attrsList = decoded.map(t => ({ titulo: t, attrs: extraerAtributos(t) }))

  const textosNorm = decoded.map(t => normalizar(t))
  const aliasRows = await withRetry(async () => {
    const { data, error } = await supabase
      .from('producto_aliases')
      .select('texto_normalizado, pala_id')
      .in('texto_normalizado', textosNorm)
    if (error) throw error
    return data
  }, 'query alias')
  const aliasMap = new Map((aliasRows ?? []).map((r: any) => [r.texto_normalizado, r.pala_id]))

  const marcas = [...new Set(attrsList.map(a => a.attrs.marca).filter(Boolean))] as string[]
  let palas: any[] = []
  if (marcas.length > 0) {
    palas = await withRetry(async () => {
      const { data, error } = await supabase
        .from('palas')
        .select('id, nombre, marca, linea, modelo, variante, año')
        .in('marca', marcas)
      if (error) throw error
      return data ?? []
    }, 'query palas')
  }

  let resueltos = 0, ambiguos = 0, sinMatch = 0
  for (let i = 0; i < decoded.length; i++) {
    const titulo = attrsList[i].titulo
    const attrs = attrsList[i].attrs
    const tn = textosNorm[i]
    if (aliasMap.has(tn)) {
      console.log('RESUELTO_ALIAS | ' + titulo)
      resueltos++
      continue
    }
    if (!attrs.marca || !attrs.linea) {
      console.log('SIN_MARCA_O_LINEA | ' + titulo + ' | marca=' + attrs.marca + ' linea=' + attrs.linea + ' modelo=' + attrs.modelo)
      sinMatch++
      continue
    }
    const candidatos = palas.filter((p: any) => {
      if (p.marca !== attrs.marca) return false
      if (p.linea !== normalizarLinea(attrs.linea)) return false
      const variantesCoinciden = normalizarVariante(p.variante) === normalizarVariante(attrs.variante)
      const anioCompatible = !attrs.año || !p.año || p.año === attrs.año
      const modeloOk = modeloCompatible(p.modelo, attrs.modelo, p.año, attrs.año)
      const cruzado = !attrs.modelo && !!attrs.variante && !p.variante
        && normalizarVariante(p.modelo) === normalizarVariante(attrs.variante)
      return (variantesCoinciden && modeloOk || cruzado) && anioCompatible
    })
    if (candidatos.length === 1) {
      console.log('RESUELTO_ATRIBS | ' + titulo + ' -> ' + candidatos[0].nombre)
      resueltos++
    } else if (candidatos.length > 1) {
      console.log('AMBIGUO | ' + titulo + ' | ' + candidatos.length + ' candidatos: ' + candidatos.map((c: any) => c.nombre).join(' ; '))
      ambiguos++
    } else {
      console.log('SIN_MATCH | ' + titulo + ' | marca=' + attrs.marca + ' linea=' + attrs.linea + ' modelo=' + attrs.modelo + ' variante=' + attrs.variante + ' anio=' + attrs.año)
      sinMatch++
    }
  }

  console.log('')
  console.log('RESUMEN resueltos=' + resueltos + ' ambiguos=' + ambiguos + ' sinMatch=' + sinMatch + ' total=' + decoded.length)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
