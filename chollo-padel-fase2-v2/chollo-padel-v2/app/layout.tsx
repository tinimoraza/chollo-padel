import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'CHOLLO PADEL — Cazador de palas',
  description: 'Encuentra las mejores palas de segunda mano en Wallapop y Vinted',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700&family=Barlow:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
