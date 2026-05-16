/**
 * app/api/top/route.ts
 * GET /api/top — Devuelve el Top 10 de oportunidades actual
 */

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { data, error } = await supabase
    .from('top_oportunidades')
    .select('*')
    .order('descuento_pct', { ascending: false })
    .limit(10)

  if (error) {
    return NextResponse.json({ error: 'Error leyendo top oportunidades' }, { status: 500 })
  }

  return NextResponse.json({ items: data ?? [], updated_at: data?.[0]?.updated_at ?? null })
}
