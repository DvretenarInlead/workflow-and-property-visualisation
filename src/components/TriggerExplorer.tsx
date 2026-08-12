import { useMemo, useState } from 'react'
import type { Workflow } from '../types'
import { triggerProperties, triggerRows } from '../lib/analysis'

/**
 * Trigger-first view: which workflows are enrolled by which property. Pick a
 * property (e.g. dealstage) to see every workflow whose ENROLLMENT TRIGGER uses
 * it — as opposed to Property lookup, which matches any step.
 */
export function TriggerExplorer({
  workflows,
  onOpenWorkflow,
}: {
  workflows: Workflow[]
  onOpenWorkflow: (id: string, property: string) => void
}) {
  const [query, setQuery] = useState('')
  const [objectFilter, setObjectFilter] = useState('all')
  const [selected, setSelected] = useState<string | null>(null)

  const props = useMemo(() => triggerProperties(workflows), [workflows])
  const rows = useMemo(() => triggerRows(workflows), [workflows])
  const byId = useMemo(() => new Map(workflows.map((w) => [w.id, w])), [workflows])

  const objectTypes = useMemo(
    () => ['all', ...new Set(props.map((p) => p.objectType))],
    [props],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return props.filter((p) => {
      if (objectFilter !== 'all' && p.objectType !== objectFilter) return false
      return !q || p.name.toLowerCase().includes(q)
    })
  }, [props, query, objectFilter])

  const active = selected ?? (filtered.length === 1 ? `${filtered[0].objectType}:${filtered[0].name}` : null)
  const activeProp = props.find((p) => `${p.objectType}:${p.name}` === active)

  return (
    <div className="lookup">
      <div className="lookup__toolbar">
        <input
          className="input"
          placeholder="Filter trigger properties…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(null) }}
        />
        <select className="input" value={objectFilter} onChange={(e) => setObjectFilter(e.target.value)}>
          {objectTypes.map((t) => (
            <option key={t} value={t}>{t === 'all' ? 'All objects' : t}</option>
          ))}
        </select>
        <span className="propmap__count">{filtered.length} trigger propert{filtered.length === 1 ? 'y' : 'ies'}</span>
      </div>

      {!activeProp && (
        <>
          <div className="lookup__hint">Properties that enroll contacts into a workflow. Pick one to see which workflows.</div>
          <div className="trigger-chips">
            {filtered.map((p) => (
              <button
                key={`${p.objectType}:${p.name}`}
                className="trigger-chip"
                onClick={() => setSelected(`${p.objectType}:${p.name}`)}
              >
                <span className="trigger-chip__name">{p.name}</span>
                <span className="trigger-chip__meta">
                  <span className="tag">{p.objectType}</span>
                  {p.workflowIds.length} wf
                </span>
              </button>
            ))}
            {filtered.length === 0 && <div className="lookup__empty">No trigger properties match “{query}”.</div>}
          </div>
        </>
      )}

      {activeProp && (
        <div className="lookup__detail">
          <div className="lookup__detail-head">
            <div>
              <h2 className="lookup__prop">Triggered by {activeProp.name}</h2>
              <div className="lookup__prop-meta">
                <span className="tag">{activeProp.objectType}</span>
                {activeProp.workflowIds.length} workflow{activeProp.workflowIds.length === 1 ? '' : 's'} enroll on this property
              </div>
            </div>
            <button className="btn" onClick={() => { setSelected(null); setQuery('') }}>← All triggers</button>
          </div>

          <div className="lookup__cards">
            {activeProp.workflowIds.map((id) => {
              const wf = byId.get(id)!
              const detail = rows.find((r) => r.workflow.id === id)?.detail
              return (
                <section key={id} className="wf-card">
                  <header className="wf-card__head">
                    <div>
                      <div className="wf-card__name">{wf.name}</div>
                      <div className="wf-card__meta">
                        <span className="tag">{wf.objectType}</span>
                        <span className={`status ${wf.enabled ? 'status--on' : 'status--off'}`}>
                          {wf.enabled ? 'Enabled' : 'Off'}
                        </span>
                        <span className="muted">{wf.type}</span>
                      </div>
                    </div>
                    <button className="btn btn--sm" onClick={() => onOpenWorkflow(id, activeProp.name)}>View flow →</button>
                  </header>
                  <div className="wf-card__trigger">
                    <span className="badge badge--trigger">⚡</span>
                    <div>
                      <div className="wf-card__step-title">Enrollment trigger</div>
                      {detail && <div className="wf-card__step-detail">{detail}</div>}
                    </div>
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
