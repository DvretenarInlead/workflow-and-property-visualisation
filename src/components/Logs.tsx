import { useCallback, useEffect, useState } from 'react'

interface LogEntry {
  at: string
  endpoint: string
  status: 'success' | 'error' | 'skipped'
  workflows?: number
  message?: string
  ms?: number
}

/** Log of calls the server has made to the HubSpot API (from the Refresh button). */
export function Logs() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/logs', { headers: { Accept: 'application/json' } })
      if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Log endpoint unavailable (the app server isn’t running).')
      }
      const body = await res.json()
      setEntries(body.entries ?? [])
      setError(null)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [load])

  return (
    <div className="logs">
      <div className="logs__head">
        <div>
          <h2 className="panel__title">HubSpot API log</h2>
          <p className="muted">Every call the server makes to HubSpot when you refresh data. Auto-refreshes every 5s.</p>
        </div>
        <button className="btn" onClick={load} disabled={loading}>{loading ? '…' : 'Reload'}</button>
      </div>

      {error && <div className="chat__error">⚠ {error}</div>}

      {!error && entries.length === 0 && (
        <div className="lookup__empty">No HubSpot calls yet — hit “Refresh from HubSpot” in the header.</div>
      )}

      {entries.length > 0 && (
        <table className="log-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Endpoint</th>
              <th>Status</th>
              <th>Result</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i}>
                <td className="log-time">{new Date(e.at).toLocaleString()}</td>
                <td className="log-endpoint">{e.endpoint}</td>
                <td>
                  <span className={`log-status log-status--${e.status}`}>{e.status}</span>
                </td>
                <td>
                  {e.status === 'success'
                    ? `${e.workflows} workflows`
                    : e.message ?? '—'}
                </td>
                <td className="log-ms">{e.ms != null ? `${e.ms} ms` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
