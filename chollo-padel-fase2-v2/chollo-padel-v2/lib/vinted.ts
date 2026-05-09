// Caché del token en memoria
let cachedAuth: { cookie: string; token: string; expiresAt: number } | null = null

async function getVintedToken(): Promise<{ cookie: string; token: string } | null> {
  // Si el caché es válido (menos de 5 minutos), lo reutilizamos
  if (cachedAuth && Date.now() < cachedAuth.expiresAt) {
    return { cookie: cachedAuth.cookie, token: cachedAuth.token }
  }

  try {
    const res = await fetch('https://www.vinted.es', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
    })

    const rawCookies = res.headers.getSetCookie?.() ?? []

    const cookie = rawCookies
      .map((c) => c.split(';')[0])
      .filter((c) => {
        const [, val] = c.split('=')
        return val && val.trim().length > 0
      })
      .join('; ')

    const tokenEntry = rawCookies
      .map((c) => c.split(';')[0])
      .find((c) => c.startsWith('access_token_web=') && c.length > 'access_token_web='.length + 5)

    const token = tokenEntry?.split('=').slice(1).join('=')
    if (!token) return null

    // Guardamos en caché con TTL de 5 minutos
    cachedAuth = { cookie, token, expiresAt: Date.now() + 5 * 60 * 1000 }
    return { cookie, token }
  } catch (err) {
    console.error('Error obteniendo token de Vinted:', err)
    return null
  }
}
