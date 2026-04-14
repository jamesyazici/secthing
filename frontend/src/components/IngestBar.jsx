import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

export default function IngestBar({ onRefresh }) {
  const [status, setStatus]   = useState(null)   // progress object from API
  const [open, setOpen]       = useState(false)
  const [force, setForce]     = useState(false)
  const pollRef               = useRef(null)

  async function fetchStatus() {
    try {
      const data = await api.getIngestStatus()
      setStatus(data.progress)
      return data.progress
    } catch {
      return null
    }
  }

  // Poll while running
  useEffect(() => {
    fetchStatus()
    return () => clearInterval(pollRef.current)
  }, [])

  useEffect(() => {
    clearInterval(pollRef.current)
    if (status?.status === 'running') {
      pollRef.current = setInterval(async () => {
        const s = await fetchStatus()
        if (s?.status !== 'running') {
          clearInterval(pollRef.current)
          onRefresh?.()
        }
      }, 2000)
    }
    return () => clearInterval(pollRef.current)
  }, [status?.status])

  async function handleStart() {
    await api.startIngest(force)
    await fetchStatus()
    setOpen(false)
  }

  const running  = status?.status === 'running'
  const pct      = status?.total > 0
    ? Math.round((status.processed / status.total) * 100)
    : 0

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold
                    border transition-colors
                    ${running
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
      >
        {running ? (
          <>
            <span className="animate-spin">⟳</span>
            Ingesting {pct}%
          </>
        ) : (
          <>⬇ Update Data</>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-lg border border-slate-200 dark:border-slate-700
                        bg-white dark:bg-slate-800 shadow-xl z-50 p-4 text-sm">
          <h3 className="font-bold mb-3 text-base">Data Ingest</h3>

          {running ? (
            <div>
              <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                <span>{status.processed.toLocaleString()} / {status.total.toLocaleString()} companies</span>
                <span>{pct}%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {status.failed > 0 && (
                <p className="text-xs text-amber-500 mt-2">{status.failed} failed (SEC errors, retried)</p>
              )}
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                Respecting SEC rate limits (~7 req/s). This takes ~15–20 min for a full ingest.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {status?.status === 'completed' && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  Last ingest completed: {status.processed?.toLocaleString()} companies indexed.
                </p>
              )}
              {status?.status === 'failed' && (
                <p className="text-xs text-red-500">Last ingest failed.</p>
              )}

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Downloads all SEC-registered public companies and indexes their industry, location, size, and filing history.
                Respects SEC rate limits. Takes ~15–20 minutes.
              </p>

              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={e => setForce(e.target.checked)}
                  className="rounded"
                />
                Force re-fetch all companies (slower)
              </label>

              <button
                onClick={handleStart}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded
                           font-semibold text-sm transition-colors"
              >
                Start Ingest
              </button>
              <button
                onClick={() => setOpen(false)}
                className="w-full py-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xs"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
