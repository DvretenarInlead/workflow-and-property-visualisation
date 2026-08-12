import { useMemo } from 'react'
import type { Workflow, PropertyAcrossWorkflows } from '../types'
import type { DatasetStats } from '../lib/data'
import { triggerTypeCounts, triggerProperties } from '../lib/analysis'

export function Overview({
  workflows,
  properties,
  stats,
  onOpenWorkflow,
  onOpenProperty,
}: {
  workflows: Workflow[]
  properties: PropertyAcrossWorkflows[]
  stats: DatasetStats
  onOpenWorkflow: (id: string) => void
  onOpenProperty: (name: string) => void
}) {
  const topProps = properties.slice(0, 8)
  const triggerTypes = useMemo(() => triggerTypeCounts(workflows), [workflows])
  const topTriggers = useMemo(() => triggerProperties(workflows).slice(0, 8), [workflows])
  const maxType = Math.max(1, ...triggerTypes.map((t) => t.count))
  const maxTrig = Math.max(1, ...topTriggers.map((t) => t.workflowIds.length))
  return (
    <div className="overview">
      <div className="cards">
        <StatCard label="Workflows" value={stats.total} sub={`${stats.enabled} enabled`} />
        <StatCard label="Unique properties" value={stats.uniqueProperties} sub={`${stats.sharedProperties} shared across ≥2`} />
        <StatCard
          label="By object"
          value={Object.keys(stats.byObjectType).length}
          sub={Object.entries(stats.byObjectType)
            .map(([k, v]) => `${v} ${k}`)
            .join(' · ')}
        />
      </div>

      <div className="overview__grid">
        <section className="panel">
          <h2 className="panel__title">Workflows</h2>
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Object</th>
                <th>Steps</th>
                <th>Props</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((wf) => (
                <tr key={wf.id} className="list__row" onClick={() => onOpenWorkflow(wf.id)}>
                  <td className="list__name">{wf.name}</td>
                  <td><span className="tag">{wf.objectType}</span></td>
                  <td>{wf.steps.length}</td>
                  <td>{wf.properties.length}</td>
                  <td>
                    <span className={`status ${wf.enabled ? 'status--on' : 'status--off'}`}>
                      {wf.enabled ? 'Enabled' : 'Off'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2 className="panel__title">Most-used properties</h2>
          <ul className="proplist">
            {topProps.map((p) => {
              const max = topProps[0].totalReads + topProps[0].totalWrites || 1
              const total = p.totalReads + p.totalWrites
              return (
                <li key={`${p.objectType}:${p.name}`} className="proplist__item" onClick={() => onOpenProperty(p.name)}>
                  <div className="proplist__head">
                    <span className="proplist__name">{p.name}</span>
                    <span className="proplist__count">{p.workflowIds.length} wf</span>
                  </div>
                  <div className="proplist__bar">
                    <span
                      className="proplist__bar-read"
                      style={{ width: `${(p.totalReads / max) * 100}%` }}
                    />
                    <span
                      className="proplist__bar-write"
                      style={{ width: `${(p.totalWrites / max) * 100}%` }}
                    />
                  </div>
                  <div className="proplist__meta">
                    {p.totalReads}R · {p.totalWrites}W · {total} total refs
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      <div className="overview__grid">
        <section className="panel">
          <h2 className="panel__title">How workflows are triggered</h2>
          <ul className="proplist">
            {triggerTypes.map((t) => (
              <li key={t.type} className="proplist__item">
                <div className="proplist__head">
                  <span className="proplist__name">{t.type}</span>
                  <span className="proplist__count">{t.count} wf</span>
                </div>
                <div className="proplist__bar">
                  <span className="proplist__bar-read" style={{ width: `${(t.count / maxType) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2 className="panel__title">Top enrollment properties</h2>
          <ul className="proplist">
            {topTriggers.map((t) => (
              <li key={`${t.objectType}:${t.name}`} className="proplist__item" onClick={() => onOpenProperty(t.name)}>
                <div className="proplist__head">
                  <span className="proplist__name">{t.name}</span>
                  <span className="proplist__count">{t.workflowIds.length} wf</span>
                </div>
                <div className="proplist__bar">
                  <span className="proplist__bar-read" style={{ width: `${(t.workflowIds.length / maxTrig) * 100}%` }} />
                </div>
                <div className="proplist__meta">{t.objectType} · enrolls {t.workflowIds.length} workflow{t.workflowIds.length === 1 ? '' : 's'}</div>
              </li>
            ))}
            {topTriggers.length === 0 && <li className="lookup__empty">No trigger properties detected.</li>}
          </ul>
        </section>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="card">
      <div className="card__value">{value}</div>
      <div className="card__label">{label}</div>
      {sub && <div className="card__sub">{sub}</div>}
    </div>
  )
}
