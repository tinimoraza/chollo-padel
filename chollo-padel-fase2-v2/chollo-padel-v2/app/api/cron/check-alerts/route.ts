import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { Resend } from 'resend'
import { searchWallapop } from '@/lib/wallapop'

const resend = new Resend(process.env.RESEND_API_KEY)

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`

  if (authHeader !== expected) {
    console.error('AUTH FAILED — header:', authHeader.length, 'expected:', expected.length)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 1. Obtener alertas activas
  const { data: alertas, error } = await supabaseAdmin
    .from('alertas')
    .select('*')
    .eq('activa', true)

  if (error || !alertas) {
    return NextResponse.json({ error: 'Error leyendo alertas' }, { status: 500 })
  }

  let notificacionesEnviadas = 0

  for (const alerta of alertas) {
    try {
      if (alerta.tipo === 'busqueda' || !alerta.tipo) {
        await procesarAlertaBusqueda(alerta)
        notificacionesEnviadas++
      } else if (alerta.tipo === 'favorito') {
        await procesarAlertaFavorito(alerta)
        notificacionesEnviadas++
      }
    } catch (err) {
      console.error(`Error procesando alerta ${alerta.id}:`, err)
    }
  }

  return NextResponse.json({ ok: true, procesadas: alertas.length, notificacionesEnviadas })
}

async function procesarAlertaBusqueda(alerta: any) {
  const resultados = await searchWallapop(
    alerta.query,
    alerta.max_price ?? undefined,
    undefined,
    alerta.condition ? [alerta.condition] : undefined
  )

  if (resultados.length === 0) return

  const { data: yaNotificados } = await supabaseAdmin
    .from('notificaciones')
    .select('item_id')
    .eq('alerta_id', alerta.id)

  const idsNotificados = new Set((yaNotificados ?? []).map((n: any) => n.item_id))
  const nuevos = resultados.filter(r => !idsNotificados.has(r.id))

  if (nuevos.length === 0) return

  await resend.emails.send({
    from: 'HuntPadel <noreply@huntpadel.com>',
    to: alerta.email,
    subject: `🎾 ${nuevos.length} nuevo${nuevos.length > 1 ? 's' : ''} resultado${nuevos.length > 1 ? 's' : ''} para "${alerta.query}"`,
    html: buildEmailBusqueda(alerta, nuevos),
  })

  await supabaseAdmin.from('notificaciones').insert(
    nuevos.map(item => ({
      alerta_id: alerta.id,
      item_id: item.id,
      precio: item.price,
      titulo: item.title,
      url: item.url,
    }))
  )

  await supabaseAdmin
    .from('alertas')
    .update({ ultima_notificacion: new Date().toISOString() })
    .eq('id', alerta.id)
}

async function procesarAlertaFavorito(alerta: any) {
  if (!alerta.item_id || !alerta.max_price) return

  const { data: item } = await supabaseAdmin
    .from('wallapop_cache')
    .select('*')
    .eq('external_id', alerta.item_id)
    .single()

  if (!item) return
  if (item.price >= alerta.max_price) return

  const { data: yaNotificado } = await supabaseAdmin
    .from('notificaciones')
    .select('id')
    .eq('alerta_id', alerta.id)
    .eq('precio', item.price)
    .single()

  if (yaNotificado) return

  await resend.emails.send({
    from: 'HuntPadel <noreply@huntpadel.com>',
    to: alerta.email,
    subject: `📉 Bajada de precio: ${item.title} ahora a ${item.price}€`,
    html: buildEmailFavorito(alerta, item),
  })

  await supabaseAdmin.from('notificaciones').insert({
    alerta_id: alerta.id,
    item_id: alerta.item_id,
    precio: item.price,
    titulo: item.title,
    url: item.url,
    precio_original: alerta.max_price,
  })

  await supabaseAdmin
    .from('alertas')
    .update({ ultima_notificacion: new Date().toISOString() })
    .eq('id', alerta.id)
}

function buildEmailBusqueda(alerta: any, items: any[]) {
  const itemsHtml = items.slice(0, 5).map(item => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #eee;">
        ${item.img ? `<img src="${item.img}" width="60" style="border-radius:6px;vertical-align:middle;margin-right:10px;">` : ''}
        <a href="${item.url}" style="color:#1a1a1a;font-weight:600;text-decoration:none;">${item.title}</a>
      </td>
      <td style="padding:12px;border-bottom:1px solid #eee;font-weight:700;color:#16a34a;white-space:nowrap;">
        ${item.price}€
      </td>
      <td style="padding:12px;border-bottom:1px solid #eee;">
        <a href="${item.url}" style="background:#1a1a1a;color:white;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:13px;">Ver</a>
      </td>
    </tr>
  `).join('')

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1a1a1a;padding:20px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">🎾 HuntPadel</h1>
      </div>
      <div style="padding:24px;background:#f9f9f9;">
        <p style="color:#444;">Nuevos resultados para tu alerta <strong>"${alerta.query}"</strong>${alerta.max_price ? ` por menos de <strong>${alerta.max_price}€</strong>` : ''}:</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:white;border-radius:8px;overflow:hidden;">
          ${itemsHtml}
        </table>
        ${items.length > 5 ? `<p style="color:#888;font-size:13px;">Y ${items.length - 5} más...</p>` : ''}
      </div>
      <div style="padding:16px;text-align:center;font-size:12px;color:#999;">
        <a href="#" style="color:#999;">Cancelar alerta</a>
      </div>
    </div>
  `
}

function buildEmailFavorito(alerta: any, item: any) {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1a1a1a;padding:20px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">🎾 HuntPadel</h1>
      </div>
      <div style="padding:24px;background:#f9f9f9;">
        <p style="color:#444;">Tu favorito ha bajado de precio:</p>
        <div style="background:white;border-radius:8px;padding:20px;display:flex;gap:16px;">
          ${item.img ? `<img src="${item.img}" width="80" style="border-radius:8px;">` : ''}
          <div>
            <p style="margin:0;font-weight:600;font-size:16px;">${item.title}</p>
            <p style="margin:8px 0;color:#888;text-decoration:line-through;">${alerta.max_price}€</p>
            <p style="margin:0;color:#16a34a;font-size:22px;font-weight:700;">${item.price}€</p>
          </div>
        </div>
        <a href="${item.url}" style="display:inline-block;margin-top:16px;background:#16a34a;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Ver en Wallapop</a>
      </div>
      <div style="padding:16px;text-align:center;font-size:12px;color:#999;">
        <a href="#" style="color:#999;">Cancelar alerta</a>
      </div>
    </div>
  `
}
