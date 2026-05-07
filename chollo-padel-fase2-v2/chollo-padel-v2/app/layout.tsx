import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Chollo Padel',
  description: 'Buscador de chollos de pádel',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
