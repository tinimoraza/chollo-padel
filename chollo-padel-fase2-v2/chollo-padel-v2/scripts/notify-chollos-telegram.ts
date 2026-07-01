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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const DRY_RUN        = process.argv.includes('--dry-run')
const BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID        = process.env.TELEGRAM_CHAT_ID
const SITE_URL       = 'https://chollo-padel.vercel.app'

// Umbrales idénticos a los de /api/chollos
const UMBRAL_CHOLLO  = 0.65
const UMBRAL_OFERTA  = 0.75
const MIN_REFERENCIA = 50
const MIN_FUENTES    = 2
const MIN_ANO        = 2024

// ─── Helpers ──────────────────────────────────────────────────────────────────

function precioEfectivo(snap: { precio: number; codigo_descuento?: string | null; descuento_pct?: number | null }): number {
  if (snap.codigo_descuento && snap.descuento_pct && Number(snap.descuento_pct) > 0) {
    return snap.precio * (1 - Number(snap.descuento_pct) / 100)
  }
  return snap.precio
}

async function sendTelegram(text: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('   ⚠️  TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados — se omite envío')
    return false
  }
  if (DRY_RUN) {
    console.log('   [dry-run] Telegram:', text.slice(0, 120), '…')
    return true
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error('   ❌ Telegram error:', err)
      return false
    }
    return true
  } catch (e) {
    console.error('   ❌ Telegram excepción:', e)
    return false
  }
}

function formatMensaje(chollo: {
  nombre_pala: string
  marca: string | null
  precio: number
  precio_referencia: number
  descuento_pct: number
  url_producto: string
  tienda: string
  primera_vez_at: string
  codigo_descuento?: string | null
}): string {
  const emoji = chollo.descuento_pct >= 35 ? '🔥🔥' : '🔥'
  const desde = new Date(chollo.primera_vez_at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })
  const lineaCodigo = chollo.codigo_descuento
    ? `🏷️ Código: <code>${chollo.codigo_descuento}</code>\n`
    : ''
  return (
    `${emoji} <b>NUEVO CHOLLO</b> — ${chollo.nombre_pala}\n` +
    `💰 <b>${chollo.precio.toFixed(2)} €</b>  (ref. ${chollo.precio_referencia.toFixed(0)} €, −${chollo.descuento_pct}%)\n` +
    lineaCodigo +
    `🏪 ${chollo.tienda}\n` +
    `🕐 Detectado a las ${desde}\n` +
    `🔗 ${chollo.url_producto}`
  )
}

// ─── Paso 1: Cargar chollos actuales del pipeline ─────────────────────────────

async function cargarChollosActuales() {
  const since = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString() // ventana 26h (algo más que las 24h de la API)
  const PAGE_SIZE = 1000
  const snapshots: any[] = []

  for (let from = 0; from <= 5000; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('price_snapshots')
      .select(`
        pala_id, source_id, precio, url_producto, scraped_at,
        codigo_descuento, descuento_pct,
        price_sources ( nombre, slug ),
        palas ( id, nombre, marca, slug, año, modelo,
          price_reference ( precio_referencia, fuentes_count ) )
      `)
      .eq('disponible', true)
      .gte('scraped_at', since)
      .gte('match_confidence', 0.95)
      .neq('source_id', 2)
      .order('scraped_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break
    snapshots.push(...data)
    if (data.length < PAGE_SIZE) break
  }

  // Dedup por (pala_id, source_id): quédate con el más reciente
  const byKey = new Map<string, any>()
  for (const snap of snapshots) {
    const key = `${snap.pala_id}__${snap.source_id}`
    const ex = byKey.get(key)
    if (!ex || snap.scraped_at > ex.scraped_at) byKey.set(key, snap)
  }

  // Filtrar solo CHOLLOs reales
  const chollos: Array<{
    pala_id: string; source_id: number; precio: number; precio_referencia: number
    descuento_pct: number; url_producto: string; nombre_pala: string; marca: string | null
    tienda: string; tienda_slug: string; codigo_descuento: string | null
  }> = []

  for (const snap of byKey.values()) {
    const pala   = snap.palas as any
    const fuente = snap.price_sources as any
    if (!pala || !fuente) continue

    const año = pala['año'] ?? pala['ano'] ?? null
    if (!año || año < MIN_ANO) continue

    const priceRefArr = pala.price_reference
    const priceRef = Array.isArray(priceRefArr) ? priceRefArr[0] : priceRefArr
    if (!priceRef) continue

    const ref          = Number(priceRef.precio_referencia)
    const fuentesCount = priceRef.fuentes_count as number
    if (!ref || ref < MIN_REFERENCIA || fuentesCount < MIN_FUENTES) continue

    const pEfectivo = precioEfectivo(snap)
    const ratio     = pEfectivo / ref
    if (ratio > UMBRAL_CHOLLO) continue  // Solo CHOLLO, no OFERTA

    chollos.push({
      pala_id:           snap.pala_id,
      source_id:         snap.source_id,
      precio:            pEfectivo,
      precio_referencia: ref,
      descuento_pct:     Math.round((1 - ratio) * 100),
      url_producto:      snap.url_producto,
      nombre_pala:       pala.nombre ?? pala.modelo,
      marca:             pala.marca,
      tienda:            fuente.nombre,
      tienda_slug:       fuente.slug,
      codigo_descuento:  snap.codigo_descuento ?? null,
    })
  }

  return chollos
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
      // Chollo que había desaparecido y vuelve — re-activar y re-notificar
      console.log(`   🔄 Chollo reaparecido: ${c.nombre_pala} en ${c.tienda}`)
      if (!DRY_RUN) {
        await supabase.from('chollos_notificados')
          .update({ activo: true, precio: c.precio, precio_referencia: c.precio_referencia,
                    descuento_pct: c.descuento_pct, primera_vez_at: new Date().toISOString(),
                    telegram_enviado_at: null, codigo_descuento: c.codigo_descuento })
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
    .select('*')
    .eq('activo', true)
    .is('telegram_enviado_at', null)
    .order('descuento_pct', { ascending: false })

  if (!pendientes || pendientes.length === 0) {
    console.log('   ✅ No hay chollos nuevos que notificar por Telegram')
    return { insertados, enviados }
  }

  console.log(`\n   📨 Enviando ${pendientes.length} notificaciones Telegram…`)
  for (const p of pendientes) {
    const msg  = formatMensaje(p)
    const ok   = await sendTelegram(msg)
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
