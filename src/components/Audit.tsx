import { useMemo, useState } from 'react'
import type { Workflow } from '../types'
import { auditFindings, severityCounts, type Severity } from '../lib/analysis'

const SEVERITY_META: Record<Severity, { label: string; icon: string }> = {
  high: { label: 'High', icon: '⛔' },
  medium: { label: 'Medium', icon: '⚠️' },
  low: { label: 'Low', icon: 'ℹ️' },
  info: { label: 'Info', icon: '•' },
}

/**
 * Automation audit: ranked findings across all workflows — trigger loops, write
 * races, broken cascades, dead writes, overlapping triggers, empty workflows.
 */
export function Audit({
  workflows,
  onOpenWorkflow,
}: {
  workflows: Workflow[]
  onOpenWorkflow: (id: string, property?: string) => void
}) {
  const findings = useMemo(() => auditFindings(workflows), [workflows])
  const counts = useMemo(() => severityCounts(findings), [findings])
  const [filter, setFilter] = useState<Severity | 'all'>('all')
  const byId = useMemo(() => new Map(workflows.map((w) => [w.id, w])), [workflows])

  const shown = filter === 'all' ? findings : findings.filter((f) => f.severity === filter)

  return (
    <div className="audit">
      <div className="audit__summary">
        <button
          className={`sev-tile ${filter === 'all' ? 'sev-tile--on' : ''}`}
          onClick={() => setFilter('all')}
        >
          <div className="sev-tile__value">{findings.length}</div>
          <div className="sev-tile__label">All findings</div>
        </button>
        {(['high', 'medium', 'low', 'info'] as Severity[]).map((s) => (
          <button
            key={s}
            className={`sev-tile sev-tile--${s} ${filter === s ? 'sev-tile--on' : ''}`}
            onClick={() => setFilter(filter === s ? 'all' : s)}
            disabled={counts[s] === 0}
          >
            <div className="sev-tile__value">{counts[s]}</div>
            <div className="sev-tile__label">{SEVERITY_META[s].label}</div>
          </button>
        ))}
      </div>

      {findings.length === 0 && (
        <div className="empty">
          <h2>No issues found 🎉</h2>
          <p className="muted">The audit found no trigger loops, write races, dead writes, or broken cascades.</p>
        </div>
      )}

      <div className="audit__list">
        {shown.map((f) => (
          <div key={f.id} className={`finding finding--${f.severity}`}>
            <div className="finding__icon">{SEVERITY_META[f.severity].icon}</div>
            <div className="finding__body">
              <div className="finding__head">
                <span className="finding__title">{f.title}</span>
                <span className="finding__cat">{f.category}</span>
              </div>
              <div className="finding__detail">{f.detail}</div>
              <div className="finding__wfs">
                {f.workflowIds.map((id) => (
                  <button key={id} className="finding__wf" onClick={() => onOpenWorkflow(id, f.property)}>
                    {byId.get(id)?.name ?? id} →
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
