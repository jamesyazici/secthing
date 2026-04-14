const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export const api = {
  getSicCodes:      ()       => request('/api/sic-codes'),
  getFilterOptions: ()       => request('/api/filter-options'),
  getCompanies:     (params) => request(`/api/companies?${new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined))
  )}`),
  getCompany:       (cik)    => request(`/api/companies/${cik}`),
  startIngest:      (force)  => request(`/api/ingest/start?force=${force}`, { method: 'POST' }),
  getIngestStatus:  ()       => request('/api/ingest/status'),
  resetIngest:      ()       => request('/api/ingest/reset', { method: 'POST' }),
}
