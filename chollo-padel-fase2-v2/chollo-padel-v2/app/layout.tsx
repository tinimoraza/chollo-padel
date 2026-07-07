import type { Metadata } from 'next'
import './globals.css'
import AnalyticsWrapper from '@/components/AnalyticsWrapper'
import CookieBanner from '@/components/CookieBanner'

export const metadata: Metadata = {
  title: {
    default: 'HuntPadel - Encuentra tu pala al mejor precio',
    template: '%s | HuntPadel',
  },
  description: 'Buscador de palas de padel. Rastreamos tiendas en tiempo real para que no te pierdas ningun chollo.',
  keywords: 'palas padel, chollos padel, ofertas palas padel, buscador padel, bullpadel, adidas padel, nox padel',
  authors: [{ name: 'HuntPadel' }],
  creator: 'HuntPadel',
  metadataBase: new URL('https://huntpadel.com'),
  openGraph: {
    title: 'HuntPadel - Encuentra tu pala al mejor precio',
    description: 'Buscador de palas de padel. Rastreamos tiendas en tiempo real.',
    url: 'https://huntpadel.com',
    siteName: 'HuntPadel',
    type: 'website',
    locale: 'es_ES',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'HuntPadel - Buscador de palas de padel' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'HuntPadel - Encuentra tu pala al mejor precio',
    description: 'Chollos de palas de padel en tiendas en tiempo real.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  alternates: { canonical: 'https://huntpadel.com' },
  verification: { google: 'O-258An4ZFV489QVlNgDGwIHjeU7fFeSMHH7jYc70iM' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-black text-white antialiased">
        {children}
        <AnalyticsWrapper />
        <CookieBanner />
      </body>
    </html>
  )
}
