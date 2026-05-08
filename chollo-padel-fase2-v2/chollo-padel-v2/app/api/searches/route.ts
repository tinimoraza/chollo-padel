import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

// GET → devuelve top 10 más buscadas
export async function GET() {
  const { data, error } = await supabase
    .from('searches')
    .select('query, count')
    .order('count', { ascending: false })
    .limit(10)

  if (error) return NextResponse.json([], { status: 500 })
  return NextResponse.json(data ?? [])
}

// POST → registra o incrementa una búsqueda
export async function POST(req: Request) {
  const { query } = await req.json()
  if (!query?.trim()) return NextResponse.json({ ok: false })

  const q = query.trim().toLowerCase()

  const { data: existing } = await supabase
    .from('searches')
    .select('query, count')
    .eq('query', q)
    .single()

  if (existing) {
    await supabase
      .from('searches')
      .update({ count: existing.count + 1, last_searched_at: new Date().toISOString() })
      .eq('query', q)
  } else {
    await supabase
      .from('searches')
      .insert({ query: q, count: 1, last_searched_at: new Date().toISOString() })
  }

  return NextResponse.json({ ok: true })
}
