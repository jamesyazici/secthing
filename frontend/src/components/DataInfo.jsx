export default function DataInfo({ dataInfo, loading, error }) {
  if (loading) return (
    <span className="text-xs text-slate-400 animate-pulse">Loading data…</span>
  )
  if (error) return (
    <span className="text-xs text-red-400">Data load failed</span>
  )
  if (!dataInfo?.generated_at) return (
    <span className="text-xs text-amber-400">
      No data yet — run <code className="font-mono">python backend/export_json.py</code> locally
    </span>
  )

  const date = new Date(dataInfo.generated_at).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric'
  })

  return (
    <span className="text-xs text-slate-400 dark:text-slate-500">
      Updated {date}
    </span>
  )
}
