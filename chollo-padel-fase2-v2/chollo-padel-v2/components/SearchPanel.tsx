'use client'

import { useState } from 'react'
import { WallapopItem } from '@/lib/wallapop'

const CONDITIONS = [
  { label: 'SIN ABRIR', value: 'un_opened' },
  { label: 'NUEVO', value: 'new' },
  { label: 'COMO NUEVO', value: 'as_good_as_new' },
  { label: 'BUEN ESTADO', value: 'good' },
  { label: 'ACEPTABLE', value: 'fair' },
  { label: 'DADO TODO', value: 'has_given_it_all' },
]

const CONDITION_LABEL: Record<string, string> = {
  un_opened: 'SIN ABRIR',
  new: 'NUEVO',
  as_good_as_new: 'COMO NUEVO',
  good: 'BUEN ESTADO',
  fair: 'ACEPTABLE',
  has_given_it_all: 'DADO TODO',
}

function formatDate(dateStr: string) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}

function prettyCondition(value?: string) {
  if (!value) return ''
  return CONDITION_LABEL[value] ?? value
}

function Card({ item }: { item: WallapopItem }) {
  const isChollo = item.price > 0 && item.price < 80

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 hover:border-lime-400/60 hover:shadow-[0_0_0_1px_rgba(163,230,53,0.20)] transition"
    >
      <div className="relative">
        {item.img ? (
          <img
            src={item.img}
            alt={item.title}
            className="h-44 w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="h-44 w-full bg-zinc-900" />
        )}

        {isChollo && (
          <span className="absolute left-2 top-2 rounded bg-orange-500 px-2 py-1 text-[10px] font-extrabold tracking-wide text-black">
            CHOLLO
          </span>
        )}

        <span className="absolute left-2 bottom-2 rounded bg-zinc-900/80 px-2 py-1 text-[10px] font-semibold tracking-wide text-lime-300 border border-zinc-700">
          WALLAPOP
        </span>
      </div>

      <div className="p-3">
        <p className="line-clamp-2 text-sm font-semibold text-zinc-100">
          {item.title}
        </p>

        <div className="mt-2 flex items-end justify-between">
          <p className="text-xl font-extrabold text-lime-400">
            {item.price}€
          </p>
          <div className="text-right text-[11px] text-zinc-400">
            <div>{item.city || item.location}</div>
            {item.date && <div>{formatDate(item.date)}</div>}
          </div>
        </div>

        {item.condition && (
          <span className="mt-2 inline-flex rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] font-semibold text-zinc-200">
            {prettyCondition(item.condition)}
          </span>
        )}
      </div>
    </a>
  )
}

interface SearchPanelProps {
  onOpenModal?: (query?: string) => void
}

export default function SearchPanel({ onOpenModal }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [selectedConditions, setSelectedConditions] = useState<string[]>([])
  const [results, setResults] = useState<WallapopItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function toggleCondition(value: string) {
    setSelectedConditions(prev =>
      prev.includes(value) ? prev.filter(c => c !== value) : [...prev, value]
    )
  }

  async function doSearch() {
    if (!query.trim()) return
    setLoading(true)
    setError('')
    setResults([])

    try {
      const params = new URLSearchParams({ q: query.trim() })
      if (maxPrice) params.set('max_price', maxPrice)
      if (minPrice) params.set('min_price', minPrice)
      if (selectedConditions.length > 0) {
        params.set('conditions', selectedConditions.join(','))
      }

      const res = await fetch(`/api/search?${params.toString()}`)
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data: WallapopItem[] = await res.json()
      setResults(data)
    } catch (err) {
      setError('Error al buscar. Inténtalo de nuevo.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Buscador */}
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="Buscar pala, marca, modelo..."
            className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-lime-400"
          />

          <input
            type="number"
            value={minPrice}
            onChange={e => setMinPrice(e.target.value)}
            placeholder="Mín €"
            className="w-28 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-lime-400"
          />

          <input
            type="number"
            value={maxPrice}
            onChange={e => setMaxPrice(e.target.value)}
            placeholder="Máx €"
            className="w-28 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-lime-400"
          />

          <button
            onClick={doSearch}
            disabled={loading}
            className="rounded-lg bg-lime-400 px-6 py-2 text-sm font-extrabold tracking-wide text-black hover:bg-lime-300 disabled:opacity-50"
          >
            {loading ? 'BUSCANDO…' : 'BUSCAR →'}
          </button>
        </div>

        {/* Filtros de estado */}
        <div className="mb-6 flex flex-wrap gap-2">
          {CONDITIONS.map(c => {
            const active = selectedConditions.includes(c.value)
            return (
              <button
                key={c.value}
                onClick={() => toggleCondition(c.value)}
                className={[
                  'rounded border px-3 py-1 text-[11px] font-extrabold tracking-wide transition',
                  active
                    ? 'border-lime-400 bg-lime-400 text-black'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-200 hover:border-lime-400/60',
                ].join(' ')}
              >
                {c.label}
              </button>
            )
          })}
        </div>

        {/* Error */}
        {error && (
          <p className="mb-4 text-sm font-semibold text-red-400">
            {error}
          </p>
        )}

        {/* Resultados */}
        {results.length > 0 && (
          <p className="mb-4 text-sm text-zinc-400">
            {results.length} resultado{results.length !== 1 ? 's' : ''}
            {selectedConditions.length > 0 && ' (filtrados por estado)'}
          </p>
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
          {results.map(item => (
            <Card key={item.id} item={item} />
          ))}
        </div>

        {!loading && results.length === 0 && query && (
          <p className="mt-12 text-center text-zinc-500">
            Sin resultados para "{query}"
          </p>
        )}
      </div>
    </div>
  )
}
