import type { Workflow } from '../types'

// ---- Triggers ----

export interface TriggerRow {
  workflow: Workflow
  /** Properties referenced by the enrollment trigger. */
  properties: string[]
  detail?: string
}

export function triggerRows(workflows: Workflow[]): TriggerRow[] {
  return workflows.map((wf) => {
    const t = wf.steps.find((s) => s.kind === 'trigger')
    return { workflow: wf, properties: t?.reads ?? [], detail: t?.detail }
  })
}

export interface TriggerProperty {
  name: string
  objectType: string
  /** Workflow ids whose trigger uses this property. */
  workflowIds: string[]
}

/** Every property that appears in an enrollment trigger, with the workflows using it. */
export function triggerProperties(workflows: Workflow[]): TriggerProperty[] {
  const map = new Map<string, TriggerProperty>()
  for (const { workflow, properties } of triggerRows(workflows)) {
    for (const name of properties) {
      const key = `${workflow.objectType}:${name}`
      const row = map.get(key) ?? { name, objectType: workflow.objectType, workflowIds: [] }
      if (!row.workflowIds.includes(workflow.id)) row.workflowIds.push(workflow.id)
      map.set(key, row)
    }
  }
  return [...map.values()].sort(
    (a, b) => b.workflowIds.length - a.workflowIds.length || a.name.localeCompare(b.name),
  )
}

/** Count of workflows per workflow type (a proxy for "how they're triggered"). */
export function triggerTypeCounts(workflows: Workflow[]): { type: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const wf of workflows) counts.set(wf.type, (counts.get(wf.type) ?? 0) + 1)
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
}

// ---- Write → trigger chain graph ----

export interface ChainEdge {
  id: string
  source: string // workflow that writes the property
  target: string // workflow whose trigger reads the property
  property: string
  selfLoop: boolean
}

/** Workflows that write a given property (via set-property steps). */
function writersOf(workflows: Workflow[], property: string): Workflow[] {
  return workflows.filter((wf) => wf.steps.some((s) => s.writes.includes(property)))
}

/**
 * Build the cascade graph: an edge A → B means workflow A writes a property that
 * enrolls contacts into workflow B (B's trigger reads it). This is how automation
 * flows across the portal.
 */
export function chainGraph(workflows: Workflow[]): { edges: ChainEdge[]; nodeIds: Set<string> } {
  const edges: ChainEdge[] = []
  const nodeIds = new Set<string>()
  for (const { workflow: target, properties } of triggerRows(workflows)) {
    for (const property of properties) {
      for (const source of writersOf(workflows, property)) {
        if (source.objectType !== target.objectType) continue // enrollment is per-object
        edges.push({
          id: `${source.id}->${target.id}:${property}`,
          source: source.id,
          target: target.id,
          property,
          selfLoop: source.id === target.id,
        })
        nodeIds.add(source.id)
        nodeIds.add(target.id)
      }
    }
  }
  return { edges, nodeIds }
}

/**
 * Detect multi-workflow cycles in the cascade graph (potential infinite-enrollment
 * loops). Self-loops are excluded — they're reported separately — and cycles are
 * deduplicated so the same loop isn't listed once per starting node.
 */
export function findCycles(edges: ChainEdge[]): string[][] {
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    if (e.source === e.target) continue // self-loops handled elsewhere
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target])
  }

  const cycles: string[][] = []
  const dedupe = new Set<string>()
  const seen = new Set<string>()
  const stack: string[] = []
  const onStack = new Set<string>()

  function record(cycle: string[]) {
    const key = [...cycle].sort().join('|')
    if (dedupe.has(key)) return
    dedupe.add(key)
    cycles.push(cycle)
  }

  function dfs(node: string) {
    stack.push(node)
    onStack.add(node)
    for (const next of adj.get(node) ?? []) {
      if (onStack.has(next)) {
        const i = stack.indexOf(next)
        if (i >= 0) record(stack.slice(i))
      } else if (!seen.has(next)) {
        dfs(next)
      }
    }
    stack.pop()
    onStack.delete(node)
    seen.add(node)
  }

  for (const node of adj.keys()) if (!seen.has(node)) dfs(node)
  return cycles
}

// ---- Audit findings ----

export type Severity = 'high' | 'medium' | 'low' | 'info'

export interface Finding {
  id: string
  severity: Severity
  category: string
  title: string
  detail: string
  workflowIds: string[]
  property?: string
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 }

export function auditFindings(workflows: Workflow[]): Finding[] {
  const findings: Finding[] = []
  const byId = new Map(workflows.map((w) => [w.id, w]))
  const name = (id: string) => byId.get(id)?.name ?? id

  // 1. Trigger loops (self-loop or multi-workflow cycle): infinite re-enrollment risk.
  const { edges } = chainGraph(workflows)
  const selfProps = new Map<string, Set<string>>()
  for (const e of edges) {
    if (e.selfLoop) selfProps.set(e.source, (selfProps.get(e.source) ?? new Set()).add(e.property))
  }
  for (const [id, propsSet] of selfProps) {
    const props = [...propsSet]
    findings.push({
      id: `loop-self-${id}`,
      severity: 'high',
      category: 'trigger-loop',
      title: `“${name(id)}” can re-trigger itself`,
      detail: `It writes ${props.join(', ')} and its own enrollment trigger reads ${props.length > 1 ? 'those properties' : props[0]} — contacts may re-enroll in a loop.`,
      workflowIds: [id],
      property: props[0],
    })
  }
  for (const cycle of findCycles(edges)) {
    findings.push({
      id: `loop-cycle-${cycle.join('-')}`,
      severity: 'high',
      category: 'trigger-loop',
      title: `Enrollment loop across ${cycle.length} workflows`,
      detail: `${cycle.map(name).join(' → ')} → ${name(cycle[0])}. Each writes a property that enrolls the next — a potential infinite cascade.`,
      workflowIds: cycle,
    })
  }

  // 2. Write races: same property written by 2+ workflows on the same object.
  const writeMap = new Map<string, Set<string>>()
  for (const wf of workflows)
    for (const s of wf.steps)
      for (const p of s.writes) {
        const key = `${wf.objectType}:${p}`
        writeMap.set(key, (writeMap.get(key) ?? new Set()).add(wf.id))
      }
  for (const [key, ids] of writeMap) {
    if (ids.size >= 2) {
      const property = key.split(':').slice(1).join(':')
      findings.push({
        id: `race-${key}`,
        severity: 'medium',
        category: 'write-race',
        title: `${ids.size} workflows write ${property}`,
        detail: `${[...ids].map(name).join(', ')} all set ${property}. If they run concurrently the final value is order-dependent.`,
        workflowIds: [...ids],
        property,
      })
    }
  }

  // 3. Broken cascade: an enabled workflow is triggered by a property whose only writers are disabled.
  for (const { workflow: target, properties } of triggerRows(workflows)) {
    if (!target.enabled) continue
    for (const property of properties) {
      const writers = workflows.filter(
        (wf) => wf.objectType === target.objectType && wf.steps.some((s) => s.writes.includes(property)),
      )
      if (writers.length > 0 && writers.every((w) => !w.enabled)) {
        findings.push({
          id: `broken-${target.id}-${property}`,
          severity: 'medium',
          category: 'broken-cascade',
          title: `“${target.name}” may never enroll from automation`,
          detail: `Its trigger reads ${property}, but the only workflow(s) that set ${property} (${writers.map((w) => w.name).join(', ')}) are turned off.`,
          workflowIds: [target.id, ...writers.map((w) => w.id)],
          property,
        })
      }
    }
  }

  // 4. Dead writes: a property is written somewhere but never read anywhere.
  const allReads = new Set<string>()
  for (const wf of workflows) for (const s of wf.steps) for (const p of s.reads) allReads.add(`${wf.objectType}:${p}`)
  for (const [key, ids] of writeMap) {
    if (!allReads.has(key)) {
      const property = key.split(':').slice(1).join(':')
      findings.push({
        id: `dead-${key}`,
        severity: 'low',
        category: 'dead-write',
        title: `${property} is set but never used in any workflow`,
        detail: `Written by ${[...ids].map(name).join(', ')} but no workflow reads it in a trigger or branch. It may still be used outside workflows — worth confirming.`,
        workflowIds: [...ids],
        property,
      })
    }
  }

  // 5. Overlapping triggers: same object + identical trigger property set.
  const triggerGroups = new Map<string, string[]>()
  for (const { workflow, properties } of triggerRows(workflows)) {
    if (!properties.length) continue
    const key = `${workflow.objectType}|${[...properties].sort().join(',')}`
    triggerGroups.set(key, [...(triggerGroups.get(key) ?? []), workflow.id])
  }
  for (const [key, ids] of triggerGroups) {
    if (ids.length >= 2) {
      const props = key.split('|')[1]
      findings.push({
        id: `overlap-${key}`,
        severity: 'low',
        category: 'overlapping-triggers',
        title: `${ids.length} workflows share the same trigger`,
        detail: `${ids.map(name).join(', ')} all enroll on ${props}. Contacts enter all of them together — confirm that's intended.`,
        workflowIds: ids,
        property: props,
      })
    }
  }

  // 6. Empty workflows: a trigger but no actions.
  for (const wf of workflows) {
    const actions = wf.steps.filter((s) => s.kind !== 'trigger')
    if (actions.length === 0) {
      findings.push({
        id: `empty-${wf.id}`,
        severity: 'low',
        category: 'empty-workflow',
        title: `“${wf.name}” has no actions`,
        detail: 'It has an enrollment trigger but does nothing once enrolled.',
        workflowIds: [wf.id],
      })
    }
  }

  return findings.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.category.localeCompare(b.category),
  )
}

export function severityCounts(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 }
  for (const f of findings) counts[f.severity] += 1
  return counts
}
