import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase-admin'
import Header from '@/components/Header'
import BottomNav from '@/components/BottomNav'

export const revalidate = 3600

interface PalaMarca {
  id: string
  slug: string
  nombre: string
  marca: string
  brand_slug: string
  año: number
  forma: string
  balance: string
  juego: string
  genero: string
  material_nucleo: string
  precio_pvp: number
  precio_referencia: number
  precio_minimo_tiendas: number
  imagen_url: string
}

interface MarcaInfo {
  marca: string
  brand_slug: string
  total: number
}

async function getMarcaInfo(brandSlug: string): Promise<MarcaInfo | null> {
  const { data } = await supabaseAdmin
    .from('palas')
    .select('marca, brand_slug')
    .eq('brand_slug', brandSlug)
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const { count } = await supabaseAdmin
    .from('palas')
    .select('*', { count: 'exact', head: true })
    .eq('brand_slug', brandSlug)
  return { marca: data.marca, brand_slug: data.brand_slug, total: count ?? 0 }
}

async function getPalasMarca(brandSlug: string): Promise<PalaMarca[]> {
  const { data } = await supabaseAdmin
    .from('palas')
    .select('id,slug,nombre,marca,brand_slug,año,forma,balance,juego,genero,material_nucleo,precio_pvp,precio_referencia,precio_minimo_tiendas,imagen_url')
    .eq('brand_slug', brandSlug)
    .order('precio_referencia', { ascending: true })
    .limit(500)
  return (data ?? []) as unknown as PalaMarca[]
}

export async function generateStaticParams() {
  const { data } = await supabaseAdmin
    .from('palas')
    .select('brand_slug')
    .not('brand_slug', 'is', null)
    .neq('brand_slug', '')
  const slugs = Array.from(new Set((data ?? []).map((p: any) => p.brand_slug as string)))
  return slugs.map((s) => ({ marca: s }))
}

export async function generateMetadata(
  { params }: { params: { marca: string } }
): Promise<Metadata> {
  const info = await getMarcaInfo(params.marca)
  if (!info) return { title: 'Marca no encontrada | HuntPadel' }

  const title = `Palas ${info.marca} — Precios y comparativa | HuntPadel`
  const desc = `Compara ${info.total} modelos de palas ${info.marca} con precios actualizados de las mejores tiendas de pádel online. Encuentra la pala ${info.marca} más barata.`

  return {
    title,
    description: desc,
    keywords: `palas ${info.marca.toLowerCase()}, ${info.marca.toLowerCase()} padel precio, palas ${info.marca.toLowerCase()} baratas, comprar ${info.marca.toLowerCase()} padel`,
    openGraph: {
      title,
      description: desc,
      url: `https://huntpadel.com/marcas/${info.brand_slug}`,
      siteName: 'HuntPadel',
      type: 'website',
      images: [{ url: 'https://huntpadel.com/opengraph-image', width: 1200, height: 630 }],
    },
    alternates: { canonical: `https://huntpadel.com/marcas/${info.brand_slug}` },
  }
}

function JsonLd({ info, palas }: { info: MarcaInfo; palas: PalaMarca[] }) {
  const items = palas.slice(0, 20).map((p, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': 'Product',
      name: p.nombre,
      url: `https://huntpadel.com/palas/${p.slug}`,
      brand: { '@type': 'Brand', name: info.marca },
      ...(p.imagen_url ? { image: p.imagen_url } : {}),
      ...(Number(p.precio_minimo_tiendas) > 0 || Number(p.precio_pvp) > 0 ? {
        offers: {
          '@type': 'Offer',
          priceCurrency: 'EUR',
          price: (Number(p.precio_minimo_tiendas) > 0
            ? Number(p.precio_minimo_tiendas)
            : Number(p.precio_pvp)).toFixed(2),
          availability: 'https://schema.org/InStock',
        },
      } : {}),
    },
  }))

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `https://huntpadel.com/marcas/${info.brand_slug}`,
        url: `https://huntpadel.com/marcas/${info.brand_slug}`,
        name: `Palas ${info.marca} — Precios y comparativa | HuntPadel`,
        description: `Comparativa de precios de palas ${info.marca} en tiendas online`,
        inLanguage: 'es',
        isPartOf: { '@type': 'WebSite', '@id': 'https://huntpadel.com/#website' },
        breadcrumb: {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'HuntPadel', item: 'https://huntpadel.com' },
            { '@type': 'ListItem', position: 2, name: 'Palas', item: 'https://huntpadel.com/palas' },
            { '@type': 'ListItem', position: 3, name: `Palas ${info.marca}`, item: `https://huntpadel.com/marcas/${info.brand_slug}` },
          ],
        },
      },
      {
        '@type': 'ItemList',
        name: `Palas ${info.marca}`,
        numberOfItems: palas.length,
        itemListElement: items,
      },
    ],
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: "'Space Grotesk', sans-serif",
      fontSize: 10,
      letterSpacing: 1.2,
      textTransform: 'uppercase' as const,
      padding: '2px 8px',
      border: '1px solid var(--border)',
      color: 'var(--muted)',
      borderRadius: 3,
    }}>
      {children}
    </span>
  )
}

export default async function MarcaPage({ params }: { params: { marca: string } }) {
  const [info, palas] = await Promise.all([
    getMarcaInfo(params.marca),
    getPalasMarca(params.marca),
  ])
  if (!info) notFound()

  const conPrecio = palas.filter(p => Number(p.precio_referencia) > 0 || Number(p.precio_minimo_tiendas) > 0)
  const sinPrecio = palas.filter(p => !Number(p.precio_referencia) && !Number(p.precio_minimo_tiendas))

  return (
    <div className="app-shell">
      <JsonLd info={info} palas={palas} />

      <style>{`
        .marca-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 1rem;
        }
        .pala-card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 1rem;
          text-decoration: none;
          color: inherit;
          display: block;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .pala-card:hover {
          border-color: rgba(80,120,0,0.35);
          box-shadow: var(--card-shadow-hover);
        }
        @media (max-width: 640px) {
          .marca-grid { grid-template-columns: repeat(2, 1fr); gap: 0.75rem; }
        }
      `}</style>

      <Header />
      <BottomNav />

      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '2rem 1rem 5rem' }}>

        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 12, color: 'var(--muted)', letterSpacing: 1,
          marginBottom: 28, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const,
        }}>
          <Link href="/" style={{ color: 'var(--muted)', textDecoration: 'none' }}>HuntPadel</Link>
          <span style={{ opacity: 0.4 }}>›</span>
          <Link href="/palas" style={{ color: 'var(--muted)', textDecoration: 'none' }}>Palas</Link>
          <span style={{ opacity: 0.4 }}>›</span>
          <span style={{ color: 'var(--text)' }}>{info.marca}</span>
        </nav>

        {/* Header */}
        <div style={{ marginBottom: '2.5rem' }}>
          <div style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 11, letterSpacing: 3, color: 'var(--accent-fg)',
            marginBottom: 8, textTransform: 'uppercase' as const,
          }}>
            Marca
          </div>
          <h1 style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 48, letterSpacing: 2, marginBottom: 12, lineHeight: 1.0,
          }}>
            Palas {info.marca}
          </h1>
          <p style={{
            fontFamily: "'Barlow', sans-serif",
            fontSize: 16, color: 'var(--muted)', maxWidth: 600, lineHeight: 1.6,
          }}>
            {palas.length} modelos en catálogo
            {conPrecio.length > 0 && ` · ${conPrecio.length} con precio actualizado de tiendas`}.
            Compara y encuentra el mejor precio en cada pala {info.marca}.
          </p>
        </div>

        {/* Grid palas con precio */}
        {conPrecio.length > 0 && (
          <section style={{ marginBottom: '3rem' }}>
            <h2 style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 12, letterSpacing: 2, color: 'var(--muted)',
              textTransform: 'uppercase' as const, marginBottom: 20,
            }}>
              Con precio en tiendas
            </h2>
            <div className="marca-grid">
              {conPrecio.map(pala => {
                const precio = Number(pala.precio_minimo_tiendas) > 0
                  ? Number(pala.precio_minimo_tiendas)
                  : Number(pala.precio_referencia)
                const año = (pala as any)['año'] ?? 0
                return (
                  <Link key={pala.id} href={`/palas/${pala.slug}`} className="pala-card">
                    {/* Imagen */}
                    <div style={{
                      background: '#E8E9EC', borderRadius: 7,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      height: 120, marginBottom: 10, padding: '0.5rem',
                    }}>
                      {pala.imagen_url
                        ? <img
                            src={pala.imagen_url}
                            alt={pala.nombre}
                            style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', mixBlendMode: 'multiply' }}
                          />
                        : <span style={{ fontSize: 40 }}>🏓</span>
                      }
                    </div>

                    {/* Nombre */}
                    <div style={{
                      fontFamily: "'Barlow', sans-serif",
                      fontSize: 13, fontWeight: 600, lineHeight: 1.3,
                      marginBottom: 8, color: 'var(--text)',
                    }}>
                      {pala.nombre}
                    </div>

                    {/* Precio */}
                    <div style={{ marginBottom: 8 }}>
                      <span style={{
                        fontFamily: "'Bebas Neue', sans-serif",
                        fontSize: 22, color: 'var(--accent-fg)',
                      }}>
                        {precio.toFixed(2)} €
                      </span>
                      <span style={{
                        fontFamily: "'Barlow', sans-serif",
                        fontSize: 11, color: 'var(--faint)', marginLeft: 5,
                      }}>
                        desde tiendas
                      </span>
                    </div>

                    {/* Tags */}
                    <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 4 }}>
                      {pala.forma && <Tag>{pala.forma}</Tag>}
                      {pala.balance && <Tag>{pala.balance}</Tag>}
                      {año > 0 && <Tag>{año}</Tag>}
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* Grid palas sin precio */}
        {sinPrecio.length > 0 && (
          <section style={{ marginBottom: '3rem' }}>
            <h2 style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 12, letterSpacing: 2, color: 'var(--muted)',
              textTransform: 'uppercase' as const, marginBottom: 20,
            }}>
              Más modelos en catálogo
            </h2>
            <div className="marca-grid">
              {sinPrecio.map(pala => {
                const año = (pala as any)['año'] ?? 0
                return (
                  <Link key={pala.id} href={`/palas/${pala.slug}`} className="pala-card" style={{ opacity: 0.7 }}>
                    <div style={{
                      background: '#E8E9EC', borderRadius: 7,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      height: 100, marginBottom: 10, padding: '0.5rem',
                    }}>
                      {pala.imagen_url
                        ? <img
                            src={pala.imagen_url}
                            alt={pala.nombre}
                            style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', mixBlendMode: 'multiply' }}
                          />
                        : <span style={{ fontSize: 36 }}>🏓</span>
                      }
                    </div>
                    <div style={{
                      fontFamily: "'Barlow', sans-serif",
                      fontSize: 13, fontWeight: 600, lineHeight: 1.3,
                      marginBottom: 8, color: 'var(--text)',
                    }}>
                      {pala.nombre}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 4 }}>
                      {pala.forma && <Tag>{pala.forma}</Tag>}
                      {pala.balance && <Tag>{pala.balance}</Tag>}
                      {año > 0 && <Tag>{año}</Tag>}
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* Otras marcas */}
        <section style={{ borderTop: '1px solid var(--border)', paddingTop: '2rem' }}>
          <div style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 12, letterSpacing: 2, color: 'var(--muted)',
            textTransform: 'uppercase' as const, marginBottom: 16,
          }}>
            Otras marcas
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8 }}>
            {[
              { slug: 'bullpadel', name: 'Bullpadel' },
              { slug: 'adidas', name: 'Adidas' },
              { slug: 'nox', name: 'Nox' },
              { slug: 'siux', name: 'Siux' },
              { slug: 'starvie', name: 'StarVie' },
              { slug: 'head', name: 'Head' },
              { slug: 'babolat', name: 'Babolat' },
              { slug: 'vibor-a', name: 'Vibor-A' },
              { slug: 'black-crown', name: 'Black Crown' },
              { slug: 'drop-shot', name: 'Drop Shot' },
              { slug: 'wilson', name: 'Wilson' },
              { slug: 'dunlop', name: 'Dunlop' },
              { slug: 'varlion', name: 'Varlion' },
              { slug: 'enebe', name: 'Enebe' },
              { slug: 'joma', name: 'Joma' },
            ].filter(m => m.slug !== params.marca).map(m => (
              <Link
                key={m.slug}
                href={`/marcas/${m.slug}`}
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: 12, letterSpacing: 1,
                  padding: '6px 14px',
                  border: '1px solid var(--border)',
                  color: 'var(--muted)',
                  textDecoration: 'none',
                  borderRadius: 4,
                  transition: 'border-color 0.2s, color 0.2s',
                }}
              >
                {m.name}
              </Link>
            ))}
          </div>
        </section>

        {/* CTA volver */}
        <div style={{ marginTop: 36, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
          <Link href="/palas" style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 12, color: 'var(--muted)', letterSpacing: 1, textDecoration: 'none',
          }}>
            ← Ver catálogo completo
          </Link>
        </div>
      </main>
    </div>
  )
}
