// Shared HubSpot pull + normalisation, used by both the CLI script
// (scripts/fetch-workflows.mjs) and the server's /api/refresh endpoint.

const OBJECT_TYPE_LABELS = {
  '0-1': 'contact',
  '0-2': 'company',
  '0-3': 'deal',
  '0-5': 'ticket',
  CONTACT: 'contact',
  COMPANY: 'company',
  DEAL: 'deal',
  TICKET: 'ticket',
}

function objectTypeLabel(v) {
  if (!v) return 'contact'
  return OBJECT_TYPE_LABELS[v] || String(v).toLowerCase()
}

/** Recursively collect property names referenced anywhere in a HubSpot object. */
function collectProperties(node, acc = new Set()) {
  if (!node || typeof node !== 'object') return acc
  if (Array.isArray(node)) {
    for (const item of node) collectProperties(item, acc)
    return acc
  }
  for (const [key, value] of Object.entries(node)) {
    if (
      (key === 'property' || key === 'propertyName' || key === 'targetProperty') &&
      typeof value === 'string'
    ) {
      acc.add(value)
    }
    if (value && typeof value === 'object') collectProperties(value, acc)
  }
  return acc
}

const WRITE_ACTION_HINT = /SET_.*PROPERTY|SET_PROPERTY|PROPERTY_UPDATE/i
const DELAY_HINT = /DELAY|TIME|WAIT/i
const BRANCH_HINT = /BRANCH|IF_ELSE|LIST_BRANCH|CONDITION/i
const GOTO_HINT = /GO_TO|GOTO|JUMP/i

function classify(actionType = '') {
  if (WRITE_ACTION_HINT.test(actionType)) return 'setproperty'
  if (DELAY_HINT.test(actionType)) return 'delay'
  if (BRANCH_HINT.test(actionType)) return 'branch'
  if (GOTO_HINT.test(actionType)) return 'goto'
  return 'action'
}

function titleFor(actionType, kind) {
  if (actionType) {
    return String(actionType)
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

/** Normalise a single HubSpot workflow (v3 or v4 shape) into our schema. */
export function normaliseWorkflow(raw) {
  const objectType = objectTypeLabel(raw.objectTypeId || raw.type || raw.objectType)
  const enabled = raw.isEnabled ?? raw.enabled ?? false
  const steps = []
  const edges = []

  const enrollment = raw.enrollmentCriteria || raw.segmentCriteria || raw.goalCriteria
  const triggerReads = [...collectProperties(enrollment)]
  const triggerId = 'trigger'
  steps.push({
    id: triggerId,
    kind: 'trigger',
    actionType: 'ENROLLMENT',
    title: 'Enrollment trigger',
    detail: raw.enrollmentCriteria?.type || raw.type || 'Enrollment criteria',
    reads: triggerReads,
    writes: [],
  })

  const rawActions = raw.actions || []
  let prevId = triggerId
  for (let i = 0; i < rawActions.length; i++) {
    const a = rawActions[i]
    const actionType = a.actionType || a.type || a.actionTypeId || ''
    const kind = classify(String(actionType))
    const id = String(a.actionId ?? a.id ?? `action-${i}`)
    const refs = [...collectProperties(a)]
    steps.push({
      id,
      kind,
      actionType: String(actionType) || undefined,
      title: titleFor(actionType, kind),
      detail: a.name || a.fields?.subject?.value || undefined,
      reads: kind === 'setproperty' ? [] : refs,
      writes: kind === 'setproperty' ? refs : [],
    })
    edges.push({ id: `e-${prevId}-${id}`, source: prevId, target: id })
    prevId = id
  }

  const usage = new Map()
  for (const step of steps) {
    for (const name of step.reads) {
      const u = usage.get(name) || { name, objectType, reads: 0, writes: 0, steps: [] }
      u.reads += 1
      u.steps.push(step.id)
      usage.set(name, u)
    }
    for (const name of step.writes) {
      const u = usage.get(name) || { name, objectType, reads: 0, writes: 0, steps: [] }
      u.writes += 1
      u.steps.push(step.id)
      usage.set(name, u)
    }
  }

  return {
    id: String(raw.id ?? raw.flowId ?? raw.migrationStatus?.flowId ?? globalThis.crypto.randomUUID()),
    name: raw.name || 'Untitled workflow',
    type: String(raw.type || raw.flowType || 'WORKFLOW'),
    objectType,
    enabled: Boolean(enabled),
    updatedAt: raw.updatedAt || raw.updated || undefined,
    steps,
    edges,
    properties: [...usage.values()],
  }
}

/**
 * Pull all v4 flows from HubSpot and return a normalised dataset.
 * Throws on auth/API failure so the caller can surface a useful message.
 */
export async function fetchDataset({ token, base = 'https://api.hubapi.com' } = {}) {
  if (!token) throw new Error('Missing HubSpot token')

  async function api(path) {
    const res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HubSpot ${res.status} ${res.statusText} for ${path} ${body.slice(0, 300)}`)
    }
    return res.json()
  }

  const results = []
  let after
  do {
    const q = after ? `?after=${encodeURIComponent(after)}&limit=100` : `?limit=100`
    const page = await api(`/automation/v4/flows${q}`)
    results.push(...(page.results || []))
    after = page.paging?.next?.after
  } while (after)

  return {
    generatedAt: new Date().toISOString(),
    source: 'live',
    workflows: results.map(normaliseWorkflow),
  }
}
