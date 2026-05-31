import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Top oportunidades de pádel — Las mejores palas de segunda mano | HuntPadel',
  description: 'Las 10 mejores palas de pádel de segunda mano ahora mismo. Ranking actualizado cada hora con los mayores descuentos respecto al precio de tienda.',
  keywords: 'mejores chollos pádel, palas pádel oferta, descuentos pádel segunda mano, palas baratas wallapop vinted',
  openGraph: {
    title: 'Top oportunidades de pádel — HuntPadel',
    description: 'El ranking de las mejores palas de segunda mano. Actualizado cada hora.',
    url: 'https://huntpadel.com/top',
    siteName: 'HuntPadel',
    type: 'website',
    images: [{ url: 'https://huntpadel.com/og-image.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Top oportunidades de pádel — HuntPadel',
    description: 'El ranking de las mejores palas de segunda mano. Actualizado cada hora.',
    images: ['https://huntpadel.com/og-image.png'],
  },
  alternates: { canonical: 'https://huntpadel.com/top' },
}

export default function TopLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
