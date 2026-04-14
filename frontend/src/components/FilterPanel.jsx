import { useState, useEffect } from 'react'
import { api } from '../api'

const CATEGORIES = [
  'Large accelerated filer',
  'Accelerated filer',
  'Non-accelerated filer',
  'Smaller reporting company',
]

export default function FilterPanel({ filters, onChange, options }) {
  const [sicSearch, setSicSearch]         = useState('')
  const [allSicCodes, setAllSicCodes]     = useState([])
  const [sicDropdown, setSicDropdown]     = useState(false)

  useEffect(() => {
    api.getSicCodes()
      .then(d => setAllSicCodes(d.codes || []))
      .catch(() => {})
  }, [])

  function set(key, val) {
    onChange({ ...filters, [key]: val })
  }

  function reset() {
    onChange({ sic: '', state: '', category: '', year_from: '', year_to: '', search: '' })
    setSicSearch('')
  }

  const filteredSic = sicSearch.length > 0
    ? allSicCodes.filter(c =>
        c.code.includes(sicSearch) ||
        c.description.toLowerCase().includes(sicSearch.toLowerCase())
      ).slice(0, 40)
    : []

  const selectedSicLabel = filters.sic
    ? allSicCodes.find(c => c.code === filters.sic)?.description ?? filters.sic
    : ''

  const { year_range = {} } = options
  const minYear = year_range.min ?? 1993
  const maxYear = year_range.max ?? new Date().getFullYear()

  return (
    <div className="p-4 flex flex-col gap-5 text-sm">

      {/* Name search */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide">
          Company Name
        </label>
        <input
          type="text"
          placeholder="Search…"
          value={filters.search}
          onChange={e => set('search', e.target.value)}
          className="w-full rounded border border-slate-300 dark:border-slate-600
                     bg-white dark:bg-slate-800 px-3 py-1.5 outline-none
                     focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400"
        />
      </div>

      {/* SIC code */}
      <div className="relative">
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide">
          Industry (SIC Code)
        </label>
        {filters.sic ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200
                             px-2 py-1 rounded truncate">
              {filters.sic} — {selectedSicLabel}
            </span>
            <button
              onClick={() => { set('sic', ''); setSicSearch('') }}
              className="text-slate-400 hover:text-red-500 text-lg leading-none"
            >×</button>
          </div>
        ) : (
          <div className="relative">
            <input
              type="text"
              placeholder="Type code or industry…"
              value={sicSearch}
              onChange={e => { setSicSearch(e.target.value); setSicDropdown(true) }}
              onFocus={() => setSicDropdown(true)}
              onBlur={() => setTimeout(() => setSicDropdown(false), 150)}
              className="w-full rounded border border-slate-300 dark:border-slate-600
                         bg-white dark:bg-slate-800 px-3 py-1.5 outline-none
                         focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400"
            />
            {sicDropdown && filteredSic.length > 0 && (
              <ul className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto
                             rounded border border-slate-300 dark:border-slate-600
                             bg-white dark:bg-slate-800 shadow-lg text-xs">
                {filteredSic.map(c => (
                  <li
                    key={c.code}
                    onMouseDown={() => { set('sic', c.code); setSicSearch(''); setSicDropdown(false) }}
                    className="px-3 py-2 cursor-pointer hover:bg-blue-500 hover:text-white"
                  >
                    <span className="font-mono font-bold mr-2">{c.code}</span>
                    {c.description}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* State */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide">
          Business State
        </label>
        <select
          value={filters.state}
          onChange={e => set('state', e.target.value)}
          className="w-full rounded border border-slate-300 dark:border-slate-600
                     bg-white dark:bg-slate-800 px-3 py-1.5 outline-none
                     focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All States</option>
          {options.states?.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Company size / filer category */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide">
          Company Size
        </label>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">
          Based on SEC filer category (proxy for market cap)
        </p>
        <select
          value={filters.category}
          onChange={e => set('category', e.target.value)}
          className="w-full rounded border border-slate-300 dark:border-slate-600
                     bg-white dark:bg-slate-800 px-3 py-1.5 outline-none
                     focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Sizes</option>
          {(options.categories?.length ? options.categories : CATEGORIES).map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <div className="mt-1 text-xs text-slate-400 dark:text-slate-500 space-y-0.5">
          <div>Large accelerated → market cap ≥ $700M</div>
          <div>Accelerated → $75M – $700M</div>
          <div>Smaller reporting → &lt; $250M / revenue &lt; $100M</div>
        </div>
      </div>

      {/* Year range */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide">
          First Filing Year
        </label>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">
          Approximate age — year of earliest SEC filing on record
        </p>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            placeholder={String(minYear)}
            min={minYear}
            max={maxYear}
            value={filters.year_from}
            onChange={e => set('year_from', e.target.value)}
            className="w-full rounded border border-slate-300 dark:border-slate-600
                       bg-white dark:bg-slate-800 px-2 py-1.5 outline-none
                       focus:ring-2 focus:ring-blue-500 text-center"
          />
          <span className="text-slate-400">–</span>
          <input
            type="number"
            placeholder={String(maxYear)}
            min={minYear}
            max={maxYear}
            value={filters.year_to}
            onChange={e => set('year_to', e.target.value)}
            className="w-full rounded border border-slate-300 dark:border-slate-600
                       bg-white dark:bg-slate-800 px-2 py-1.5 outline-none
                       focus:ring-2 focus:ring-blue-500 text-center"
          />
        </div>
      </div>

      {/* Reset */}
      <button
        onClick={reset}
        className="mt-2 w-full py-2 rounded border border-slate-300 dark:border-slate-600
                   text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800
                   transition-colors text-xs font-semibold uppercase tracking-wide"
      >
        Reset Filters
      </button>
    </div>
  )
}
