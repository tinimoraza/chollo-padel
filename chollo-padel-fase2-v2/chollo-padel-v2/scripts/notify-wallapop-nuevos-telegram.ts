/**
 * scripts/notify-wallapop-nuevos-telegram.ts
 * =============================================================================
 * Detecta anuncios NUEVOS de Wallapop (condition='new') con:
 *   - match_confidence = 1   (match 100% fiable)
 *   - descuento >= 35% respecto al precio_referencia de tiendas
 *   - Anuncio aún activo en la API de Wallapop
 *
 * Por cada uno no notificado:
 *   1. Registra en `wallapop_nuevos_notificados`
 *   2. Envía tarjeta con imagen a Telegram
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/notify-wallapop-nuevos-telegram.ts
 *   npx tsx --env-file=.env.local scripts/notify-wallapop-nuevos-telegram.ts --dry-run
 * =============================================================================
 */

import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const DRY_RUN   = process.argv.includes('--dry-run')
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID
const SITE_URL  = 'https://huntpadel.com'

// Umbral de descuento mínimo vs PVP de tiendas (fracción: 0.35 = 35%)
const MIN_DESCUENTO = 0.35

// Confianza mínima de match para notificar
const MIN_CONFIDENCE = 1

// Throttle entre verificaciones de API Wallapop
const VERIFY_THROTTLE = 300

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function truncStr(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

// ─── Verificación Wallapop ────────────────────────────────────────────────────

async function isWallapopActive(externalId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.wallapop.com/api/v3/items/${externalId}`, {
      headers: { Accept: 'application/json', MPlatform: 'WEB', 'Accept-Language': 'es-ES' },
      signal: AbortSignal.timeout(8_000),
    })
    if (res.status === 404 || res.status === 410) return false
    if (res.ok) {
      const data = await res.json()
      if (data?.reserved?.flag === true) return false
      if (data?.sold?.flag === true) return false
      if (data?.item?.flags?.sold || data?.item?.flags?.reserved) return false
      return true
    }
    return true  // error de red → no bloquear
  } catch {
    return true
  }
}

// ─── Telegram ────────────────────────────────────────────────────────────────

async function sendTelegramPhotoBuffer(buf: Buffer, caption: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('   ⚠️  TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados')
    return false
  }
  if (DRY_RUN) { console.log('   [dry-run] Enviando tarjeta Telegram'); return true }
  try {
    const form = new FormData()
    form.append('chat_id', CHAT_ID)
    form.append('photo', new Blob([buf], { type: 'image/png' }), 'nuevo_wallapop.png')
    form.append('caption', caption)
    form.append('parse_mode', 'HTML')
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form })
    if (!res.ok) { console.error('   ❌ Telegram error:', await res.text()); return false }
    return true
  } catch (e) {
    console.error('   ❌ Telegram excepción:', e); return false
  }
}

// ─── Tarjeta imagen ───────────────────────────────────────────────────────────

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch { return null }
}

async function generarTarjeta(
  nombre: string,
  precio: number,
  pvp: number,
  descuentoPct: number,
  imagenUrl: string | null
): Promise<Buffer> {
  const W      = 600
  const HEAD_H = 72
  const BODY_H = 310
  const FOOT_H = 40
  const H      = HEAD_H + BODY_H + FOOT_H
  const IMG_W  = 370
  const PX     = IMG_W + (W - IMG_W) / 2

  const precioStr = precio % 1 === 0 ? `${precio.toFixed(0)}€` : `${precio.toFixed(2)}€`
  const pvpStr    = `${pvp.toFixed(0)}€`

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="white"/>

  <!-- CABECERA verde oscura -->
  <rect width="${W}" height="${HEAD_H}" fill="#064e3b"/>
  <text x="${W/2}" y="28" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="15" font-weight="bold" fill="white"
  >${xmlEsc(truncStr(nombre, 46))}</text>
  <text x="${W/2}" y="49" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="11" fill="#6ee7b7"
  >🆕 NUEVO · Wallapop</text>
  <text x="${W/2}" y="64" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="10" fill="#78b490"
  >huntpadel.com</text>

  <!-- ZONA FOTO -->
  <rect x="0" y="${HEAD_H}" width="${IMG_W}" height="${BODY_H}" fill="#f8f9fa"/>

  <!-- ZONA PRECIOS -->
  <rect x="${IMG_W}" y="${HEAD_H}" width="${W - IMG_W}" height="${BODY_H}" fill="white"/>
  <line x1="${IMG_W}" y1="${HEAD_H}" x2="${IMG_W}" y2="${HEAD_H + BODY_H}" stroke="#e5e7eb" stroke-width="1"/>

  <!-- PVP tiendas tachado -->
  <text x="${PX}" y="${HEAD_H + 55}" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="12" fill="#9ca3af">PVP tiendas</text>
  <text x="${PX}" y="${HEAD_H + 78}" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="20" fill="#9ca3af"
        text-decoration="line-through">${pvpStr}</text>

  <!-- Caja precio -->
  <rect x="${IMG_W + 12}" y="${HEAD_H + 90}" width="${W - IMG_W - 24}" height="90" rx="10" fill="#dc2626"/>
  <text x="${PX}" y="${HEAD_H + 151}" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="42" font-weight="bold" fill="white"
  >${precioStr}</text>

  <!-- Pill descuento -->
  <rect x="${IMG_W + 38}" y="${HEAD_H + 196}" width="${W - IMG_W - 76}" height="34" rx="17" fill="#10b981"/>
  <text x="${PX}" y="${HEAD_H + 219}" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="17" font-weight="bold" fill="white"
  >-${descuentoPct}% vs PVP</text>

  <!-- Badge NUEVO -->
  <rect x="${IMG_W + 20}" y="${HEAD_H + 248}" width="${W - IMG_W - 40}" height="26" rx="13" fill="#0d47a1"/>
  <text x="${PX}" y="${HEAD_H + 266}" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="12" font-weight="bold" fill="white"
  >✓ A ESTRENAR</text>

  <!-- PIE -->
  <rect x="0" y="${HEAD_H + BODY_H}" width="${W}" height="${FOOT_H}" fill="#064e3b"/>
  <text x="${W/2}" y="${HEAD_H + BODY_H + 25}" text-anchor="middle"
        font-family="Arial,sans-serif" font-size="12" font-weight="bold" fill="white"
  >huntpadel.com — Segunda mano verificada</text>
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

function formatMensaje(
  palaNombre: string,
  precio: number,
  pvp: number,
  descuentoPct: number,
  url: string,
  primeraVezAt: string
): string {
  const emoji = descuentoPct >= 50 ? '🔥🔥' : '🔥'
  const desde = new Date(primeraVezAt).toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit',
  })
  return (
    `🎾 PÁDEL <b>#NuevoPadel</b> 🆕\n\n` +
    `${emoji} <b>${palaNombre}</b>\n` +
    `💰 <b>${precio.toFixed(2)}€</b>  <s>${pvp.toFixed(0)}€ PVP tiendas</s>  −${descuentoPct}%\n` +
    `✅ Estado: <b>NUEVO / A ESTRENAR</b>\n\n` +
    `🛒 <a href="${url}">Ver en Wallapop</a>\n\n` +
    `🕐 ${desde}  ·  🌐 <a href="${SITE_URL}">${SITE_URL.replace('https://', '')}</a>`
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🆕 Notify Wallapop Nuevos${DRY_RUN ? ' [DRY-RUN]' : ''}\n`)

  // 1. Cargar candidatos: condition=new, match fiable, >35% vs PVP tiendas
  const { data: candidatos, error: cErr } = await supabase
    .from('wallapop_cache')
    .select(`
      external_id, title, price, url, img, match_confidence,
      palas!inner (
        id, nombre, precio_referencia, imagen_url
      )
    `)
    .eq('condition', 'new')
    .eq('match_confidence', MIN_CONFIDENCE)
    .not('palas.precio_referencia', 'is', null)
    .gt('palas.precio_referencia', 0)

  if (cErr) { console.error('Error cargando candidatos:', cErr); process.exit(1) }
  if (!candidatos?.length) { console.log('Sin candidatos nuevos.'); return }

  // Filtrar por umbral de descuento
  const conDescuento = (candidatos as any[]).filter(c => {
    const pvp = c.palas?.precio_referencia ?? 0
    return pvp > 0 && c.price <= pvp * (1 - MIN_DESCUENTO)
  })

  console.log(`Candidatos con >=${Math.round(MIN_DESCUENTO * 100)}% descuento vs PVP: ${conDescuento.length}`)

  if (!conDescuento.length) { console.log('Ninguno supera el umbral.'); return }

  // 2. Cargar ya notificados
  const { data: notificados } = await supabase
    .from('wallapop_nuevos_notificados')
    .select('external_id')

  const yaNotificados = new Set((notificados ?? []).map((n: any) => n.external_id))

  // 3. Procesar cada candidato
  let enviados = 0

  for (const c of conDescuento) {
    const pala       = c.palas as any
    const pvp        = pala.precio_referencia as number
    const precio     = c.price as number
    const descPct    = Math.round((1 - precio / pvp) * 100)
    const palaNombre = pala.nombre as string

    console.log(`\n  → ${palaNombre} — ${precio}€ (−${descPct}% vs ${pvp.toFixed(0)}€ PVP)`)

    // Saltar si ya notificado
    if (yaNotificados.has(c.external_id)) {
      console.log('     ya notificado — omitido')
      continue
    }

    // Verificar activo en Wallapop
    console.log('     verificando activo en Wallapop...')
    const activo = await isWallapopActive(c.external_id)
    await sleep(VERIFY_THROTTLE)

    if (!activo) {
      console.log('     vendido/reservado — omitido y marcado inactivo')
      if (!DRY_RUN) {
        await supabase.from('wallapop_cache').delete().eq('external_id', c.external_id)
      }
      continue
    }

    // Registrar en tabla
    const primeraVezAt = new Date().toISOString()
    if (!DRY_RUN) {
      await supabase.from('wallapop_nuevos_notificados').insert({
        external_id:       c.external_id,
        pala_id:           pala.id,
        titulo:            c.title,
        precio,
        precio_referencia: pvp,
        descuento_vs_pvp:  descPct,
        url:               c.url,
        img:               c.img,
        pala_nombre:       palaNombre,
        primera_vez_at:    primeraVezAt,
      })
    }

    // Generar tarjeta y enviar
    console.log('     generando tarjeta...')
    const imagenUrl = c.img ?? pala.imagen_url ?? null
    const tarjeta   = await generarTarjeta(palaNombre, precio, pvp, descPct, imagenUrl)
    const caption   = formatMensaje(palaNombre, precio, pvp, descPct, c.url, primeraVezAt)

    const ok = await sendTelegramPhotoBuffer(tarjeta, caption)

    if (ok && !DRY_RUN) {
      await supabase
        .from('wallapop_nuevos_notificados')
        .update({ telegram_enviado_at: new Date().toISOString() })
        .eq('external_id', c.external_id)
    }

    if (ok) {
      console.log(`     ✅ Enviado a Telegram`)
      enviados++
    }
  }

  console.log(`\nResumen: ${enviados} notificaciones enviadas.\n`)
}

main().catch(err => {
  console.error('Error fatal:', err)
  process.exit(1)
})
