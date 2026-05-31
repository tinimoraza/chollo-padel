import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Buscador de palas de pádel de segunda mano — HuntPadel',
  description: 'Busca palas de pádel de segunda mano en Wallapop y Vinted al mismo tiempo. Bullpadel, Adidas, Nox, Head, Babolat y más de 29 marcas. Filtra por precio y estado.',
  keywords: 'palas pádel segunda mano, wallapop pádel, vinted pádel, palas baratas pádel, bullpadel segunda mano, adidas pádel segunda mano',
  openGraph: {
    title: 'Buscador de palas de pádel — HuntPadel',
    description: 'Wallapop + Vinted en un solo buscador. Más de 18.000 anuncios de palas de pádel de segunda mano.',
    url: 'https://huntpadel.com/buscar',
    siteName: 'HuntPadel',
    type: 'website',
    images: [{ url: 'https://huntpadel.com/opengraph-image', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Buscador de palas de pádel — HuntPadel',
    description: 'Wallapop + Vinted en un solo buscador.',
    images: ['https://huntpadel.com/opengraph-image'],
  },
  alternates: { canonical: 'https://huntpadel.com/buscar' },
}

export default function BuscarLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
