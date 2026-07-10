import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/login', '/clubes/', '/alertas'],
      },
    ],
    sitemap: 'https://huntpadel.com/sitemap.xml',
    host: 'https://huntpadel.com',
  }
}
