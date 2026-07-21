import type { Metadata } from 'next'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Contacto — HuntPadel',
  description: 'Contacta con HuntPadel para sugerencias, errores o colaboraciones.',
  alternates: { canonical: 'https://huntpadel.com/contacto' },
  robots: { index: true, follow: true },
}

export default function ContactoPage() {
  return (
    <>
      <Header />
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px' }}>

        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
          Contacto
        </h1>
        <p style={{ fontSize: 15, color: 'var(--muted)', marginBottom: 40, lineHeight: 1.6 }}>
          ¿Tienes alguna sugerencia, encontraste un error o quieres que incluyamos una tienda? Escríbenos.
        </p>

        {/* Email */}
        <div style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '24px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: 'var(--accent-dim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, flexShrink: 0,
          }}>
            ✉️
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
              Email
            </div>
            <a href="mailto:hola@huntpadel.com" style={{
              fontSize: 15, color: 'var(--accent-fg)', textDecoration: 'none', fontWeight: 500,
            }}>
              hola@huntpadel.com
            </a>
          </div>
        </div>

        {/* Instagram */}
        <div style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '24px',
          marginBottom: 40,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: 'rgba(225,48,108,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, flexShrink: 0,
          }}>
            📸
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
              Instagram
            </div>
            <a href="https://instagram.com/huntpadel" target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 15, color: 'var(--accent-fg)', textDecoration: 'none', fontWeight: 500 }}>
              @huntpadel
            </a>
          </div>
        </div>

        {/* Usos frecuentes */}
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>
          ¿Para qué nos puedes escribir?
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { icon: '🏪', texto: 'Sugerir una tienda que no estamos rastreando' },
            { icon: '🐛', texto: 'Reportar un precio incorrecto o un error en la web' },
            { icon: '🏓', texto: 'Avisar de una pala que no aparece en el catálogo' },
            { icon: '🤝', texto: 'Colaboraciones o cualquier otra consulta' },
          ].map(({ icon, texto }) => (
            <div key={texto} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              fontSize: 14, color: 'var(--muted)',
            }}>
              <span style={{ fontSize: 18 }}>{icon}</span>
              {texto}
            </div>
          ))}
        </div>
      </main>
      <Footer />
    </>
  )
}
