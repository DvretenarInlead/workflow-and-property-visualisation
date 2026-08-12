import { useMemo, useState } from 'react'
import type { Workflow, PropertyAcrossWorkflows, StepKind } from '../types'

const KIND_LABEL: Record<StepKind, string> = {
  trigger: 'Trigger',
  branch: 'Branch',
  action: 'Action',
  setproperty: 'Set property',
  delay: 'Delay',
  goto: 'Go to',
  end: 'End',
}

/**
 * Property-first drill-down: pick a property (e.g. "dealstage" on deal) and see
 * every workflow that touches it and exactly which steps read or write it — the
 * "what is each workflow doing with this property?" view.
 */
export function PropertyLookup({
  workflows,
  properties,
  initialProperty,
  onOpenWorkflow,
}: {
  workflows: Workflow[]
  properties: PropertyAcrossWorkflows[]
  initialProperty?: string | null
  onOpenWorkflow: (id: string, property: string) => void
}) {
  const [query, setQuery] = useState(initialProperty ?? '')
  const [objectFilter, setObjectFilter] = useState('all')
  const [selected, setSelected] = useState<string | null>(initialProperty ?? null)

  const objectTypes = useMemo(
    () => ['all', ...new Set(properties.map((p) => p.objectType ?? 'unknown'))],
    [properties],
  )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return properties.filter((p) => {
      if (objectFilter !== 'all' && (p.objectType ?? 'unknown') !== objectFilter) return false
      if (!q) return true
      return p.name.toLowerCase().includes(q) || (p.label ?? '').toLowerCase().includes(q)
    })
  }, [properties, query, objectFilter])

  const active = selected ?? (matches.length === 1 ? matches[0].name : null)
  const activeProp = properties.find((p) => p.name === active)

  // Workflows that touch the active property, with the specific steps that do.
  const usage = useMemo(() => {
    if (!active) return []
    return workflows
      .map((wf) => {
        const steps = wf.steps.filter(
          (s) => s.reads.includes(active) || s.writes.includes(active),
        )
        return { wf, steps }
      })
      .filter((u) => u.steps.length > 0)
  }, [workflows, active])

  return (
    <div className="lookup">
      <div className="lookup__toolbar">
        <input
          className="input"
          placeholder="Type a property, e.g. dealstage"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(null)
          }}
          list="prop-suggestions"
          autoFocus
        />
        <datalist id="prop-suggestions">
          {properties.map((p) => (
            <option key={`${p.objectType}:${p.name}`} value={p.name} />
          ))}
        </datalist>
        <select className="input" value={objectFilter} onChange={(e) => setObjectFilter(e.target.value)}>
          {objectTypes.map((t) => (
            <option key={t} value={t}>
              {t === 'all' ? 'All objects' : t}
            </option>
          ))}
        </select>
      </div>

      {!active && (
        <div className="lookup__suggestions">
          <div className="lookup__hint">
            {matches.length} propert{matches.length === 1 ? 'y' : 'ies'} — pick one to see where it's used
          </div>
          <ul className="lookup__list">
            {matches.map((p) => (
              <li key={`${p.objectType}:${p.name}`} className="lookup__list-item" onClick={() => setSelected(p.name)}>
                <span className="lookup__list-name">{p.name}</span>
                <span className="lookup__list-meta">
                  <span className="tag">{p.objectType}</span>
                  {p.workflowIds.length} wf · {p.totalReads}R / {p.totalWrites}W
                </span>
              </li>
            ))}
            {matches.length === 0 && <li className="lookup__empty">No properties match “{query}”.</li>}
          </ul>
        </div>
      )}

      {active && activeProp && (
        <div className="lookup__detail">
          <div className="lookup__detail-head">
            <div>
              <h2 className="lookup__prop">{active}</h2>
              <div className="lookup__prop-meta">
                <span className="tag">{activeProp.objectType}</span>
                used in <strong>{usage.length}</strong> workflow{usage.length === 1 ? '' : 's'} ·{' '}
                {activeProp.totalReads} read{activeProp.totalReads === 1 ? '' : 's'} ·{' '}
                {activeProp.totalWrites} write{activeProp.totalWrites === 1 ? '' : 's'}
              </div>
            </div>
            <button className="btn" onClick={() => { setSelected(null); setQuery('') }}>
              ← All properties
            </button>
          </div>

          {usage.length === 0 && <div className="lookup__empty">No workflows use this property.</div>}

          <div className="lookup__cards">
            {usage.map(({ wf, steps }) => (
              <section key={wf.id} className="wf-card">
                <header className="wf-card__head">
                  <div>
                    <div className="wf-card__name">{wf.name}</div>
                    <div className="wf-card__meta">
                      <span className="tag">{wf.objectType}</span>
                      <span className={`status ${wf.enabled ? 'status--on' : 'status--off'}`}>
                        {wf.enabled ? 'Enabled' : 'Off'}
                      </span>
                      <span className="muted">{wf.steps.length} steps</span>
                    </div>
                  </div>
                  <button className="btn btn--sm" onClick={() => onOpenWorkflow(wf.id, active)}>
                    View flow →
                  </button>
                </header>
                <ul className="wf-card__steps">
                  {steps.map((s) => {
                    const writes = s.writes.includes(active)
                    const reads = s.reads.includes(active)
                    return (
                      <li key={s.id} className="wf-card__step">
                        <span className={`badge ${writes ? 'badge--write' : 'badge--read'}`}>
                          {writes && reads ? 'RW' : writes ? 'W' : 'R'}
                        </span>
                        <div className="wf-card__step-body">
                          <div className="wf-card__step-title">
                            {KIND_LABEL[s.kind]}: {s.title}
                          </div>
                          {s.detail && <div className="wf-card__step-detail">{s.detail}</div>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
