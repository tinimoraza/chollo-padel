import { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = 'https://huntpadel.com'
  const now = new Date()

  const static_urls: MetadataRoute.Sitemap = [
    { url: base,              lastModified: now, changeFrequency: 'weekly',  priority: 1   },
    { url: `${base}/chollos`, lastModified: now, changeFrequency: 'hourly',  priority: 0.9 },
    { url: `${base}/palas`,   lastModified: now, changeFrequency: 'daily',   priority: 0.8 },
    { url: `${base}/buscar`,  lastModified: now, changeFrequency: 'daily',   priority: 0.7 },
  ]

  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    )
    const { data } = await sb
      .from('palas')
      .select('slug, updated_at')
      .not('slug', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(2000)

    const pala_urls: MetadataRoute.Sitemap = (data ?? []).map((p: any) => ({
      url: `${base}/palas/${p.slug}`,
      lastModified: p.updated_at ? new Date(p.updated_at) : now,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    }))

    return [...static_urls, ...pala_urls]
  } catch {
    return static_urls
  }
}
