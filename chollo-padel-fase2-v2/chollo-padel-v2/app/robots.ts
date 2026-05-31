import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/login'],
      },
    ],
    sitemap: 'https://huntpadel.com/sitemap.xml',
    host: 'https://huntpadel.com',
  }
}
