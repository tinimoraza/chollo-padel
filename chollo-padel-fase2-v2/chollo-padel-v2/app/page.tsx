import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'HuntPadel — Encuentra tu pala al mejor precio',
  description: 'Buscador de palas de pádel de segunda mano. Rastreamos Wallapop y Vinted en tiempo real para que no te pierdas ningún chollo.',
  alternates: { canonical: 'https://huntpadel.com' },
}

const schemaOrg = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': 'https://huntpadel.com/#website',
      url: 'https://huntpadel.com',
      name: 'HuntPadel',
      description: 'Buscador de palas de pádel de segunda mano en Wallapop y Vinted',
      inLanguage: 'es',
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: 'https://huntpadel.com/buscar?q={search_term_string}' },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'Organization',
      '@id': 'https://huntpadel.com/#organization',
      name: 'HuntPadel',
      url: 'https://huntpadel.com',
      description: 'Plataforma de búsqueda de palas de pádel de segunda mano',
    },
  ],
}

const MARCAS = [
  'Bullpadel', 'Adidas', 'Nox', 'Head', 'Babolat',
  'Wilson', 'Siux', 'StarVie', 'Vibora', 'Joma',
]

const HOW_IT_WORKS = [
  {
    icon: '🔍',
    title: 'Buscas',
    desc: 'Escribe el modelo que quieres. Nosotros miramos Wallapop y Vinted a la vez.',
  },
  {
    icon: '🎯',
    title: 'Filtramos',
    desc: 'Solo palas reales, con precio de referencia de tienda para saber si es un chollo de verdad.',
  },
  {
    icon: '🔔',
    title: 'Te avisamos',
    desc: 'Crea una alerta y te mandamos un email en cuanto aparezca algo interesante.',
  },
]

export default function LandingPage() {
  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', color: 'var(--text)', fontFamily: "-apple-system, 'Helvetica Neue', Arial, sans-serif" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaOrg) }}
      />

      {/* ── NAV ── */}
      <nav style={{ background: 'var(--bg2)', borderBottom: '0.5px solid var(--border)', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 26, height: 26, background: 'var(--accent)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, color: '#000' }}>H</div>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Hunt<span style={{ color: 'var(--accent-fg)' }}>Padel</span></span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link href="/buscar" style={{ padding: '6px 14px', borderRadius: 7, fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>
            Buscador
          </Link>
          <Link href="/top" style={{ padding: '6px 14px', borderRadius: 7, fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>
            🏆 Top
          </Link>
          <Link href="/chollos" style={{ padding: '6px 14px', borderRadius: 7, fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>
            🔥 Chollos
          </Link>
          <Link href="/buscar" style={{ background: 'var(--accent)', color: '#000', padding: '7px 16px', borderRadius: 7, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
            Empezar →
          </Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{ textAlign: 'center', padding: '80px 24px 60px', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'inline-block', background: 'var(--accent)', color: '#000', fontSize: 12, fontWeight: 700, padding: '5px 14px', borderRadius: 20, marginBottom: 24, letterSpacing: '0.04em' }}>
          BETA — Wallapop + Vinted
        </div>
        <h1 style={{ fontSize: 'clamp(36px, 6vw, 64px)', fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.03em', marginBottom: 20 }}>
          Un chollo de pádel<br />
          <span style={{ color: 'var(--accent-fg)' }}>no espera.</span>
        </h1>
        <p style={{ fontSize: 'clamp(16px, 2vw, 20px)', color: 'var(--muted)', lineHeight: 1.6, maxWidth: 520, margin: '0 auto 36px' }}>
          Rastreamos Wallapop y Vinted en tiempo real. Tú buscas, nosotros te avisamos cuando aparece lo que buscas al precio que quieres.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/buscar" style={{ background: 'var(--accent)', color: '#000', padding: '14px 28px', borderRadius: 10, fontSize: 15, fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>
            Buscar palas →
          </Link>
          <Link href="/top" style={{ background: 'var(--bg3)', color: 'var(--text)', padding: '14px 28px', borderRadius: 10, fontSize: 15, fontWeight: 500, textDecoration: 'none', border: '1px solid var(--border)', display: 'inline-block' }}>
            Ver Top oportunidades
          </Link>
        </div>
      </section>

      {/* ── STATS ── */}
      <section style={{ borderTop: '0.5px solid var(--border)', borderBottom: '0.5px solid var(--border)', background: 'var(--bg2)', padding: '28px 24px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center' }}>
          {[
            { value: '+18.000', label: 'anuncios rastreados' },
            { value: '2', label: 'plataformas en tiempo real' },
            { value: '+29', label: 'marcas cubiertas' },
          ].map(s => (
            <div key={s.label} style={{ padding: '16px 8px' }}>
              <div style={{ fontSize: 'clamp(24px, 4vw, 36px)', fontWeight: 700, color: 'var(--accent-fg)', letterSpacing: '-0.02em' }}>{s.value}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CÓMO FUNCIONA ── */}
      <section style={{ padding: '64px 24px', maxWidth: 800, margin: '0 auto' }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 40, textAlign: 'center' }}>Así funciona</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
          {HOW_IT_WORKS.map((step, i) => (
            <div key={i} style={{ background: 'var(--bg2)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '24px 20px' }}>
              <div style={{ fontSize: 32, marginBottom: 14 }}>{step.icon}</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{step.title}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>{step.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── MARCAS ── */}
      <section style={{ padding: '0 24px 64px', textAlign: 'center' }}>
        <p style={{ fontSize: 12, color: 'var(--faint)', letterSpacing: '0.08em', marginBottom: 16, textTransform: 'uppercase' }}>Marcas disponibles</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 600, margin: '0 auto' }}>
          {MARCAS.map(m => (
            <Link key={m} href={`/buscar?q=${encodeURIComponent(m)}`} style={{ background: 'var(--bg2)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '7px 16px', fontSize: 13, color: 'var(--muted)', textDecoration: 'none', transition: 'all 0.15s' }}>
              {m}
            </Link>
          ))}
          <span style={{ background: 'var(--bg2)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '7px 16px', fontSize: 13, color: 'var(--faint)' }}>
            y más...
          </span>
        </div>
      </section>

      {/* ── CTA FINAL ── */}
      <section style={{ background: 'var(--bg2)', borderTop: '0.5px solid var(--border)', padding: '64px 24px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 'clamp(24px, 4vw, 36px)', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 12 }}>
          ¿A qué esperas?
        </h2>
        <p style={{ fontSize: 16, color: 'var(--muted)', marginBottom: 28 }}>
          El chollo que buscas ya puede estar ahí fuera.
        </p>
        <Link href="/buscar" style={{ background: 'var(--accent)', color: '#000', padding: '14px 32px', borderRadius: 10, fontSize: 15, fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>
          Empezar a buscar →
        </Link>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: '0.5px solid var(--border)', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 13, color: 'var(--faint)' }}>© 2026 HuntPadel</span>
        <div style={{ display: 'flex', gap: 20 }}>
          <Link href="/buscar" style={{ fontSize: 12, color: 'var(--faint)', textDecoration: 'none' }}>Buscador</Link>
          <Link href="/top" style={{ fontSize: 12, color: 'var(--faint)', textDecoration: 'none' }}>Top</Link>
          <Link href="/chollos" style={{ fontSize: 12, color: 'var(--faint)', textDecoration: 'none' }}>Chollos</Link>
          <Link href="/alertas" style={{ fontSize: 12, color: 'var(--faint)', textDecoration: 'none' }}>Alertas</Link>
        </div>
      </footer>
    </div>
  )
}
