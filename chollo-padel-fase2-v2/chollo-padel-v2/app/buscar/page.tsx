'use client'
import { useState } from 'react'
import Header from '@/components/Header'
import BottomNav from '@/components/BottomNav'
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
      <Header onNewAlert={() => openModal()} />
      <div className="hp-layout">
        <Sidebar onOpenModal={openModal} />
        <SearchPanel onOpenModal={openModal} />
      </div>
      <BottomNav />
      {modalOpen && (
        <AlertModal
          prefillQuery={prefillQuery}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  )
}
