import Link from 'next/link'

export default function Footer() {
  return (
    <footer style={{
      borderTop: '1px solid var(--border)',
      background: 'var(--bg2)',
      padding: '32px 24px 24px',
      marginTop: '48px',
    }}>
      <div style={{
        maxWidth: 960,
        margin: '0 auto',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '32px',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}>

        {/* Marca */}
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--accent-fg)', marginBottom: 6 }}>
            🏓 HuntPadel
          </div>
          <p style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 240, margin: 0, lineHeight: 1.5 }}>
            Buscador de palas de pádel. Rastreamos tiendas en tiempo real para que no te pierdas ningún chollo.
          </p>
        </div>

        {/* Links */}
        <div style={{ display: 'flex', gap: '40px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              Web
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { href: '/buscar', label: 'Buscador' },
                { href: '/palas', label: 'Palas' },
                { href: '/chollos', label: 'Chollos' },
                { href: '/top', label: 'Top oportunidades' },
              ].map(({ href, label }) => (
                <Link key={href} href={href} style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}
                  className="footer-link">
                  {label}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              Contacto
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <a href="mailto:hola@huntpadel.com" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}
                className="footer-link">
                hola@huntpadel.com
              </a>
              <a href="https://instagram.com/huntpadel" target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}
                className="footer-link">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                  <circle cx="12" cy="12" r="4"/>
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
                </svg>
                @huntpadel
              </a>
              <Link href="/contacto" style={{ fontSize: 13, color: 'var(--accent-fg)', textDecoration: 'none' }}
                className="footer-link">
                Página de contacto →
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div style={{
        maxWidth: 960,
        margin: '24px auto 0',
        paddingTop: 16,
        borderTop: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>
          © {new Date().getFullYear()} HuntPadel
        </span>
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>
          Hecho con 🏓 para los que no quieren pagar de más
        </span>
      </div>
    </footer>
  )
}
