/**
 * app/api/top/route.ts
 * GET /api/top — Devuelve el Top 40 de oportunidades actual
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Fix 2026-08-14 (mismo motivo que /api/chollos — ver comentario allí):
// sin caché, cada visita volvía a pedir la tabla entera a Supabase.
export const revalidate = 300

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('top_oportunidades')
    .select('*')
    .order('posicion', { ascending: true })
    .limit(40)

  if (error) {
    return NextResponse.json({ error: 'Error leyendo top oportunidades' }, { status: 500 })
  }

  return NextResponse.json(
    { items: data ?? [], updated_at: data?.[0]?.updated_at ?? null },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' } }
  )
}
