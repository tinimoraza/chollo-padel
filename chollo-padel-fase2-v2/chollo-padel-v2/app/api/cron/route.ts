import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { searchWallapop, PalaItem } from '@/lib/wallapop'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function GET(req: NextRequest) {
  // Seguridad: solo Vercel Cron o quien tenga el secret puede llamar esto
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('🔔 Cron iniciado:', new Date().toISOString())

  // 1. Cargar todas las alertas activas
  const { data: alertas, error } = await supabaseAdmin
    .from('alertas')
    .select('*')
    .eq('activa', true)

  if (error || !alertas?.length) {
    return NextResponse.json({ ok: true, procesadas: 0 })
  }

  let notificaciones = 0

  // 2. Para cada alerta, buscar chollos nuevos
  for (const alerta of alertas) {
    try {
      const items = await searchWallapop(alerta.query, alerta.max_price)

      // Filtrar por condición si la alerta lo pide
      const filtrados = items.filter((item) => {
        if (alerta.condition) {
          return item.condition.toLowerCase().includes(alerta.condition)
        }
        return true
      })

      // Solo los que tienen precio válido (chollos reales)
      const chollos = filtrados.filter(
        (item) => item.price > 0 && (!alerta.max_price || item.price <= alerta.max_price)
      )

      if (!chollos.length) continue

      // 3. Comparar con lo que ya notificamos (evitar spam)
      const { data: yaNotificados } = await supabaseAdmin
        .from('notificaciones')
        .select('item_id')
        .eq('alerta_id', alerta.id)
        .in('item_id', chollos.map((c) => c.id))

      const idsYaNotificados = new Set((yaNotificados || []).map((n: any) => n.item_id))
      const nuevos = chollos.filter((c) => !idsYaNotificados.has(c.id))

      if (!nuevos.length) continue

      // 4. Enviar email con los nuevos chollos
      await enviarEmail(alerta, nuevos)

      // 5. Guardar en DB que ya notificamos estos
      await supabaseAdmin.from('notificaciones').insert(
        nuevos.map((item) => ({
          alerta_id: alerta.id,
          item_id: item.id,
          precio: item.price,
          titulo: item.title,
          url: item.url,
        }))
      )

      // 6. Actualizar última ejecución de la alerta
      await supabaseAdmin
        .from('alertas')
        .update({ ultima_revision: new Date().toISOString(), ultima_notificacion: new Date().toISOString() })
        .eq('id', alerta.id)

      notificaciones++
    } catch (err) {
      console.error(`Error procesando alerta ${alerta.id}:`, err)
    }
  }

  return NextResponse.json({
    ok: true,
    alertas_procesadas: alertas.length,
    emails_enviados: notificaciones,
  })
}

async function enviarEmail(alerta: any, chollos: PalaItem[]) {
  const listaHtml = chollos
    .map(
      (c) => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #222;">
        <a href="${c.url}" style="color:#C8FF00;text-decoration:none;font-weight:bold;">${c.title}</a>
        <br><small style="color:#aaa;">📍 ${c.city} · ${c.condition}</small>
      </td>
      <td style="padding:12px;border-bottom:1px solid #222;text-align:right;font-size:24px;font-weight:bold;color:#FF5F1F;">
        ${c.price}€
      </td>
      <td style="padding:12px;border-bottom:1px solid #222;">
        <a href="${c.url}" style="background:#C8FF00;color:#000;padding:8px 16px;border-radius:4px;text-decoration:none;font-weight:bold;font-size:12px;">
          VER →
        </a>
      </td>
    </tr>`
    )
    .join('')

  await resend.emails.send({
    from: 'CHOLLO PADEL <alertas@choppadel.com>',
    to: alerta.email,
    subject: `🔥 ${chollos.length} chollos nuevos — ${alerta.query}`,
    html: `
      <div style="background:#080808;color:#fff;font-family:Arial,sans-serif;padding:32px;max-width:600px;margin:0 auto;">
        <h1 style="color:#C8FF00;letter-spacing:4px;margin:0 0 8px;">CHOLLO PADEL</h1>
        <p style="color:#aaa;margin:0 0 24px;">Alerta: <strong style="color:#fff;">${alerta.query}</strong>${alerta.max_price ? ` · Máx ${alerta.max_price}€` : ''}</p>
        
        <h2 style="color:#fff;margin:0 0 16px;">🔥 ${chollos.length} CHOLLOS ENCONTRADOS</h2>
        
        <table style="width:100%;border-collapse:collapse;">
          ${listaHtml}
        </table>
        
        <p style="color:#555;font-size:12px;margin-top:32px;">
          Para gestionar tus alertas visita chollo-padel.vercel.app<br>
          <a href="{{unsubscribe_url}}" style="color:#555;">Cancelar alertas</a>
        </p>
      </div>
    `,
  })
}
