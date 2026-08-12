import { useMemo } from 'react'
import type { Workflow, PropertyAcrossWorkflows, StepKind } from '../types'
import {
  stepKindCounts,
  workflowComplexity,
  readWriteByObject,
  propertyImpact,
} from '../lib/reports'
import { HBarChart, Legend, ChartCard, type BarRow } from './charts'

const KIND_COLOR: Record<StepKind, string> = {
  trigger: 'var(--k-trigger)',
  branch: 'var(--k-branch)',
  action: 'var(--k-action)',
  setproperty: 'var(--k-setproperty)',
  delay: 'var(--k-delay)',
  goto: 'var(--k-goto)',
  end: 'var(--k-end)',
}
const KIND_LABEL: Record<StepKind, string> = {
  trigger: 'Trigger',
  branch: 'Branch',
  action: 'Action',
  setproperty: 'Set property',
  delay: 'Delay',
  goto: 'Go to',
  end: 'End',
}

export function Reports({
  workflows,
  properties,
  onOpenWorkflow,
  onOpenProperty,
}: {
  workflows: Workflow[]
  properties: PropertyAcrossWorkflows[]
  onOpenWorkflow: (id: string) => void
  onOpenProperty: (name: string) => void
}) {
  const kinds = useMemo(() => stepKindCounts(workflows), [workflows])
  const complexity = useMemo(() => workflowComplexity(workflows), [workflows])
  const byObject = useMemo(() => readWriteByObject(workflows), [workflows])
  const impact = useMemo(() => propertyImpact(properties, 10), [properties])

  // Report 1 — property impact (how many workflows depend on each property).
  const impactRows: BarRow[] = impact.map((p) => ({
    key: `${p.objectType}:${p.name}`,
    label: p.name,
    sublabel: `${p.objectType} · ${p.totalReads}R / ${p.totalWrites}W`,
    valueLabel: `${p.workflowCount} wf`,
    segments: [{ key: 'wf', value: p.workflowCount, color: 'var(--s1)', seriesLabel: 'Workflows' }],
    onClick: () => onOpenProperty(p.name),
  }))
  const impactMax = Math.max(1, ...impact.map((p) => p.workflowCount))

  // Report 2 — workflow complexity (step count, with branch/write context).
  const complexityRows: BarRow[] = complexity.map((w) => ({
    key: w.id,
    label: w.name,
    sublabel: `${w.branches} branch · ${w.writes} writes${w.enabled ? '' : ' · off'}`,
    valueLabel: `${w.steps}`,
    segments: [{ key: 'steps', value: w.steps, color: 'var(--s1)', seriesLabel: 'Steps' }],
    onClick: () => onOpenWorkflow(w.id),
  }))

  // Report 3 — reads vs writes per CRM object (stacked, two series).
  const objectRows: BarRow[] = byObject.map((o) => ({
    key: o.objectType,
    label: o.objectType,
    sublabel: `${o.reads + o.writes} property refs`,
    segments: [
      { key: 'r', value: o.reads, color: 'var(--s1)', seriesLabel: 'Reads' },
      { key: 'w', value: o.writes, color: 'var(--s2)', seriesLabel: 'Writes' },
    ],
  }))

  // Report 4 — step-type mix across all workflows (categorical, direct-labelled).
  const kindRows: BarRow[] = kinds.map((k) => ({
    key: k.kind,
    label: KIND_LABEL[k.kind],
    segments: [{ key: k.kind, value: k.count, color: KIND_COLOR[k.kind], seriesLabel: KIND_LABEL[k.kind] }],
  }))

  return (
    <div className="reports">
      <div className="reports__grid">
        <ChartCard
          title="Property impact"
          subtitle="Workflows that depend on each property — change these carefully."
        >
          <HBarChart rows={impactRows} max={impactMax} unit="workflows" labelWidth={200} />
        </ChartCard>

        <ChartCard
          title="Reads vs writes by object"
          subtitle="Total property references, split by direction."
          legend={
            <Legend
              items={[
                { label: 'Reads', color: 'var(--s1)' },
                { label: 'Writes', color: 'var(--s2)' },
              ]}
            />
          }
        >
          <HBarChart rows={objectRows} unit="refs" labelWidth={90} />
        </ChartCard>

        <ChartCard
          title="Workflow complexity"
          subtitle="Steps per workflow (branches and property writes in the sublabel)."
        >
          <HBarChart rows={complexityRows} unit="steps" labelWidth={220} />
        </ChartCard>

        <ChartCard
          title="Step-type mix"
          subtitle="How many of each step type across all workflows."
        >
          <HBarChart rows={kindRows} unit="steps" labelWidth={110} />
        </ChartCard>
      </div>
    </div>
  )
}
