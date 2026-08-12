import type { Workflow, StepKind, PropertyAcrossWorkflows } from '../types'

export interface KindCount {
  kind: StepKind
  count: number
}

/** Count step kinds across all workflows (identity → categorical). */
export function stepKindCounts(workflows: Workflow[]): KindCount[] {
  const order: StepKind[] = ['trigger', 'branch', 'action', 'setproperty', 'delay', 'goto', 'end']
  const counts = new Map<StepKind, number>()
  for (const wf of workflows) for (const s of wf.steps) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1)
  return order.map((kind) => ({ kind, count: counts.get(kind) ?? 0 })).filter((k) => k.count > 0)
}

export interface ComplexityRow {
  id: string
  name: string
  steps: number
  branches: number
  writes: number
  enabled: boolean
}

/** Per-workflow size/complexity (magnitude → bars). */
export function workflowComplexity(workflows: Workflow[]): ComplexityRow[] {
  return workflows
    .map((wf) => ({
      id: wf.id,
      name: wf.name,
      steps: wf.steps.length,
      branches: wf.steps.filter((s) => s.kind === 'branch').length,
      writes: wf.steps.reduce((n, s) => n + s.writes.length, 0),
      enabled: wf.enabled,
    }))
    .sort((a, b) => b.steps - a.steps)
}

export interface ObjectRW {
  objectType: string
  reads: number
  writes: number
}

/** Reads vs writes grouped by CRM object (two series). */
export function readWriteByObject(workflows: Workflow[]): ObjectRW[] {
  const map = new Map<string, ObjectRW>()
  for (const wf of workflows) {
    const row = map.get(wf.objectType) ?? { objectType: wf.objectType, reads: 0, writes: 0 }
    for (const s of wf.steps) {
      row.reads += s.reads.length
      row.writes += s.writes.length
    }
    map.set(wf.objectType, row)
  }
  return [...map.values()].sort((a, b) => b.reads + b.writes - (a.reads + a.writes))
}

export interface ImpactRow extends PropertyAcrossWorkflows {
  workflowCount: number
}

/** Properties ranked by how many workflows depend on them (impact analysis). */
export function propertyImpact(props: PropertyAcrossWorkflows[], limit = 10): ImpactRow[] {
  return props
    .map((p) => ({ ...p, workflowCount: p.workflowIds.length }))
    .sort(
      (a, b) =>
        b.workflowCount - a.workflowCount ||
        b.totalReads + b.totalWrites - (a.totalReads + a.totalWrites),
    )
    .slice(0, limit)
}
