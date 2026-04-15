import { useEffect, useState } from 'react'
import { fetchCompanyDetail } from '../api'

function Row({ label, value }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex gap-3 py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <dt className="w-36 shrink-0 text-xs text-slate-500 dark:text-slate-400 font-medium">{label}</dt>
      <dd className="flex-1 text-sm break-words">{value}</dd>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-5">
      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">
        {title}
      </h3>
      <dl>{children}</dl>
    </div>
  )
}

export default function CompanyDetail({ cik, localData, onClose }) {
  const [liveData, setLiveData] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  // Merge local (fast) data with live SEC detail (slower)
  const data = liveData ? { ...localData, ...liveData } : localData

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchCompanyDetail(cik)
      .then(setLiveData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [cik])

  function formatAddress(addr) {
    if (!addr) return null
    const parts = [addr.street1, addr.street2, addr.city, addr.state, addr.zip].filter(Boolean)
    return parts.join(', ')
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/30 dark:bg-black/50 z-20"
        onClick={onClose}
      />

      {/* Panel */}
      <aside className="fixed right-0 top-0 h-full w-full max-w-lg z-30
                        bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700
                        flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-200 dark:border-slate-700">
          {loading || !data ? (
            <div className="space-y-2 flex-1">
              <div className="h-5 w-2/3 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
              <div className="h-3 w-1/3 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
            </div>
          ) : (
            <div className="flex-1 min-w-0 pr-4">
              <h2 className="text-lg font-bold truncate">{data.name}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                {data.ticker && <span className="font-mono mr-2">{data.ticker}</span>}
                {data.exchange && <span className="mr-2">{data.exchange}</span>}
                <span className="text-xs">CIK: {data.cik}</span>
              </p>
            </div>
          )}
          <button
            onClick={onClose}
            className="text-2xl leading-none text-slate-400 hover:text-slate-700
                       dark:hover:text-slate-200 transition-colors"
          >×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" style={{ width: `${60 + Math.random() * 30}%` }} />
              ))}
            </div>
          )}

          {error && (
            <p className="text-sm text-red-500">Failed to load: {error}</p>
          )}

          {data && !loading && (
            <>
              <Section title="Industry">
                <Row label="SIC Code"    value={data.sic} />
                <Row label="Industry"    value={data.sic_description} />
                <Row label="Entity Type" value={data.entity_type} />
                <Row label="Category"    value={data.category} />
              </Section>

              <Section title="Location">
                <Row label="Business"    value={formatAddress(data.business_address)} />
                <Row label="Mailing"     value={formatAddress(data.mailing_address)} />
                <Row label="Incorporated In" value={data.state_of_incorporation} />
              </Section>

              <Section title="Size & Age">
                <Row label="Employees"
                     value={data.employee_count != null
                       ? `${Number(data.employee_count).toLocaleString()}${data.employee_count_as_of ? ` (as of ${data.employee_count_as_of})` : ''}`
                       : null}
                />
                <Row label="Filer Category" value={data.category} />
                <Row label="First Filing"   value={data.first_filing_year ? `~${data.first_filing_year}` : null} />
                <Row label="Fiscal Year End" value={data.fiscal_year_end} />
              </Section>

              <Section title="Contact">
                <Row label="Phone"   value={data.phone} />
                <Row label="Website" value={data.website || data.investor_website} />
              </Section>

              {data.recent_filings?.length > 0 && (
                <Section title="Recent Filings">
                  <div className="space-y-1">
                    {data.recent_filings.map((f, i) => (
                      <div key={i} className="flex justify-between text-xs py-1 border-b border-slate-100 dark:border-slate-800">
                        <span className="font-mono font-bold text-blue-600 dark:text-blue-400 w-20">{f.form}</span>
                        <span className="text-slate-500">{f.date}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              <a
                href={data.edgar_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block w-full text-center text-sm py-2.5 px-4 rounded
                           bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors"
              >
                View on SEC EDGAR ↗
              </a>
            </>
          )}
        </div>
      </aside>
    </>
  )
}
