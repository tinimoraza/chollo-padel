import type { Metadata } from 'next'

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://huntpadel.com/chollos',
  url: 'https://huntpadel.com/chollos',
  name: 'Chollos de palas de pádel en tiendas — HuntPadel',
  description: 'Palas de pádel con descuento en tiendas físicas y online. Detectamos bajadas de precio en tiempo real comparando con el precio de referencia del mercado.',
  inLanguage: 'es',
  isPartOf: { '@type': 'WebSite', '@id': 'https://huntpadel.com/#website' },
  breadcrumb: {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'HuntPadel', item: 'https://huntpadel.com' },
      { '@type': 'ListItem', position: 2, name: 'Chollos', item: 'https://huntpadel.com/chollos' },
    ],
  },
}

export const metadata: Metadata = {
  title: 'Chollos de palas de pádel en tiendas — HuntPadel',
  description: 'Palas de pádel con descuento en tiendas físicas y online. Detectamos bajadas de precio en tiempo real comparando con el precio de referencia del mercado.',
  keywords: 'chollos pádel tiendas, ofertas palas pádel, descuentos pádel, palas pádel baratas tienda, bullpadel oferta, adidas pádel oferta',
  openGraph: {
    title: 'Chollos de palas de pádel en tiendas — HuntPadel',
    description: 'Bajadas de precio en tiempo real en las mejores tiendas de pádel.',
    url: 'https://huntpadel.com/chollos',
    siteName: 'HuntPadel',
    type: 'website',
    images: [{ url: 'https://huntpadel.com/opengraph-image', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Chollos de palas de pádel — HuntPadel',
    description: 'Bajadas de precio en tiempo real en las mejores tiendas.',
    images: ['https://huntpadel.com/opengraph-image'],
  },
  alternates: { canonical: 'https://huntpadel.com/chollos' },
}

export default function ChollosLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {children}
    </>
  )
}
