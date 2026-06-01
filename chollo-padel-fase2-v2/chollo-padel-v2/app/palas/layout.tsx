import type { Metadata } from 'next'

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  '@id': 'https://huntpadel.com/palas',
  url: 'https://huntpadel.com/palas',
  name: 'Catálogo de palas de pádel — Precios y comparativa | HuntPadel',
  description: 'Catálogo completo de palas de pádel con precio de referencia de tienda. Compara modelos de Bullpadel, Adidas, Nox, Head, Babolat, Siux y más de 29 marcas.',
  inLanguage: 'es',
  isPartOf: { '@type': 'WebSite', '@id': 'https://huntpadel.com/#website' },
  breadcrumb: {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'HuntPadel', item: 'https://huntpadel.com' },
      { '@type': 'ListItem', position: 2, name: 'Catálogo de palas', item: 'https://huntpadel.com/palas' },
    ],
  },
}

export const metadata: Metadata = {
  title: 'Catálogo de palas de pádel — Precios y comparativa | HuntPadel',
  description: 'Catálogo completo de palas de pádel con precio de referencia de tienda. Compara modelos de Bullpadel, Adidas, Nox, Head, Babolat, Siux y más de 29 marcas.',
  keywords: 'catálogo palas pádel, comparar palas pádel, precio palas pádel, bullpadel precio, adidas metalbone precio, nox at10 precio',
  openGraph: {
    title: 'Catálogo de palas de pádel — HuntPadel',
    description: 'Compara precios de más de 200 modelos de palas de pádel.',
    url: 'https://huntpadel.com/palas',
    siteName: 'HuntPadel',
    type: 'website',
    images: [{ url: 'https://huntpadel.com/opengraph-image', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Catálogo de palas de pádel — HuntPadel',
    description: 'Compara precios de más de 200 modelos.',
    images: ['https://huntpadel.com/opengraph-image'],
  },
  alternates: { canonical: 'https://huntpadel.com/palas' },
}

export default function PalasLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {children}
    </>
  )
}
