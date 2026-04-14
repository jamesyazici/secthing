const PAGE_SIZE = 50

const COLS = [
  { key: 'name',             label: 'Company',      width: 'w-64' },
  { key: 'ticker',           label: 'Ticker',       width: 'w-20' },
  { key: 'sic',              label: 'SIC',          width: 'w-16' },
  { key: 'sic_description',  label: 'Industry',     width: 'w-48' },
  { key: 'business_city',    label: 'City',         width: 'w-32' },
  { key: 'business_state',   label: 'State',        width: 'w-16' },
  { key: 'category',         label: 'Size',         width: 'w-48' },
  { key: 'first_filing_year',label: 'Est.',         width: 'w-16' },
]

function SortIcon({ active, dir }) {
  if (!active) return <span className="ml-1 text-slate-400 opacity-40">↕</span>
  return <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>
}

function CategoryBadge({ cat }) {
  if (!cat) return null
  const colors = {
    'Large accelerated filer': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    'Accelerated filer':       'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    'Non-accelerated filer':   'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    'Smaller reporting company':'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  }
  const cls = colors[cat] ?? 'bg-slate-100 text-slate-500 dark:bg-slate-700'
  const short = {
    'Large accelerated filer': 'Large',
    'Accelerated filer': 'Accelerated',
    'Non-accelerated filer': 'Non-accel.',
    'Smaller reporting company': 'Smaller',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cls}`}>
      {short[cat] ?? cat}
    </span>
  )
}

export default function CompanyTable({
  companies, total, page, pageSize, loading, sort, onSort, onPageChange, onSelect, selectedCik,
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex flex-col h-full">

      {/* Count + pagination */}
      <div className="flex items-center justify-between px-4 py-2 border-b
                      border-slate-200 dark:border-slate-700 shrink-0">
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {loading ? 'Loading…' : `${total.toLocaleString()} result${total !== 1 ? 's' : ''}`}
        </span>
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || loading}
            className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600
                       disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >←</button>
          <span className="text-slate-500 dark:text-slate-400">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || loading}
            className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600
                       disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >→</button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {companies.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-600 gap-2">
            <span className="text-4xl">🔍</span>
            <p className="text-sm">No companies match your filters.</p>
            <p className="text-xs">Try widening the search or running an ingest first.</p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 z-10">
              <tr>
                {COLS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => onSort(col.key)}
                    className={`${col.width} px-3 py-2 text-left text-xs font-semibold
                                text-slate-500 dark:text-slate-400 uppercase tracking-wide
                                cursor-pointer hover:text-slate-900 dark:hover:text-slate-100
                                select-none whitespace-nowrap`}
                  >
                    {col.label}
                    <SortIcon active={sort.by === col.key} dir={sort.dir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {companies.map((co, i) => (
                <tr
                  key={co.cik}
                  onClick={() => onSelect(co)}
                  className={`cursor-pointer border-b border-slate-100 dark:border-slate-800
                              transition-colors
                              ${co.cik === selectedCik
                                ? 'bg-blue-50 dark:bg-blue-900/30'
                                : i % 2 === 0
                                  ? 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                  : 'bg-slate-50/50 dark:bg-slate-800/20 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                              }`}
                >
                  <td className="px-3 py-2 font-medium truncate max-w-xs">{co.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                    {co.ticker ?? '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{co.sic ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300 truncate max-w-xs">
                    {co.sic_description ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">{co.business_city ?? '—'}</td>
                  <td className="px-3 py-2 text-xs font-mono">{co.business_state ?? '—'}</td>
                  <td className="px-3 py-2"><CategoryBadge cat={co.category} /></td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {co.first_filing_year ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
