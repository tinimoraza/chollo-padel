'use client'
import { Analytics } from '@vercel/analytics/next'

export default function AnalyticsWrapper() {
  return (
    <Analytics
      beforeSend={(event) => {
        if (typeof window !== 'undefined' && localStorage.getItem('hp_owner') === '1') {
          return null
        }
        return event
      }}
    />
  )
}
