import { useState, useEffect, useCallback } from 'react'
import FilterPanel from './components/FilterPanel'
import CompanyTable from './components/CompanyTable'
import CompanyDetail from './components/CompanyDetail'
import IngestBar from './components/IngestBar'
import { api } from './api'

const DEFAULT_FILTERS = {
  sic: '', state: '', category: '',
  year_from: '', year_to: '', search: '',
}

export default function App() {
  const [dark, setDark] = useState(
    () => document.documentElement.classList.contains('dark')
  )
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [sort, setSort]       = useState({ by: 'name', dir: 'asc' })
  const [page, setPage]       = useState(1)
  const [result, setResult]   = useState({ companies: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)   // company detail
  const [filterOpts, setFilterOpts] = useState(
    { states: [], categories: [], sics: [], year_range: {}, total_companies: 0 }
  )

  // ── theme ──────────────────────────────────────────────────────────────────
  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }

  // ── filter options ─────────────────────────────────────────────────────────
  useEffect(() => {
    api.getFilterOptions()
      .then(setFilterOpts)
      .catch(() => {})
  }, [])

  // ── company fetch ──────────────────────────────────────────────────────────
  const fetchCompanies = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getCompanies({
        ...filters, sort_by: sort.by, sort_dir: sort.dir, page, page_size: 50,
      })
      setResult(data)
    } catch {
      setResult({ companies: [], total: 0 })
    } finally {
      setLoading(false)
    }
  }, [filters, sort, page])

  useEffect(() => { fetchCompanies() }, [fetchCompanies])

  function handleFilter(next) {
    setFilters(next)
    setPage(1)
  }

  function handleSort(col) {
    setSort(prev => ({
      by: col,
      dir: prev.by === col && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
    setPage(1)
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3
                         border-b border-slate-200 dark:border-slate-700
                         bg-white dark:bg-slate-900 z-10 sticky top-0">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold tracking-tight">SEC Explorer</span>
          {filterOpts.total_companies > 0 && (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {filterOpts.total_companies.toLocaleString()} companies indexed
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <IngestBar onRefresh={() => api.getFilterOptions().then(setFilterOpts).catch(() => {})} />
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

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar */}
        <aside className="w-72 shrink-0 border-r border-slate-200 dark:border-slate-700
                          overflow-y-auto bg-slate-50 dark:bg-slate-900">
          <FilterPanel
            filters={filters}
            onChange={handleFilter}
            options={filterOpts}
          />
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-hidden flex flex-col">
          <CompanyTable
            companies={result.companies}
            total={result.total}
            page={page}
            pageSize={50}
            loading={loading}
            sort={sort}
            onSort={handleSort}
            onPageChange={setPage}
            onSelect={setSelected}
            selectedCik={selected?.cik}
          />
        </main>
      </div>

      {/* ── Detail panel ───────────────────────────────────────────────────── */}
      {selected && (
        <CompanyDetail cik={selected.cik} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
