import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/alerts — lista todas las alertas
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('alertas')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ alertas: data })
}

// POST /api/alerts — crea una nueva alerta
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { query, max_price, condition, platform, email } = body

  if (!query || !email) {
    return NextResponse.json({ error: 'Faltan campos obligatorios (query, email)' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('alertas')
    .insert({
      query,
      max_price: max_price || null,
      condition: condition || null,
      platform: platform || 'all',
      email,
      activa: true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ alerta: data }, { status: 201 })
}

// PATCH /api/alerts — activa/pausa una alerta
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, activa } = body

  const { data, error } = await supabaseAdmin
    .from('alertas')
    .update({ activa })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ alerta: data })
}

// DELETE /api/alerts — elimina una alerta
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })

  const { error } = await supabaseAdmin.from('alertas').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
