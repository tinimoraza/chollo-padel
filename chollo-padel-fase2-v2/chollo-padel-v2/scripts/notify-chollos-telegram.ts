/**
 * scripts/notify-chollos-telegram.ts
 * =============================================================================
 * Detecta chollos NUEVOS (tag='CHOLLO', no OFERTAs) y:
 *  1. Los registra en la tabla `chollos_notificados` (primera_vez_at)
 *  2. Envía un mensaje a Telegram por cada uno que aún no se haya notificado
 *  3. Marca telegram_enviado_at en la BD
 *  4. Limpia registros de chollos que ya no siguen siendo válidos
 *
 * Requiere env vars:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 *   TELEGRAM_BOT_TOKEN   — token del bot de BotFather
 *   TELEGRAM_CHAT_ID     — chat_id del grupo (número negativo, ej. -1001234567890)
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/notify-chollos-telegram.ts
 *   npx tsx --env-file=.env.local scripts/notify-chollos-telegram.ts --dry-run
 * =============================================================================
 */

import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const DRY_RUN        = process.argv.includes('--dry-run')
const BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID        = process.env.TELEGRAM_CHAT_ID
const SITE_URL       = 'https://huntpadel.com'

// URL de la API de chollos — fuente de verdad única (misma lógica que la web)
const API_CHOLLOS_URL = `${SITE_URL}/api/chollos`

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function sendTelegram(text: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('   ⚠️  TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados — se omite envío')
    return false
  }
  if (DRY_RUN) {
    console.log('   [dry-run] Telegram msg:', text.slice(0, 120), '…')
    return true
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    })
    if (!res.ok) { console.error('   ❌ Telegram error:', await res.text()); return false }
    return true
  } catch (e) {
    console.error('   ❌ Telegram excepción:', e); return false
  }
}

async function sendTelegramPhoto(imageUrl: string, caption?: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) return false
  if (DRY_RUN) {
    console.log('   [dry-run] Telegram photo:', imageUrl.slice(0, 60))
    return true
  }
  try {
    const body: Record<string, unknown> = { chat_id: CHAT_ID, photo: imageUrl }
    if (caption) { body.caption = caption; body.parse_mode = 'HTML' }
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { console.error('   ❌ Telegram photo error:', await res.text()); return false }
    return true
  } catch (e) {
    console.error('   ❌ Telegram photo excepción:', e); return false
  }
}

// ─── Tarjeta-imagen ───────────────────────────────────────────────────────────

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch { return null }
}

function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function truncStr(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

async function generarTarjetaImagen(
  nombre: string,
  precio: number,
  precioRef: number,
  descuentoPct: number,
  tienda: string,
  descripcion: string,
  codigoDescuento: string | null,
  imagenUrl: string | null
): Promise<Buffer> {
  // Layout: cabecera verde oscura / foto izquierda / precio grande derecha / pie verde
  const W       = 600
  const HEAD_H  = 72   // cabecera: nombre + subtítulo huntpadel.com
  const BODY_H  = 310
  const FOOT_H  = 40
  const H       = HEAD_H + BODY_H + FOOT_H  // 422
  const IMG_W   = 370
  const PRICE_X = IMG_W
  const PRICE_W = W - IMG_W  // 230
  const PX      = PRICE_X + PRICE_W / 2

  const precioStr    = precio    % 1 === 0 ? `${precio.toFixed(0)}€`    : `${precio.toFixed(2)}€`
  const precioRefStr = precioRef % 1 === 0 ? `${precioRef.toFixed(0)}€` : `${precioRef.toFixed(0)}€`

  const codRow = codigoDescuento
    ? `<rect x="${PRICE_X + 8}" y="${HEAD_H + BODY_H - 38}" width="${PRICE_W - 16}" height="24" rx="5" fill="#fef3c7"/>
       <text x="${PX}" y="${HEAD_H + BODY_H - 21}" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#92400e">Cod: ${xmlEsc(codigoDescuento)}</text>`
    : ''

  const descFooter = descripcion
    ? `<text x="10" y="${HEAD_H + BODY_H + 26}" font-family="Arial,sans-serif" font-size="11" fill="#a7f3d0">${xmlEsc(truncStr(descripcion, 52))}</text>`
    : ''

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="white"/>

  <!-- CABECERA -->
  <rect width="${W}" height="${HEAD_H}" fill="#064e3b"/>
  <text x="${W / 2}" y="31" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="17" font-weight="bold" fill="white"
  >${xmlEsc(truncStr(nombre, 44))}</text>
  <text x="${W / 2}" y="54" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="11" fill="#78b490"
  >huntpadel.com</text>

  <!-- ZONA FOTO (izquierda) -->
  <rect x="0" y="${HEAD_H}" width="${IMG_W}" height="${BODY_H}" fill="#f8f9fa"/>

  <!-- ZONA PRECIOS (derecha) -->
  <rect x="${PRICE_X}" y="${HEAD_H}" width="${PRICE_W}" height="${BODY_H}" fill="white"/>
  <line x1="${PRICE_X}" y1="${HEAD_H}" x2="${PRICE_X}" y2="${HEAD_H + BODY_H}" stroke="#e5e7eb" stroke-width="1"/>

  <!-- Precio anterior (gris, tachado) -->
  <text x="${PX}" y="${HEAD_H + 62}" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="20" fill="#9ca3af"
        text-decoration="line-through">${precioRefStr}</text>

  <!-- Caja precio nuevo -->
  <rect x="${PRICE_X + 12}" y="${HEAD_H + 78}" width="${PRICE_W - 24}" height="96" rx="10" fill="#dc2626"/>
  <text x="${PX}" y="${HEAD_H + 144}" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="46" font-weight="bold" fill="white"
  >${precioStr}</text>

  <!-- Pill descuento -->
  <rect x="${PRICE_X + 38}" y="${HEAD_H + 192}" width="${PRICE_W - 76}" height="34" rx="17" fill="#10b981"/>
  <text x="${PX}" y="${HEAD_H + 215}" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="17" font-weight="bold" fill="white"
  >-${descuentoPct}%</text>

  <!-- Tienda -->
  <text x="${PX}" y="${HEAD_H + 252}" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="12" fill="#6b7280"
  >${xmlEsc(truncStr(tienda, 24))}</text>

  ${codRow}

  <!-- PIE -->
  <rect x="0" y="${HEAD_H + BODY_H}" width="${W}" height="${FOOT_H}" fill="#064e3b"/>
  ${descFooter}
  <text x="${W - 10}" y="${HEAD_H + BODY_H + 26}" text-anchor="end"
        font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="white"
  >huntpadel.com</text>
</svg>`

  let card = await sharp(Buffer.from(svg)).png().toBuffer()
  if (imagenUrl) {
    const imgBuf = await fetchImageBuffer(imagenUrl)
    if (imgBuf) {
      try {
        const productPng = await sharp(imgBuf)
          .resize(IMG_W - 16, BODY_H - 16, { fit: 'contain', background: { r: 248, g: 249, b: 250, alpha: 1 } })
          .png().toBuffer()
        card = await sharp(card)
          .composite([{ input: productPng, top: HEAD_H + 8, left: 8 }])
          .png().toBuffer()
      } catch { /* foto opcional */ }
    }
  }
  return card
}

async function sendTelegramPhotoBuffer(buf: Buffer, caption?: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) return false
  if (DRY_RUN) { console.log('   [dry-run] Tarjeta imagen generada'); return true }
  try {
    const form = new FormData()
    form.append('chat_id', CHAT_ID)
    form.append('photo', new Blob([buf], { type: 'image/png' }), 'chollo.png')
    if (caption) { form.append('caption', caption); form.append('parse_mode', 'HTML') }
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form })
    if (!res.ok) { console.error('   ❌ Telegram photo error:', await res.text()); return false }
    return true
  } catch (e) {
    console.error('   ❌ Telegram excepción:', e); return false
  }
}

function generarDescripcion(pala: any): string {
  if (!pala) return ''
  const partes: string[] = []

  const juego   = pala.juego   ? (pala.juego === 'control' ? 'control' : pala.juego === 'potencia' ? 'potencia' : 'juego mixto') : null
  const forma   = pala.forma   ? ({ redonda: 'redonda', diamante: 'diamante', lagrima: 'lágrima' }[pala.forma as string] ?? pala.forma) : null
  const balance = pala.balance ? ({ bajo: 'bajo', medio: 'medio', alto: 'alto' }[pala.balance as string] ?? pala.balance) : null

  if (juego || forma || balance) {
    const atrs = [juego && `juego de ${juego}`, forma && `forma ${forma}`, balance && `balance ${balance}`].filter(Boolean)
    partes.push(atrs.join(', '))
  }

  const mats: string[] = []
  if (pala.material_cara) mats.push(`cara de ${(pala.material_cara as string).toLowerCase()}`)
  if (pala.material_nucleo) mats.push(`núcleo de ${(pala.material_nucleo as string).toLowerCase()}`)
  if (mats.length) partes.push(mats.join(' y '))

  return partes.length ? partes.join(' · ') + '.' : ''
}

type CholloDatos = {
  nombre_pala: string
  marca: string | null
  precio: number
  precio_referencia: number
  descuento_pct: number
  url_producto: string
  tienda: string
  primera_vez_at: string
  codigo_descuento?: string | null
}

/** Mensaje de texto principal (se envía siempre; foto va después como mensaje aparte) */
export function formatMensaje(c: CholloDatos, descripcion = ''): string {
  const emoji = c.descuento_pct >= 40 ? '🔥🔥' : '🔥'
  const desde = new Date(c.primera_vez_at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })
  const cod = c.codigo_descuento
    ? `\n🏷️ Código descuento: <code>${c.codigo_descuento}</code>`
    : ''
  const desc = descripcion ? `\n\n📋 ${descripcion}` : ''
  return (
    `🎾 PÁDEL <b>#CholloPadel</b> 🇪🇸\n\n` +
    `${emoji} <b>${c.nombre_pala}</b>\n` +
    `💰 <b>${c.precio.toFixed(2)}€</b>  <s>${c.precio_referencia.toFixed(0)}€</s>  −${c.descuento_pct}%${cod}` +
    desc + `\n\n` +
    `🛒 <a href="${c.url_producto}">${c.tienda}</a>\n\n` +
    `🕐 ${desde}  ·  🌐 <a href="${SITE_URL}">${SITE_URL.replace('https://', '')}</a>`
  )
}

// ─── Verificación de stock en vivo ────────────────────────────────────────────
// Señales de sin stock que busca en el HTML del producto (minúsculas)
const SENALES_SIN_STOCK = [
  // Español
  'agotado', 'sin stock', 'sin existencias', 'no disponible',
  // Inglés / genérico
  'out of stock', 'sold out', 'outofstock', 'out_of_stock',
  // Schema.org (JSON-LD)
  'schema.org/outofstock',
  // Shopify: producto sin stock en JSON inline
  '"available":false',
  // PrestaShop
  'product-unavailable',
  // WooCommerce
  'class="out-of-stock"',
]

/**
 * Hace un fetch rápido de la URL del producto y comprueba si hay señales
 * de sin stock en el HTML. Devuelve true si parece disponible, false si
 * hay señales claras de sin stock.
 * En caso de error de red o timeout devuelve true (no bloquear por dudas).
 */
async function verificarStockEnVivo(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), 10_000)
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
    })
    clearTimeout(tid)
    if (!res.ok) return true  // No podemos acceder → no bloquear
    const html = (await res.text()).toLowerCase()
    return !SENALES_SIN_STOCK.some(s => html.includes(s))
  } catch {
    return true  // Timeout u otro error de red → no bloquear por dudas
  }
}

// ─── Paso 1: Cargar chollos actuales de la API ────────────────────────────────
// Fuente de verdad única: /api/chollos aplica todos los guards (ref-stale,
// MIN_FUENTES=3, MAX_SPREAD, guards de URL, umbralMinimo, precio efectivo).
// Elimina la lógica duplicada que tenía este script con parámetros divergentes.

async function cargarChollosActuales() {
  const res = await fetch(API_CHOLLOS_URL, {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`/api/chollos devolvió ${res.status}: ${await res.text()}`)

  const json = await res.json() as {
    chollos: Array<{
      pala_id: string; source_id: number; precio_actual: number
      precio_referencia: number; descuento_pct: number; url_producto: string
      nombre: string; marca: string; tienda: string; tienda_slug: string
      codigo_descuento: string | null; tag: 'CHOLLO' | 'OFERTA'
    }>
  }

  // Solo los CHOLLOs (la API también devuelve OFERTAs)
  return (json.chollos ?? [])
    .filter(c => c.tag === 'CHOLLO')
    .map(c => ({
      pala_id:           c.pala_id,
      source_id:         c.source_id,
      precio:            c.precio_actual,
      precio_referencia: c.precio_referencia,
      descuento_pct:     c.descuento_pct,
      url_producto:      c.url_producto,
      nombre_pala:       c.nombre,
      marca:             c.marca ?? null,
      tienda:            c.tienda,
      tienda_slug:       c.tienda_slug,
      codigo_descuento:  c.codigo_descuento ?? null,
    }))
}

// ─── Paso 2: Sincronizar con chollos_notificados ──────────────────────────────

async function sincronizarYNotificar(
  chollosActuales: Awaited<ReturnType<typeof cargarChollosActuales>>
) {
  // Cargar todos los registros existentes
  const { data: existentes, error: eErr } = await supabase
    .from('chollos_notificados')
    .select('*')
  if (eErr) throw eErr

  const mapaExistentes = new Map<string, any>()
  for (const e of (existentes ?? [])) {
    mapaExistentes.set(`${e.pala_id}__${e.source_id}`, e)
  }

  const claveActuales = new Set(chollosActuales.map(c => `${c.pala_id}__${c.source_id}`))
  let enviados = 0
  let insertados = 0

  // Insertar o actualizar nuevos chollos
  for (const c of chollosActuales) {
    const key = `${c.pala_id}__${c.source_id}`
    const existente = mapaExistentes.get(key)

    if (!existente) {
      // NUEVO chollo que nunca hemos visto
      console.log(`   🆕 Nuevo chollo: ${c.nombre_pala} en ${c.tienda} — ${c.precio.toFixed(2)}€ (−${c.descuento_pct}%)`)

      if (!DRY_RUN) {
        await supabase.from('chollos_notificados').insert({
          pala_id:           c.pala_id,
          source_id:         c.source_id,
          precio:            c.precio,
          precio_referencia: c.precio_referencia,
          descuento_pct:     c.descuento_pct,
          url_producto:      c.url_producto,
          nombre_pala:       c.nombre_pala,
          marca:             c.marca,
          tienda:            c.tienda,
          primera_vez_at:    new Date().toISOString(),
          activo:            true,
          codigo_descuento:  c.codigo_descuento,
        })
      }
      insertados++

    } else if (!existente.activo) {
      // Chollo que había desaparecido y vuelve.
      // Solo se re-notifica si el precio efectivo bajó al menos un 1% respecto
      // al precio que se notificó la vez anterior. Si el precio es igual o peor
      // solo se reactiva (activo=true) sin limpiar telegram_enviado_at.
      const precioMejoro = c.precio < Number(existente.precio) * 0.99
      const update: Record<string, unknown> = {
        activo:            true,
        precio:            c.precio,
        precio_referencia: c.precio_referencia,
        descuento_pct:     c.descuento_pct,
        codigo_descuento:  c.codigo_descuento,
      }
      if (precioMejoro) {
        update.primera_vez_at      = new Date().toISOString()
        update.telegram_enviado_at = null
        console.log(`   🔄 Chollo reaparecido con precio MEJOR: ${c.nombre_pala} en ${c.tienda} — ${c.precio.toFixed(2)}€ (antes ${Number(existente.precio).toFixed(2)}€)`)
      } else {
        // Sin cambio de precio → solo reactivar, no volver a notificar
        console.log(`   🔄 Chollo reaparecido (precio sin cambio): ${c.nombre_pala} en ${c.tienda} — ${c.precio.toFixed(2)}€`)
      }
      if (!DRY_RUN) {
        await supabase.from('chollos_notificados')
          .update(update)
          .eq('pala_id', c.pala_id)
          .eq('source_id', c.source_id)
      }
    }
    // Si ya existe y está activo: no tocamos primera_vez_at (preservar cuándo apareció)
  }

  // Marcar como inactivos los que ya no son chollos
  for (const [key, e] of mapaExistentes.entries()) {
    if (!claveActuales.has(key) && e.activo) {
      console.log(`   ↩️  Chollo expirado: ${e.nombre_pala} en ${e.tienda}`)
      if (!DRY_RUN) {
        await supabase.from('chollos_notificados')
          .update({ activo: false })
          .eq('pala_id', e.pala_id)
          .eq('source_id', e.source_id)
      }
    }
  }

  // Notificar por Telegram los que aún no se han notificado (activos, sin telegram_enviado_at)
  const { data: pendientes } = await supabase
    .from('chollos_notificados')
    .select('*, palas(imagen_url, forma, balance, juego, material_cara, material_nucleo)')
    .eq('activo', true)
    .is('telegram_enviado_at', null)
    .order('descuento_pct', { ascending: false })

  if (!pendientes || pendientes.length === 0) {
    console.log('   ✅ No hay chollos nuevos que notificar por Telegram')
    return { insertados, enviados }
  }

  console.log(`\n   📨 Enviando ${pendientes.length} notificaciones Telegram…`)
  for (const p of pendientes) {
    // ── Verificación de stock en vivo ──────────────────────────────────────
    // Hacemos un fetch real de la página del producto antes de publicar.
    // Si detectamos señales de sin stock, marcamos en BD y saltamos.
    const enStock = await verificarStockEnVivo(p.url_producto)
    if (!enStock) {
      console.log(`   ⛔ Sin stock en vivo: ${p.nombre_pala} (${p.tienda}) — se omite y se marca indisponible`)
      if (!DRY_RUN) {
        await supabase.from('price_snapshots')
          .update({ disponible: false })
          .eq('pala_id', p.pala_id)
          .eq('source_id', p.source_id)
        await supabase.from('chollos_notificados')
          .update({ activo: false })
          .eq('id', p.id)
      }
      continue
    }

    const palaInfo   = Array.isArray(p.palas) ? p.palas[0] : p.palas
    const imagenUrl: string | null = palaInfo?.imagen_url ?? null
    const descripcion = generarDescripcion(palaInfo)

    // Generar tarjeta-imagen y enviar como foto única con caption de enlace
    let ok = false
    try {
      const card = await generarTarjetaImagen(
        p.nombre_pala, p.precio, p.precio_referencia, p.descuento_pct,
        p.tienda, descripcion, p.codigo_descuento ?? null, imagenUrl
      )
      const caption = `🛒 <a href="${p.url_producto}">${xmlEsc(p.tienda)}</a>  ·  🌐 <a href="${SITE_URL}">${SITE_URL.replace('https://', '')}</a>`
      ok = await sendTelegramPhotoBuffer(card, caption)
    } catch (err) {
      console.error('   ⚠️  Error generando tarjeta, fallback texto:', err)
      ok = await sendTelegram(formatMensaje(p, descripcion))
    }

    if (ok && !DRY_RUN) {
      await supabase.from('chollos_notificados')
        .update({ telegram_enviado_at: new Date().toISOString() })
        .eq('id', p.id)
      enviados++
    }
    // Pausa entre mensajes: Telegram limita a ~1 msg/s; con 2s hay margen suficiente
    await new Promise(r => setTimeout(r, 2000))
  }

  return { insertados, enviados }
}

// ─── main ─────────────────────────────────────────────────────────────────────

export async function notificarChollos() {
  console.log('\n── Paso 5: Notificar chollos nuevos por Telegram ────────────')

  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('   ⚠️  Sin credenciales Telegram (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) — se omite')
    return
  }

  const chollosActuales = await cargarChollosActuales()
  console.log(`   → ${chollosActuales.length} chollos activos encontrados (CHOLLO puro, sin OFERTAs)`)

  const { insertados, enviados } = await sincronizarYNotificar(chollosActuales)
  console.log(`   → ${insertados} nuevos registrados, ${enviados} notificaciones Telegram enviadas\n`)
}

if (process.argv[1]?.endsWith('notify-chollos-telegram.ts')) {
  notificarChollos().catch(err => {
    console.error('\n💥 Error fatal:', err)
    process.exit(1)
  })
}
