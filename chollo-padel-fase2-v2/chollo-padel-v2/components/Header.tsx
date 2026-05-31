'use client'
import { useState } from 'react'
import { usePathname } from 'next/navigation'

interface HeaderProps {
  onNewAlert?: () => void
}

export default function Header({ onNewAlert }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <>
      <header className="hp-header">
        <a href="/" className="hp-logo">
          <div className="hp-logo-badge">H</div>
          <span className="hp-logo-name">Hunt<span>Padel</span></span>
        </a>

        <nav className="hp-nav">
          <a href="/" className={`hp-nav-link ${isActive('/') ? 'active' : ''}`}>Buscador</a>
          <a href="/palas" className={`hp-nav-link ${isActive('/palas') ? 'active' : ''}`}>Palas</a>
          <a href="/top" className={`hp-nav-link nav-top ${isActive('/top') ? 'active' : ''}`}>🏆 Top</a>
          <a href="/alertas" className={`hp-nav-link ${isActive('/alertas') ? 'active' : ''}`}>Alertas</a>
          <a href="/chollos" className={`hp-nav-link nav-chollos ${isActive('/chollos') ? 'active' : ''}`}>🔥 Chollos</a>
        </nav>

        <div className="hp-header-actions">
          {onNewAlert && (
            <button className="btn-primary" onClick={onNewAlert}>
              + Alerta
            </button>
          )}
          <button
            className="hp-hamburger"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menú"
          >
            <span /><span /><span />
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      <div className={`hp-mobile-menu ${menuOpen ? 'open' : ''}`}>
        <div className="hp-mobile-overlay" onClick={() => setMenuOpen(false)} />
        <div className="hp-mobile-drawer">
          <div className="hp-mobile-drawer-header">
            <div className="hp-logo">
              <div className="hp-logo-badge">H</div>
              <span className="hp-logo-name">Hunt<span>Padel</span></span>
            </div>
            <button className="hp-drawer-close" onClick={() => setMenuOpen(false)}>✕</button>
          </div>

          <a href="/" className={isActive('/') ? 'active' : ''} onClick={() => setMenuOpen(false)}>
            <span>🔍</span> Buscador
          </a>
          <a href="/palas" className={isActive('/palas') ? 'active' : ''} onClick={() => setMenuOpen(false)}>
            <span>🏓</span> Palas
          </a>
          <a href="/top" className={`nav-top ${isActive('/top') ? 'active' : ''}`} onClick={() => setMenuOpen(false)}>
            <span>🏆</span> Top oportunidades
          </a>
          <a href="/alertas" className={isActive('/alertas') ? 'active' : ''} onClick={() => setMenuOpen(false)}>
            <span>🔔</span> Mis alertas
          </a>
          <a href="/chollos" className={`nav-chollos ${isActive('/chollos') ? 'active' : ''}`} onClick={() => setMenuOpen(false)}>
            <span>🔥</span> Chollos tiendas
          </a>

          {onNewAlert && (
            <div className="drawer-cta">
              <button
                className="btn-primary"
                style={{ width: '100%' }}
                onClick={() => { setMenuOpen(false); onNewAlert(); }}
              >
                + Nueva alerta
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
