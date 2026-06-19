/**
 * app/api/cron/match-wallapop/route.ts
 * GET /api/cron/match-wallapop
 *
 * Cron job que ejecuta el matcher único de pala_id (fuzzy-matcher +
 * embedding-matcher fallback, scripts/prices/secondhand-matcher.js) sobre
 * los items de wallapop_cache sin match o con match_confidence < 0.95.
 *
 * Reescrito 2026-06-19: se elimina la dependencia de scripts/match-pala-id.ts
 * (tokenizador propio, deshabilitado) y de scripts/prices/wallapop-matcher.js
 * (Jaro-Winkler, legacy). Ahora usa el mismo motor que el pipeline de tiendas.
 *
 * Autenticación: Bearer CRON_SECRET (igual que /api/cron)
 *
 * Vercel cron schedule: "0 * * * *" (cada hora) — aún no reactivado en
 * vercel.json / GitHub Actions hasta validar en dry-run.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // 5 min — el match puede tardar si hay muchos items

export async function GET(req: NextRequest) {
  // Seguridad: solo Vercel Cron o quien tenga el secret puede llamar esto
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Soporte para probar en dry-run sin escribir en BD: /api/cron/match-wallapop?dryRun=1
  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'

  const startedAt = new Date().toISOString()
  console.log('[cron/match-wallapop] Iniciando...', startedAt, dryRun ? '(dry-run)' : '')

  try {
    // require dinámico: secondhand-matcher.js y sus dependencias (fuzzy-matcher,
    // embedding-matcher, @xenova/transformers) son CommonJS, no módulos TS.
    const { matchSecondhandCache } = require('@/scripts/prices/secondhand-matcher')
    const { recalculatePriceReference } = require('@/scripts/prices/pipeline')

    const result = await matchSecondhandCache(supabaseAdmin, {
      dryRun,
      verbose: false,
      recalculatePriceReference,
    })

    const finishedAt = new Date().toISOString()

    // Log a scraper_logs para tener historial
    try {
      await supabaseAdmin.from('scraper_logs').insert({
        source_id: null,          // null indica job interno, no scraper de tienda
        started_at: startedAt,
        finished_at: finishedAt,
        status: 'success',
        productos_scrapeados: result.total,
        matches_encontrados: result.matched + result.kept,
        inserts_realizados: result.matched,
        errores: result.errors,
      })
    } catch {
      // Si falla el log, no bloqueamos la respuesta
    }

    console.log(`[cron/match-wallapop] Completado:`, result)

    return NextResponse.json({
      ok: true,
      dryRun,
      ...result,
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
