import { useCallback, useEffect, useMemo, useState } from 'react'

interface LogEntry {
  at: string
  level: 'info' | 'warn' | 'error'
  category: string
  endpoint?: string
  status?: string
  message?: string
  ms?: number
  portal?: string
  workflows?: number
}

type LevelFilter = 'all' | 'info' | 'warn' | 'error'

/** Runtime log: HTTP requests, HubSpot calls, OAuth, chat, and system events. */
export function Logs() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [level, setLevel] = useState<LevelFilter>('all')
  const [auto, setAuto] = useState(true)

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
    if (!auto) return
    const id = setInterval(load, 4000)
    return () => clearInterval(id)
  }, [load, auto])

  const counts = useMemo(() => {
    const c = { all: entries.length, info: 0, warn: 0, error: 0 } as Record<LevelFilter, number>
    for (const e of entries) c[e.level] = (c[e.level] ?? 0) + 1
    return c
  }, [entries])

  const shown = level === 'all' ? entries : entries.filter((e) => e.level === level)

  function detail(e: LogEntry) {
    if (e.message) return e.message
    if (e.workflows != null) return `${e.workflows} workflows`
    if (e.status) return e.status
    return '—'
  }

  return (
    <div className="logs">
      <div className="logs__head">
        <div>
          <h2 className="panel__title">Runtime log</h2>
          <p className="muted">HTTP requests, HubSpot calls, OAuth, chat, and system events — also printed to the server’s stdout.</p>
        </div>
        <div className="logs__controls">
          {(['all', 'info', 'warn', 'error'] as LevelFilter[]).map((l) => (
            <button
              key={l}
              className={`log-filter ${level === l ? 'log-filter--on' : ''} log-filter--${l}`}
              onClick={() => setLevel(l)}
            >
              {l} <span className="log-filter__count">{counts[l] ?? 0}</span>
            </button>
          ))}
          <label className="checkbox"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto</label>
          <button className="btn btn--sm" onClick={load} disabled={loading}>{loading ? '…' : 'Reload'}</button>
        </div>
      </div>

      {error && <div className="chat__error">⚠ {error}</div>}
      {!error && shown.length === 0 && <div className="lookup__empty">No log entries yet.</div>}

      {shown.length > 0 && (
        <div className="propmap__scroll">
          <table className="log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Level</th>
                <th>Category</th>
                <th>Event</th>
                <th>Detail</th>
                <th>Portal</th>
                <th>ms</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e, i) => (
                <tr key={i}>
                  <td className="log-time">{new Date(e.at).toLocaleTimeString()}</td>
                  <td><span className={`log-level log-level--${e.level}`}>{e.level}</span></td>
                  <td className="log-cat">{e.category}</td>
                  <td className="log-endpoint">{e.endpoint ?? '—'}</td>
                  <td className="log-detail">{detail(e)}</td>
                  <td className="log-portal">{e.portal ?? ''}</td>
                  <td className="log-ms">{e.ms != null ? e.ms : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
