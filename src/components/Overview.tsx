import type { Workflow, PropertyAcrossWorkflows } from '../types'
import type { DatasetStats } from '../lib/data'

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
