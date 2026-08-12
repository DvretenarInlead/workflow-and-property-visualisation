import type {
  Workflow,
  WorkflowDataset,
  PropertyAcrossWorkflows,
} from '../types'

/**
 * Load the workflow dataset. Prefers a live pull (workflows.json written by
 * `npm run fetch`) and falls back to the committed sample data.
 */
export async function loadDataset(): Promise<WorkflowDataset> {
  const base = import.meta.env.BASE_URL
  for (const file of ['data/workflows.json', 'data/workflows.sample.json']) {
    try {
      const res = await fetch(`${base}${file}`)
      if (res.ok) return (await res.json()) as WorkflowDataset
    } catch {
      // try next
    }
  }
  throw new Error('No workflow data found. Run `npm run fetch` or restore the sample file.')
}

/** Aggregate property usage across every workflow in the dataset. */
export function propertiesAcrossWorkflows(
  workflows: Workflow[],
): PropertyAcrossWorkflows[] {
  const map = new Map<string, PropertyAcrossWorkflows>()
  for (const wf of workflows) {
    for (const p of wf.properties) {
      const key = `${p.objectType ?? ''}:${p.name}`
      const existing =
        map.get(key) ??
        {
          name: p.name,
          label: p.label,
          objectType: p.objectType,
          totalReads: 0,
          totalWrites: 0,
          workflowIds: [],
        }
      existing.totalReads += p.reads
      existing.totalWrites += p.writes
      if (!existing.workflowIds.includes(wf.id)) existing.workflowIds.push(wf.id)
      if (!existing.label && p.label) existing.label = p.label
      map.set(key, existing)
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      b.workflowIds.length - a.workflowIds.length ||
      b.totalReads + b.totalWrites - (a.totalReads + a.totalWrites) ||
      a.name.localeCompare(b.name),
  )
}

export interface DatasetStats {
  total: number
  enabled: number
  byObjectType: Record<string, number>
  uniqueProperties: number
  sharedProperties: number
}

export function datasetStats(
  workflows: Workflow[],
  props: PropertyAcrossWorkflows[],
): DatasetStats {
  const byObjectType: Record<string, number> = {}
  for (const wf of workflows) {
    byObjectType[wf.objectType] = (byObjectType[wf.objectType] ?? 0) + 1
  }
  return {
    total: workflows.length,
    enabled: workflows.filter((w) => w.enabled).length,
    byObjectType,
    uniqueProperties: props.length,
    sharedProperties: props.filter((p) => p.workflowIds.length > 1).length,
  }
}
