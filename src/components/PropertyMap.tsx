import { useMemo, useState } from 'react'
import type { Workflow, PropertyAcrossWorkflows } from '../types'

/**
 * Cross-workflow property usage matrix. Rows = properties, columns = workflows.
 * A cell shows whether the property is read (R), written (W) or both in that
 * workflow — the core "which workflows will break if I change this property?" view.
 */
export function PropertyMap({
  workflows,
  properties,
  onSelectWorkflow,
}: {
  workflows: Workflow[]
  properties: PropertyAcrossWorkflows[]
  onSelectWorkflow: (id: string, property: string) => void
}) {
  const [query, setQuery] = useState('')
  const [objectFilter, setObjectFilter] = useState<string>('all')
  const [sharedOnly, setSharedOnly] = useState(false)

  const objectTypes = useMemo(
    () => ['all', ...new Set(properties.map((p) => p.objectType ?? 'unknown'))],
    [properties],
  )

  const usageByWorkflow = useMemo(() => {
    // name+object -> workflowId -> {reads, writes}
    const map = new Map<string, Map<string, { reads: number; writes: number }>>()
    for (const wf of workflows) {
      for (const p of wf.properties) {
        const key = `${p.objectType ?? ''}:${p.name}`
        const inner = map.get(key) ?? new Map()
        inner.set(wf.id, { reads: p.reads, writes: p.writes })
        map.set(key, inner)
      }
    }
    return map
  }, [workflows])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return properties.filter((p) => {
      if (objectFilter !== 'all' && (p.objectType ?? 'unknown') !== objectFilter) return false
      if (sharedOnly && p.workflowIds.length < 2) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) || (p.label ?? '').toLowerCase().includes(q)
      )
    })
  }, [properties, query, objectFilter, sharedOnly])

  return (
    <div className="propmap">
      <div className="propmap__toolbar">
        <input
          className="input"
          placeholder="Filter properties…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="input"
          value={objectFilter}
          onChange={(e) => setObjectFilter(e.target.value)}
        >
          {objectTypes.map((t) => (
            <option key={t} value={t}>
              {t === 'all' ? 'All objects' : t}
            </option>
          ))}
        </select>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={sharedOnly}
            onChange={(e) => setSharedOnly(e.target.checked)}
          />
          Shared only
        </label>
        <span className="propmap__count">
          {rows.length} propert{rows.length === 1 ? 'y' : 'ies'}
        </span>
      </div>

      <div className="propmap__scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th className="matrix__corner">Property</th>
              {workflows.map((wf) => (
                <th key={wf.id} className="matrix__wf" title={wf.name}>
                  <div className="matrix__wf-inner">
                    <span className={`dot ${wf.enabled ? 'dot--on' : 'dot--off'}`} />
                    {wf.name}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const key = `${p.objectType ?? ''}:${p.name}`
              const inner = usageByWorkflow.get(key)
              return (
                <tr key={key}>
                  <th className="matrix__prop">
                    <div className="matrix__prop-name">{p.name}</div>
                    <div className="matrix__prop-meta">
                      {p.objectType} · {p.workflowIds.length} wf · {p.totalReads}R/{p.totalWrites}W
                    </div>
                  </th>
                  {workflows.map((wf) => {
                    const cell = inner?.get(wf.id)
                    if (!cell) return <td key={wf.id} className="cell cell--empty" />
                    const both = cell.reads > 0 && cell.writes > 0
                    const cls = both ? 'cell--both' : cell.writes > 0 ? 'cell--write' : 'cell--read'
                    const label = both ? 'RW' : cell.writes > 0 ? 'W' : 'R'
                    return (
                      <td
                        key={wf.id}
                        className={`cell ${cls}`}
                        title={`${wf.name}: ${cell.reads} read(s), ${cell.writes} write(s) — click to view`}
                        onClick={() => onSelectWorkflow(wf.id, p.name)}
                      >
                        {label}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="legend">
        <span className="legend__item"><span className="swatch cell--read" />Read</span>
        <span className="legend__item"><span className="swatch cell--write" />Write</span>
        <span className="legend__item"><span className="swatch cell--both" />Read &amp; write</span>
        <span className="legend__hint">Click a cell to open that workflow with the property highlighted.</span>
      </div>
    </div>
  )
}
