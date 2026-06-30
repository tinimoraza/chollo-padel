import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { password } = await req.json()

  if (password !== process.env.CLUBES_PASSWORD) {
    return NextResponse.json({ error: 'Incorrecta' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('clubes_access', process.env.CLUBES_PASSWORD!, {
    httpOnly: true,
    secure: true,
    maxAge: 60 * 60 * 24 * 30, // 30 días
    path: '/',
  })
  return res
}
