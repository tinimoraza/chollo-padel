/**
 * app/api/top/route.ts
 * GET /api/top — Devuelve el Top 10 de oportunidades actual
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('top_oportunidades')
    .select('*')
    .order('posicion', { ascending: true })
    .limit(10)

  if (error) {
    return NextResponse.json({ error: 'Error leyendo top oportunidades' }, { status: 500 })
  }

  return NextResponse.json(
    { items: data ?? [], updated_at: data?.[0]?.updated_at ?? null },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  )
}
