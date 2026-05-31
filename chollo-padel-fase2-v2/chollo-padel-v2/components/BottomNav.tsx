'use client'
import { usePathname } from 'next/navigation'

export default function BottomNav() {
  const pathname = usePathname()
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <nav className="bottom-nav">
      <a href="/" className={`bottom-nav-item ${isActive('/') ? 'active' : ''}`}>
        <span className="bottom-nav-icon">🔍</span>
        <span className="bottom-nav-label">Buscar</span>
      </a>
      <a href="/palas" className={`bottom-nav-item ${isActive('/palas') ? 'active' : ''}`}>
        <span className="bottom-nav-icon">🏓</span>
        <span className="bottom-nav-label">Palas</span>
      </a>
      <a href="/top" className={`bottom-nav-item nav-top ${isActive('/top') ? 'active' : ''}`}>
        <span className="bottom-nav-icon">🏆</span>
        <span className="bottom-nav-label">Top</span>
      </a>
      <a href="/chollos" className={`bottom-nav-item nav-chollos ${isActive('/chollos') ? 'active' : ''}`}>
        <span className="bottom-nav-icon">🔥</span>
        <span className="bottom-nav-label">Chollos</span>
      </a>
      <a href="/alertas" className={`bottom-nav-item ${isActive('/alertas') ? 'active' : ''}`}>
        <span className="bottom-nav-icon">🔔</span>
        <span className="bottom-nav-label">Alertas</span>
      </a>
    </nav>
  )
}
