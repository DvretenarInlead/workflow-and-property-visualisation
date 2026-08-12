import { useMemo } from 'react'
import type { Pipeline, Workflow } from '../types'

// The property that carries a record's stage, per object.
const STAGE_PROPERTY: Record<string, string> = {
  deal: 'dealstage',
  ticket: 'hs_pipeline_stage',
}

/**
 * Deal & ticket pipelines with their stages, plus the automation logic around
 * them: which workflows read (enroll on) or write (move records through) the
 * stage property for that object.
 */
export function Pipelines({
  pipelines,
  workflows,
  onOpenWorkflow,
}: {
  pipelines: Pipeline[]
  workflows: Workflow[]
  onOpenWorkflow: (id: string, property: string) => void
}) {
  const byObject = useMemo(() => {
    const groups = new Map<string, Pipeline[]>()
    for (const p of pipelines) groups.set(p.objectType, [...(groups.get(p.objectType) ?? []), p])
    return groups
  }, [pipelines])

  function workflowsForObject(objectType: string) {
    const prop = STAGE_PROPERTY[objectType]
    if (!prop) return []
    return workflows
      .filter((wf) => wf.objectType === objectType)
      .map((wf) => {
        const reads = wf.steps.some((s) => s.reads.includes(prop))
        const writes = wf.steps.some((s) => s.writes.includes(prop))
        return { wf, reads, writes, prop }
      })
      .filter((x) => x.reads || x.writes)
  }

  if (!pipelines.length) {
    return (
      <div className="pipelines">
        <div className="empty">
          <h2>No pipeline data</h2>
          <p className="muted">
            Deal &amp; ticket pipelines are pulled from a connected portal (they aren't in the sample
            data). Connect a portal and refresh to see stages and the automation around them.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="pipelines">
      {[...byObject.entries()].map(([objectType, list]) => {
        const linked = workflowsForObject(objectType)
        const prop = STAGE_PROPERTY[objectType]
        return (
          <section key={objectType} className="pipe-group">
            <h2 className="pipe-group__title">
              <span className="tag">{objectType}</span> pipelines
            </h2>
            {list.map((p) => (
              <div key={p.id} className="pipe-card">
                <div className="pipe-card__name">{p.label}</div>
                <div className="pipe-stages">
                  {p.stages.map((s, i) => (
                    <div key={s.id} className={`pipe-stage${s.isClosed ? ' pipe-stage--closed' : ''}`}>
                      <span className="pipe-stage__order">{i + 1}</span>
                      <span className="pipe-stage__label">{s.label}</span>
                      {s.probability != null && (
                        <span className="pipe-stage__prob">{Math.round(s.probability * 100)}%</span>
                      )}
                      {s.state && <span className="pipe-stage__state">{s.state}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="pipe-logic">
              <div className="pipe-logic__head">
                Automation on <code>{prop}</code> — {linked.length} workflow{linked.length === 1 ? '' : 's'}
              </div>
              {linked.length === 0 && (
                <div className="lookup__empty">No workflows read or write {prop}.</div>
              )}
              <div className="pipe-logic__list">
                {linked.map(({ wf, reads, writes }) => (
                  <button key={wf.id} className="pipe-wf" onClick={() => onOpenWorkflow(wf.id, prop)}>
                    <span className="pipe-wf__badges">
                      {reads && <span className="badge badge--read">R</span>}
                      {writes && <span className="badge badge--write">W</span>}
                    </span>
                    <span className="pipe-wf__name">{wf.name}</span>
                    <span className={`status ${wf.enabled ? 'status--on' : 'status--off'}`}>
                      {wf.enabled ? 'On' : 'Off'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}
