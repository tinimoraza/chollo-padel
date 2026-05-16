'use client'
import { useState } from 'react'
import SearchPanel from '@/components/SearchPanel'
import Sidebar from '@/components/Sidebar'
import AlertModal from '@/components/AlertModal'

export default function Home() {
  const [modalOpen, setModalOpen] = useState(false)
  const [prefillQuery, setPrefillQuery] = useState('')

  function openModal(query = '') {
    setPrefillQuery(query)
    setModalOpen(true)
  }

  return (
    <>
      <div className="app-shell">
        <header className="header">
         <a className="logo" href="/">
			<img src="/huntpadel-logo.svg" alt="HuntPadel" height={36} />
			</a>
          <nav className="nav">
            <a className="nav-link active" href="/">BUSCADOR</a>
            <a className="nav-link" href="/palas">PALAS</a>
            <a className="nav-link" href="/top" style={{ color: '#FFB800' }}>🏆 TOP</a>
            <a className="nav-link" href="/alertas">MIS ALERTAS</a>
            <a className="nav-link" href="/chollos" style={{ color: '#FF5F1F' }}>🔥 CHOLLOS</a>
          </nav>
          <button className="btn-alert-top" onClick={() => openModal()}>
            + NUEVA ALERTA
          </button>
        </header>
        <div className="layout">
          <Sidebar onOpenModal={openModal} />
          <SearchPanel onOpenModal={openModal} />
        </div>
      </div>
      {modalOpen && (
        <AlertModal
          prefillQuery={prefillQuery}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  )
}
