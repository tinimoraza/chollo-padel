import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET /api/alerts?email=xxx — lista alertas de un email
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const email = searchParams.get('email')?.trim()

  let query = supabaseAdmin
    .from('alertas')
    .select('*')
    .order('created_at', { ascending: false })

  if (email) query = query.eq('email', email)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ alertas: data })
}

// POST /api/alerts — crea alerta de búsqueda o favorito
export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    query, max_price, condition, platform, email,
    tipo = 'busqueda',
    item_id, item_url, item_titulo, item_img,
  } = body

  if (!email) {
    return NextResponse.json({ error: 'Falta email' }, { status: 400 })
  }
  if (tipo === 'busqueda' && !query) {
    return NextResponse.json({ error: 'Falta query para alerta de búsqueda' }, { status: 400 })
  }
  if (tipo === 'favorito' && (!item_id || !item_url)) {
    return NextResponse.json({ error: 'Falta item_id o item_url para favorito' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('alertas')
    .insert({
      email,
      tipo,
      query: tipo === 'busqueda' ? query : (item_titulo ?? null),
      max_price: max_price ?? null,
      condition: condition ?? null,
      platform: platform ?? 'all',
      activa: true,
      item_id:     item_id ?? null,
      item_url:    item_url ?? null,
      item_titulo: item_titulo ?? null,
      item_img:    item_img ?? null,
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

  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('alertas')
    .update({ activa })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ alerta: data })
}

// DELETE /api/alerts?id=xxx — elimina una alerta
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })

  const { error } = await supabaseAdmin.from('alertas').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}