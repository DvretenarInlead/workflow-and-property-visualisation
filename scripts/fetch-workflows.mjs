#!/usr/bin/env node
/**
 * Pull HubSpot workflows and the CRM properties they use, then write a
 * normalised dataset to public/data/workflows.json (consumed by the app).
 *
 * Usage:
 *   HUBSPOT_TOKEN=pat-na1-... node scripts/fetch-workflows.mjs
 *   npm run fetch
 *
 * The normaliser is intentionally defensive: HubSpot's automation payloads vary
 * by portal, workflow age (v3 vs v4) and action type. Unknown shapes degrade to
 * a labelled generic step rather than throwing, and every property reference we
 * can find is captured. Refine the mappers against your real payloads as needed.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'public', 'data', 'workflows.json')

const TOKEN = process.env.HUBSPOT_TOKEN
const BASE = process.env.HUBSPOT_API_BASE || 'https://api.hubapi.com'

if (!TOKEN) {
  console.error('Missing HUBSPOT_TOKEN. Copy .env.example to .env and set your private-app token.')
  console.error('The app still runs against the committed sample data without this.')
  process.exit(1)
}

async function api(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HubSpot ${res.status} ${res.statusText} for ${path}\n${body.slice(0, 500)}`)
  }
  return res.json()
}

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

/**
 * Recursively collect property names referenced anywhere in an arbitrary
 * HubSpot object (filters, criteria, action fields). HubSpot uses several key
 * names for the property identifier depending on API version and action type.
 */
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

function titleFor(action, kind) {
  if (action.actionType) {
    const nice = String(action.actionType)
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
    return nice
  }
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

/** Normalise a single HubSpot workflow (v3 or v4 shape) into our schema. */
function normaliseWorkflow(raw) {
  const objectType = objectTypeLabel(raw.objectTypeId || raw.type || raw.objectType)
  const enabled = raw.isEnabled ?? raw.enabled ?? false
  const steps = []
  const edges = []

  // --- Trigger / enrollment step ---
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

  // --- Actions ---
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
      title: titleFor({ actionType }, kind),
      detail: a.name || a.fields?.subject?.value || undefined,
      reads: kind === 'setproperty' ? [] : refs,
      writes: kind === 'setproperty' ? refs : [],
    })

    // Edge from previous step. Branch actions may have explicit connections.
    const conn = a.connection
    if (conn?.nextActionId) {
      edges.push({ id: `e-${prevId}-${id}`, source: prevId, target: id })
    } else {
      edges.push({ id: `e-${prevId}-${id}`, source: prevId, target: id })
    }
    prevId = id
  }

  // --- Property usage rollup ---
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
    id: String(raw.id ?? raw.flowId ?? raw.migrationStatus?.flowId ?? crypto.randomUUID()),
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

async function listFlowsV4() {
  const out = []
  let after
  do {
    const q = after ? `?after=${encodeURIComponent(after)}&limit=100` : `?limit=100`
    const page = await api(`/automation/v4/flows${q}`)
    out.push(...(page.results || []))
    after = page.paging?.next?.after
  } while (after)
  return out
}

async function main() {
  console.log('Fetching HubSpot flows (v4)...')
  let raws = []
  try {
    raws = await listFlowsV4()
  } catch (err) {
    console.error('v4 flows endpoint failed, the token may lack the automation scope.')
    throw err
  }

  const workflows = raws.map(normaliseWorkflow)

  const dataset = {
    generatedAt: new Date().toISOString(),
    source: 'live',
    workflows,
  }

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(dataset, null, 2))
  console.log(`Wrote ${workflows.length} workflows to ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
