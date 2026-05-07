'use client'

import { useState } from 'react'
import { WallapopItem } from '@/lib/wallapop'

const CONDITIONS = [
  { label: 'SIN ABRIR',   value: 'un_opened' },
  { label: 'EN CAJA',     value: 'in_box' },
  { label: 'NUEVO',       value: 'new' },
  { label: 'COMO NUEVO',  value: 'as_good_as_new' },
  { label: 'BUEN ESTADO', value: 'good' },
  { label: 'ACEPTABLE',   value: 'fair' },
  { label: 'DADO TODO',   value: 'has_given_it_all' },
]

export default function SearchPanel() {
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

  function Card({ item }: { item: WallapopItem }) {
    const isChollo = item.price > 0 && item.price < 80

    return (
      
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block border rounded-xl overflow-hidden hover:shadow-lg transition-shadow bg-white"
      >
        <div className="relative">
          {item.img && (
            <img
              src={item.img}
              alt={item.title}
              className="w-full h-48 object-cover"
            />
          )}
          {isChollo && (
            <span className="absolute top-2 left-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
              🔥 CHOLLO
            </span>
          )}
        </div>
        <div className="p-3">
          <p className="font-semibold text-sm line-clamp-2 text-gray-800">{item.title}</p>
          <p className="text-lg font-bold text-green-600 mt-1">{item.price} €</p>
          <div className="flex items-center justify-between mt-1 text-xs text-gray-500">
            <span>{item.city}</span>
            {item.date && <span>{formatDate(item.date)}</span>}
          </div>
          {item.condition && (
            <span className="inline-block mt-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {item.condition}
            </span>
          )}
        </div>
      </a>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Buscador */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
          placeholder="Buscar pala, marca, modelo..."
          className="flex-1 border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <input
          type="number"
          value={minPrice}
          onChange={e => setMinPrice(e.target.value)}
          placeholder="Mín €"
          className="w-24 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <input
          type="number"
          value={maxPrice}
          onChange={e => setMaxPrice(e.target.value)}
          placeholder="Máx €"
          className="w-24 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button
          onClick={doSearch}
          disabled={loading}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Buscando...' : 'Buscar'}
        </button>
      </div>

      {/* Filtros de estado */}
      <div className="flex flex-wrap gap-2 mb-6">
        {CONDITIONS.map(c => (
          <button
            key={c.value}
            onClick={() => toggleCondition(c.value)}
            className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
              selectedConditions.includes(c.value)
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <p className="text-red-500 text-sm mb-4">{error}</p>
      )}

      {/* Resultados */}
      {results.length > 0 && (
        <p className="text-sm text-gray-500 mb-4">
          {results.length} resultado{results.length !== 1 ? 's' : ''}
          {selectedConditions.length > 0 && ' (filtrados por estado)'}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {results.map(item => (
          <Card key={item.id} item={item} />
        ))}
      </div>

      {!loading && results.length === 0 && query && (
        <p className="text-center text-gray-400 mt-12">Sin resultados para "{query}"</p>
      )}
    </div>
  )
}
