'use client'
import { Analytics } from '@vercel/analytics/next'
import { useEffect } from 'react'

export default function AnalyticsWrapper() {
  useEffect(() => {
    // Si hp_owner está activo, bloqueamos el script de analytics directamente
    if (localStorage.getItem('hp_owner') === '1') {
      (window as any).__va_disable = true
    }
  }, [])

  return <Analytics />
}
