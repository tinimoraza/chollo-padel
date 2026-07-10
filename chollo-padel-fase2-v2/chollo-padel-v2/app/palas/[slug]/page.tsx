import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase-admin'
import Header from '@/components/Header'
import BottomNav from '@/components/BottomNav'
import PalaDetalleDynamic from './PalaDetalleDynamic'

// ISR: revalidar cada 5 minutos
export const revalidate = 300

interface Pala {
  id: string
  slug: string
  nombre: string
  marca: string
  modelo: string
  ano: number
  forma: string
  balance: string
  tacto: string
  juego: string
  genero: string
  peso_min: number
  peso_max: number
  material_cara: string
  material_nucleo: string
  material_marco: string
  rating_potencia: number
  rating_control: number
  rating_rebote: number
  rating_manejabilidad: number
  rating_punto_dulce: number
  precio_pvp: number
  precio_referencia: number
  precio_minimo_tiendas: number
  imagen_url: string
}

async function getOfferCount(palaId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('price_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('pala_id', palaId)
    .eq('disponible', true)
    .neq('source_id', 2)
  return count ?? 1
}

async function getPala(slug: string): Promise<Pala | null> {
  const { data, error } = await supabaseAdmin
    .from('palas')
    .select('id,slug,nombre,marca,modelo,año,forma,balance,tacto,juego,genero,peso_min,peso_max,material_cara,material_nucleo,material_marco,rating_potencia,rating_control,rating_rebote,rating_manejabilidad,rating_punto_dulce,precio_pvp,precio_referencia,precio_minimo_tiendas,imagen_url')
    .eq('slug', slug)
    .maybeSingle()
  if (error) console.error('[palas/slug] getPala error:', error.message)
  return (data as any) ?? null
}

export async function generateStaticParams() {
  const { data } = await supabaseAdmin
    .from('palas')
    .select('slug')
    .not('slug', 'is', null)
    .neq('slug', '')
  return (data ?? []).map((p: { slug: string }) => ({ slug: p.slug }))
}

export async function generateMetadata(
  { params }: { params: { slug: string } }
): Promise<Metadata> {
  const pala = await getPala(params.slug)
  if (!pala) return { title: 'Pala no encontrada | HuntPadel' }

  const precio = Number(pala.precio_referencia) > 0
    ? Number(pala.precio_referencia)
    : Number(pala.precio_pvp)
  const precioStr = precio > 0 ? `${precio.toFixed(0)}€` : null

  const desc = [
    `Compara el precio de la ${pala.nombre} en las mejores tiendas de padel online.`,
    precioStr ? `Precio medio de referencia: ${precioStr}.` : null,
    pala.forma ? `Pala ${pala.forma.toLowerCase()}.` : null,
    pala.balance ? `Balance ${pala.balance.toLowerCase()}.` : null,
    pala.juego ? `Ideal para nivel ${pala.juego.toLowerCase()}.` : null,
  ].filter(Boolean).join(' ')

  return {
    title: `${pala.nombre} · Precio y comparativa | HuntPadel`,
    description: desc,
    openGraph: {
      title: `${pala.nombre} | HuntPadel`,
      description: precioStr ? `Precio medio: ${precioStr} en tiendas` : desc,
      images: pala.imagen_url ? [{ url: pala.imagen_url, alt: pala.nombre }] : [],
      type: 'website',
    },
    alternates: { canonical: `https://huntpadel.com/palas/${pala.slug}` },
  }
}

// Schema.org: Product + BreadcrumbList
function JsonLd({ pala, offerCount }: { pala: Pala; offerCount: number }) {
  const lowPrice = Number(pala.precio_minimo_tiendas) > 0
    ? Number(pala.precio_minimo_tiendas)
    : Number(pala.precio_pvp)
  const highPrice = Number(pala.precio_referencia) > 0
    ? Number(pala.precio_referencia)
    : lowPrice

  const descParts = [
    pala.forma && `Pala ${pala.forma.toLowerCase()}`,
    pala.balance && `balance ${pala.balance.toLowerCase()}`,
    pala.material_nucleo && `nucleo de ${pala.material_nucleo}`,
    pala.juego && `nivel ${pala.juego.toLowerCase()}`,
  ].filter(Boolean)

  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: pala.nombre,
    brand: { '@type': 'Brand', name: pala.marca },
    ...(pala.imagen_url ? { image: pala.imagen_url } : {}),
    ...(descParts.length > 0 ? { description: descParts.join(', ') } : {}),
    ...(lowPrice > 0 ? {
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'EUR',
        lowPrice: lowPrice.toFixed(2),
        highPrice: highPrice.toFixed(2),
        offerCount,
        availability: 'https://schema.org/InStock',
      },
    } : {}),
  }

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'HuntPadel', item: 'https://huntpadel.com' },
      { '@type': 'ListItem', position: 2, name: 'Catalogo de Palas', item: 'https://huntpadel.com/palas' },
      { '@type': 'ListItem', position: 3, name: pala.nombre },
    ],
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(product) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
    </>
  )
}

function StatBar({ label, value }: { label: string; value: number }) {
  const v = Number(value) || 0
  const pct = Math.min(Math.max((v / 10) * 100, 0), 100)
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, letterSpacing: 1, color: 'var(--muted)', fontFamily: "'Space Grotesk', sans-serif", textTransform: 'uppercase' }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--accent-fg)', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>{v.toFixed(1)}/10</span>
      </div>
      <div style={{ height: 3, background: 'rgba(0,0,0,0.07)', borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #C8FF00, #8FCC00)', borderRadius: 2 }} />
      </div>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: "'Space Grotesk', sans-serif",
      fontSize: 11,
      letterSpacing: 1.5,
      textTransform: 'uppercase' as const,
      padding: '3px 10px',
      border: '1px solid var(--border)',
      color: 'var(--muted)',
      borderRadius: 4,
    }}>
      {children}
    </span>
  )
}

function TechRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 13, color: 'var(--muted)', fontFamily: "'Barlow', sans-serif", minWidth: 72 }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text)', fontFamily: "'Barlow', sans-serif", fontWeight: 500 }}>{value}</span>
    </div>
  )
}

export default async function PalaPage({ params }: { params: { slug: string } }) {
  const pala = await getPala(params.slug)
  if (!pala) notFound()
  const offerCount = await getOfferCount(pala.id)

  const precio = Number(pala.precio_referencia) > 0
    ? Number(pala.precio_referencia)
    : Number(pala.precio_pvp)
  const precioLabel = Number(pala.precio_referencia) > 0 ? 'precio medio tiendas' : 'PVP'
  const año = (pala as any)['año'] ?? (pala as any).ano ?? 0
  const tieneRatings =
    pala.rating_potencia > 0 ||
    pala.rating_control > 0 ||
    pala.rating_manejabilidad > 0 ||
    pala.rating_punto_dulce > 0

  return (
    <div className="app-shell">
      <JsonLd pala={pala} offerCount={offerCount} />

      <style>{`
        .pala-hero { display: grid; grid-template-columns: 260px 1fr; gap: 2rem; }
        @media (max-width: 640px) {
          .pala-hero { grid-template-columns: 1fr; }
          .pala-img-box { height: 220px !important; }
        }
      `}</style>

      <Header />
      <BottomNav />

      <main style={{ maxWidth: 920, margin: '0 auto', padding: '2rem 1rem 5rem' }}>

        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 12,
          color: 'var(--muted)',
          letterSpacing: 1,
          marginBottom: 28,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap' as const,
        }}>
          <Link href="/" style={{ color: 'var(--muted)', textDecoration: 'none' }}>HuntPadel</Link>
          <span style={{ opacity: 0.4 }}>›</span>
          <Link href="/palas" style={{ color: 'var(--muted)', textDecoration: 'none' }}>Catalogo</Link>
          <span style={{ opacity: 0.4 }}>›</span>
          <span style={{ color: 'var(--text)' }}>{pala.nombre}</span>
        </nav>

        {/* Hero */}
        <div className="pala-hero" style={{ marginBottom: '2.5rem' }}>

          {/* Imagen */}
          <div
            className="pala-img-box"
            style={{
              background: '#E8E9EC',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2rem',
              minHeight: 280,
              border: '1px solid var(--border)',
            }}
          >
            {pala.imagen_url
              ? (
                <img
                  src={pala.imagen_url}
                  alt={pala.nombre}
                  style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain', mixBlendMode: 'multiply' }}
                />
              )
              : <span style={{ fontSize: 64 }}>&#127955;</span>
            }
          </div>

          {/* Info principal */}
          <div>
            <div style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 11,
              letterSpacing: 3,
              color: 'var(--accent-fg)',
              marginBottom: 6,
              textTransform: 'uppercase' as const,
            }}>
              {pala.marca}
            </div>

            <h1 style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 34,
              letterSpacing: 2,
              marginBottom: 14,
              lineHeight: 1.1,
            }}>
              {pala.nombre}
            </h1>

            {precio > 0 && (
              <div style={{ marginBottom: 20 }}>
                <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 38, color: 'var(--accent-fg)' }}>
                  {precio.toFixed(2)} &#8364;
                </span>
                <span style={{ fontSize: 13, color: 'var(--muted)', fontFamily: "'Barlow', sans-serif", marginLeft: 8 }}>
                  {precioLabel}
                </span>
              </div>
            )}

            {/* Tags */}
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 22 }}>
              {pala.forma && <Tag>{pala.forma}</Tag>}
              {pala.balance && <Tag>{pala.balance}</Tag>}
              {pala.juego && <Tag>{pala.juego}</Tag>}
              {pala.genero && pala.genero !== 'Unisex' && <Tag>{pala.genero}</Tag>}
              {año > 0 && <Tag>{año}</Tag>}
            </div>

            {/* Specs tecnicas */}
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 0, marginBottom: 20 }}>
              {pala.material_nucleo && <TechRow label="Nucleo" value={pala.material_nucleo} />}
              {pala.material_cara && <TechRow label="Cara" value={pala.material_cara} />}
              {pala.material_marco && <TechRow label="Marco" value={pala.material_marco} />}
              {(pala.peso_min || pala.peso_max) && (
                <TechRow
                  label="Peso"
                  value={
                    pala.peso_min && pala.peso_max
                      ? `${pala.peso_min}-${pala.peso_max} g`
                      : `${pala.peso_min || pala.peso_max} g`
                  }
                />
              )}
            </div>

            {/* Ratings */}
            {tieneRatings && (
              <div>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 11, letterSpacing: 2, color: 'var(--muted)', marginBottom: 12, textTransform: 'uppercase' as const }}>
                  Rendimiento
                </div>
                {pala.rating_potencia > 0 && <StatBar label="Potencia" value={pala.rating_potencia} />}
                {pala.rating_control > 0 && <StatBar label="Control" value={pala.rating_control} />}
                {pala.rating_manejabilidad > 0 && <StatBar label="Manejabilidad" value={pala.rating_manejabilidad} />}
                {pala.rating_punto_dulce > 0 && <StatBar label="Punto dulce" value={pala.rating_punto_dulce} />}
                {pala.rating_rebote > 0 && <StatBar label="Rebote" value={pala.rating_rebote} />}
              </div>
            )}
          </div>
        </div>

        {/* Secciones dinámicas (tiendas + historial) — client component */}
        <PalaDetalleDynamic
          palaId={pala.id}
          precioReferencia={Number(pala.precio_referencia) || 0}
        />

        {/* Volver al catalogo */}
        <div style={{ marginTop: 36, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
          <Link href="/palas" style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 12,
            color: 'var(--muted)',
            letterSpacing: 1,
            textDecoration: 'none',
          }}>
            &#8592; Volver al catalogo de palas
          </Link>
        </div>
      </main>
    </div>
  )
}
