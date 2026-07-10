import type { MetadataRoute } from 'next'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = 'https://huntpadel.com'
  const now = new Date()

  const staticUrls: MetadataRoute.Sitemap = [
    { url: base,              lastModified: now, changeFrequency: 'daily',  priority: 1.0 },
    { url: `${base}/chollos`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${base}/palas`,   lastModified: now, changeFrequency: 'daily',  priority: 0.9 },
    { url: `${base}/top`,     lastModified: now, changeFrequency: 'daily',  priority: 0.7 },
    { url: `${base}/buscar`,  lastModified: now, changeFrequency: 'daily',  priority: 0.6 },
  ]

  try {
    const [palasRes, marcasRes] = await Promise.all([
      supabaseAdmin
        .from('palas')
        .select('slug, precios_updated_at')
        .not('slug', 'is', null)
        .neq('slug', '')
        .limit(10000),
      supabaseAdmin
        .from('palas')
        .select('brand_slug')
        .not('brand_slug', 'is', null)
        .neq('brand_slug', '')
        .limit(10000),
    ])

    const palaUrls: MetadataRoute.Sitemap = (palasRes.data ?? []).map((p: any) => {
      return {
        url: `${base}/palas/${p.slug}`,
        lastModified: p.precios_updated_at ? new Date(p.precios_updated_at) : now,
        changeFrequency: 'daily' as const,
        priority: 0.8,
      }
    })

    const brandSlugs = Array.from(new Set((marcasRes.data ?? []).map((p: any) => p.brand_slug as string)))
    const marcaUrls: MetadataRoute.Sitemap = brandSlugs.map((s) => {
      return {
        url: `${base}/marcas/${s}`,
        lastModified: now,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      }
    })

    return [...staticUrls, ...marcaUrls, ...palaUrls]
  } catch {
    return staticUrls
  }
}
