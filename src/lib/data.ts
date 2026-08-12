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
  pipelines?: number
}

/** Trigger a live pull from HubSpot on the server (standalone mode). */
export async function refreshFromHubspot(): Promise<RefreshResult> {
  const res = await fetch('/api/refresh', { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Refresh failed (${res.status})`)
  return { count: body.count, generatedAt: body.generatedAt }
}

// ---- Portal mode ----

export interface PortalSummary {
  id: string
  hubId: string
  name: string
  lastSynced?: string
}

export interface SessionInfo {
  mode: 'standalone' | 'portal'
  authenticated?: boolean
  portals?: PortalSummary[]
}

/** Ask the server which mode to run in (and who's logged in). Static hosts → standalone. */
export async function getSession(): Promise<SessionInfo> {
  try {
    const res = await fetch('/api/session', { headers: { Accept: 'application/json' } })
    if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
      return (await res.json()) as SessionInfo
    }
  } catch {
    // no server
  }
  return { mode: 'standalone' }
}

export class NeedsSyncError extends Error {
  needsSync = true
}

/** Load one portal's cached dataset. Throws NeedsSyncError if it hasn't been synced yet. */
export async function loadPortalDataset(portalId: string): Promise<WorkflowDataset> {
  const res = await fetch(`/api/portals/${portalId}/data`, { headers: { Accept: 'application/json' } })
  if (res.status === 404) throw new NeedsSyncError('This portal has no data yet.')
  if (!res.ok) throw new Error(`Failed to load portal data (${res.status})`)
  return (await res.json()) as WorkflowDataset
}

/** Pull fresh workflows + pipelines for a portal from HubSpot. */
export async function refreshPortal(portalId: string): Promise<RefreshResult> {
  const res = await fetch(`/api/portals/${portalId}/refresh`, { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Refresh failed (${res.status})`)
  return { count: body.count, generatedAt: body.generatedAt, pipelines: body.pipelines }
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {})
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
