import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // El sitio es público — solo /clubes requiere contraseña propia
  const isClubesPath = request.nextUrl.pathname.startsWith('/clubes')
  const isClubesAccesoPage = request.nextUrl.pathname === '/clubes/acceso'
  const clubesToken = request.cookies.get('clubes_access')?.value

  if (isClubesPath && !isClubesAccesoPage && clubesToken !== process.env.CLUBES_PASSWORD) {
    return NextResponse.redirect(new URL('/clubes/acceso', request.url))
  }

  if (isClubesAccesoPage && clubesToken === process.env.CLUBES_PASSWORD) {
    return NextResponse.redirect(new URL('/clubes', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api/|_next|favicon.ico|huntpadel-logo.svg).*)'],
}
