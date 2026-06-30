import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const token = request.cookies.get('beta_access')?.value
  const isLoginPage = request.nextUrl.pathname === '/login'

  if (!token && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (token === process.env.BETA_PASSWORD && isLoginPage) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  if (token !== process.env.BETA_PASSWORD && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Segunda contraseña específica para la sección /clubes
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
