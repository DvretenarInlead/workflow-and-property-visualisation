import type {
  Workflow,
  WorkflowDataset,
  PropertyAcrossWorkflows,
} from '../types'

/**
 * Load the workflow dataset. Prefers the server endpoint (which reflects an
 * in-session "Refresh from HubSpot"), then a build-time pull, then the sample.
 * When hosted statically (no server) the /api/data call is ignored gracefully.
 */
export async function loadDataset(): Promise<WorkflowDataset> {
  // 1. Server endpoint — only trust it if it actually returns JSON (a static
  //    host answers /api/data with the SPA index.html, which we must skip).
  try {
    const res = await fetch('/api/data', { headers: { Accept: 'application/json' } })
    if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
      return (await res.json()) as WorkflowDataset
    }
  } catch {
    // no server — fall through to static files
  }

  // 2. Static files (build-time pull, then committed sample).
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

export interface RefreshResult {
  count: number
  generatedAt: string
}

/** Trigger a live pull from HubSpot on the server. Throws with the server message on failure. */
export async function refreshFromHubspot(): Promise<RefreshResult> {
  const res = await fetch('/api/refresh', { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Refresh failed (${res.status})`)
  return { count: body.count, generatedAt: body.generatedAt }
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
