import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // El sitio es público — solo /clubes requiere contraseña propia
  const isClubesPath = request.nextUrl.pathname.startsWith('/clubes')
  const isClubesAccesoPage = request.nextUrl.pathname === '/clubes/acceso'
  const clubesToken = request.cookies.get('clubes_access')?.value
  const clubesPwd = process.env.CLUBES_PASSWORD

  // Redirigir a acceso si: no hay contraseña configurada, o el token no coincide
  if (isClubesPath && !isClubesAccesoPage && (!clubesPwd || clubesToken !== clubesPwd)) {
    return NextResponse.redirect(new URL('/clubes/acceso', request.url))
  }

  // Redirigir desde acceso a /clubes si ya está autenticado
  if (isClubesAccesoPage && clubesPwd && clubesToken === clubesPwd) {
    return NextResponse.redirect(new URL('/clubes', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api/|_next|favicon.ico|huntpadel-logo.svg).*)'],
}
