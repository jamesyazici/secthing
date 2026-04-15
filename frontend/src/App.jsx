import { useState, useEffect, useMemo } from 'react'
import FilterPanel from './components/FilterPanel'
import CompanyTable from './components/CompanyTable'
import CompanyDetail from './components/CompanyDetail'
import DataInfo from './components/DataInfo'

const PAGE_SIZE = 50

const DEFAULT_FILTERS = {
  sic: '', state: '', category: '',
  year_from: '', year_to: '', search: '',
}

export default function App() {
  const [dark, setDark] = useState(
    () => document.documentElement.classList.contains('dark')
  )

  // ── data loading ───────────────────────────────────────────────────────────
  const [allCompanies, setAllCompanies] = useState([])
  const [dataInfo, setDataInfo]         = useState(null)
  const [loadError, setLoadError]       = useState(null)
  const [dataLoading, setDataLoading]   = useState(true)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}companies.json`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => {
        setAllCompanies(data.companies ?? [])
        setDataInfo({ generated_at: data.generated_at, count: data.count ?? 0 })
      })
      .catch(e => setLoadError(e.message))
      .finally(() => setDataLoading(false))
  }, [])

  // ── filter / sort / page state ─────────────────────────────────────────────
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [sort, setSort]       = useState({ by: 'name', dir: 'asc' })
  const [page, setPage]       = useState(1)
  const [selected, setSelected] = useState(null)

  // ── derived filter options (computed once from data) ───────────────────────
  const filterOptions = useMemo(() => {
    if (!allCompanies.length) return {
      states: [], categories: [], sics: [], year_range: {}, total_companies: 0
    }
    const states     = [...new Set(allCompanies.map(c => c.business_state).filter(Boolean))].sort()
    const categories = [...new Set(allCompanies.map(c => c.category).filter(Boolean))].sort()
    const sicMap     = {}
    allCompanies.forEach(c => { if (c.sic) sicMap[c.sic] = c.sic_description ?? '' })
    const sics = Object.entries(sicMap)
      .map(([code, description]) => ({ code, description }))
      .sort((a, b) => a.code.localeCompare(b.code))
    const years = allCompanies.map(c => c.first_filing_year).filter(Boolean)
    return {
      states, categories, sics,
      year_range: { min: Math.min(...years), max: Math.max(...years) },
      total_companies: allCompanies.length,
    }
  }, [allCompanies])

  // ── filtered companies ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let r = allCompanies
    if (filters.sic)       r = r.filter(c => c.sic === filters.sic)
    if (filters.state)     r = r.filter(c => c.business_state === filters.state)
    if (filters.category)  r = r.filter(c => c.category === filters.category)
    if (filters.year_from) r = r.filter(c => c.first_filing_year >= +filters.year_from)
    if (filters.year_to)   r = r.filter(c => c.first_filing_year <= +filters.year_to)
    if (filters.search)    r = r.filter(c => c.name.toLowerCase().includes(filters.search.toLowerCase()))
    return r
  }, [allCompanies, filters])

  // ── sorted companies ───────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    const key = sort.by
    return [...filtered].sort((a, b) => {
      const va = a[key] ?? ''
      const vb = b[key] ?? ''
      const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true })
      return sort.dir === 'desc' ? -cmp : cmp
    })
  }, [filtered, sort])

  // ── paginated slice ────────────────────────────────────────────────────────
  const paginated = useMemo(
    () => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sorted, page]
  )

  function handleFilter(next) { setFilters(next); setPage(1) }
  function handleSort(col) {
    setSort(prev => ({ by: col, dir: prev.by === col && prev.dir === 'asc' ? 'desc' : 'asc' }))
    setPage(1)
  }

  // ── theme ──────────────────────────────────────────────────────────────────
  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col">

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b
                         border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900
                         z-10 sticky top-0">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold tracking-tight">SEC Explorer</span>
          {filterOptions.total_companies > 0 && (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {filterOptions.total_companies.toLocaleString()} companies indexed
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <DataInfo dataInfo={dataInfo} loading={dataLoading} error={loadError} />
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200
                       hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Toggle theme"
          >
            {dark ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 shrink-0 border-r border-slate-200 dark:border-slate-700
                          overflow-y-auto bg-slate-50 dark:bg-slate-900">
          <FilterPanel filters={filters} onChange={handleFilter} options={filterOptions} />
        </aside>

        <main className="flex-1 overflow-hidden flex flex-col">
          {loadError ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
              <span className="text-4xl">⚠️</span>
              <p className="text-sm">Could not load company data: {loadError}</p>
            </div>
          ) : (
            <CompanyTable
              companies={paginated}
              total={filtered.length}
              page={page}
              pageSize={PAGE_SIZE}
              loading={dataLoading}
              sort={sort}
              onSort={handleSort}
              onPageChange={setPage}
              onSelect={setSelected}
              selectedCik={selected?.cik}
            />
          )}
        </main>
      </div>

      {selected && (
        <CompanyDetail cik={selected.cik} localData={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
