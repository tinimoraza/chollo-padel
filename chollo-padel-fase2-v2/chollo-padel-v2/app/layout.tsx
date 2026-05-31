import type { Metadata } from 'next'
import './globals.css'
import { Analytics } from '@vercel/analytics/next'

export const metadata: Metadata = {
  title: {
    default: 'HuntPadel — Encuentra tu pala al mejor precio',
    template: '%s | HuntPadel',
  },
  description: 'Buscador de palas de pádel de segunda mano. Rastreamos Wallapop y Vinted en tiempo real para que no te pierdas ningún chollo.',
  keywords: 'palas pádel segunda mano, chollos pádel, wallapop pádel, vinted pádel, buscador pádel, bullpadel, adidas padel, nox padel',
  authors: [{ name: 'HuntPadel' }],
  creator: 'HuntPadel',
  metadataBase: new URL('https://huntpadel.com'),
  openGraph: {
    title: 'HuntPadel — Encuentra tu pala al mejor precio',
    description: 'Buscador de palas de pádel de segunda mano en Wallapop y Vinted. Más de 18.000 anuncios rastreados en tiempo real.',
    url: 'https://huntpadel.com',
    siteName: 'HuntPadel',
    type: 'website',
    locale: 'es_ES',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'HuntPadel — Buscador de palas de pádel' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'HuntPadel — Encuentra tu pala al mejor precio',
    description: 'Wallapop + Vinted en un solo buscador. No te pierdas ningún chollo.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  alternates: { canonical: 'https://huntpadel.com' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-black text-white antialiased">
        {children}
        <Analytics
          beforeSend={(event) => {
            if (typeof window !== 'undefined' && localStorage.getItem('hp_owner') === '1') {
              return null
            }
            return event
          }}
        />
      </body>
    </html>
  )
}
