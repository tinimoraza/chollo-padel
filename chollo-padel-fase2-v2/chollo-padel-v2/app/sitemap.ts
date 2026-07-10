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
    const { data } = await supabaseAdmin
      .from('palas')
      .select('slug, precios_updated_at')
      .not('slug', 'is', null)
      .neq('slug', '')
      .limit(10000)

    const palaUrls: MetadataRoute.Sitemap = (data ?? []).map((p: any) => ({
      url: `${base}/palas/${p.slug}`,
      lastModified: p.precios_updated_at ? new Date(p.precios_updated_at) : now,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    }))

    return [...staticUrls, ...palaUrls]
  } catch {
    return staticUrls
  }
}
