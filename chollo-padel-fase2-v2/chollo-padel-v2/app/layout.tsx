import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'HuntPadel',
  description: 'Cazador de chollos de pádel',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body className="bg-black text-white antialiased">{children}</body>
    </html>
  )
}
