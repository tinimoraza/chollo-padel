/**
 * app/api/cron/match-wallapop/route.ts
 * GET /api/cron/match-wallapop
 *
 * Cron job que ejecuta el matcher de pala_id sobre todos los items de
 * wallapop_cache sin pala_id (nuevos de la extensión + reintentos de
 * no_match/ambiguous previos).
 *
 * Antes esto dependía de GitHub Actions (poco fiable). Ahora corre en
 * Vercel Cron cada hora para que los items de la extensión se matcheen
 * automáticamente sin intervención manual.
 *
 * Autenticación: Bearer CRON_SECRET (igual que /api/cron)
 *
 * Vercel cron schedule: "0 * * * *" (cada hora)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { matchPalaIds } from '@/scripts/match-pala-id'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // 5 min — el match puede tardar si hay muchos items

export async function GET(req: NextRequest) {
  // Seguridad: solo Vercel Cron o quien tenga el secret puede llamar esto
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // PAUSADO — nueva estrategia de matching en desarrollo
  // TODO: reactivar cuando el nuevo sistema esté listo
  return NextResponse.json({ ok: false, message: 'PAUSADO — sistema en mantenimiento' }, { status: 503 })


  const startedAt = new Date().toISOString()
  console.log('[cron/match-wallapop] Iniciando...', startedAt)

  try {
    const result = await matchPalaIds(supabaseAdmin, { verbose: false })

    const finishedAt = new Date().toISOString()

    // Log a scraper_logs para tener historial
    try {
      await supabaseAdmin.from('scraper_logs').insert({
        source_id: null,          // null indica job interno, no scraper de tienda
        started_at: startedAt,
        finished_at: finishedAt,
        status: 'success',
        productos_scrapeados: result.matched + result.ambiguous + result.noMatch,
        matches_encontrados: result.matched,
        inserts_realizados: result.matched,
        errores: 0,
      })
    } catch {
      // Si falla el log, no bloqueamos la respuesta
    }

    console.log(`[cron/match-wallapop] Completado: ${result.matched} matches, ${result.ambiguous} ambiguos, ${result.noMatch} sin match`)

    return NextResponse.json({
      ok: true,
      matched:   result.matched,
      ambiguous: result.ambiguous,
      noMatch:   result.noMatch,
      started_at:  startedAt,
      finished_at: finishedAt,
    })

  } catch (err: any) {
    console.error('[cron/match-wallapop] Error fatal:', err)

    try {
      await supabaseAdmin.from('scraper_logs').insert({
        source_id: null,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: 'error',
        errores: 1,
      })
    } catch {}

    return NextResponse.json(
      { error: err.message ?? 'Error desconocido' },
      { status: 500 }
    )
  }
}
