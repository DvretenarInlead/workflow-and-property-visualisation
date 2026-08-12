import type { Workflow, WorkflowStep } from '../types'

export interface PositionedNode {
  step: WorkflowStep
  x: number
  y: number
}

const NODE_W = 240
const NODE_H = 92
const GAP_X = 70
const GAP_Y = 60

/**
 * Simple layered (Sugiyama-lite) layout. Each node's depth is the longest path
 * from the trigger; nodes at the same depth are spread horizontally. Good enough
 * for the mostly-linear-with-branches shape of HubSpot workflows and avoids a
 * heavyweight layout dependency.
 */
export function layoutWorkflow(wf: Workflow): {
  nodes: PositionedNode[]
  width: number
  height: number
} {
  const byId = new Map(wf.steps.map((s) => [s.id, s]))
  const children = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const s of wf.steps) indegree.set(s.id, 0)
  for (const e of wf.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue
    children.set(e.source, [...(children.get(e.source) ?? []), e.target])
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1)
  }

  // Longest-path depth via topological relaxation over reachable nodes.
  const depth = new Map<string, number>()
  const roots = wf.steps.filter((s) => (indegree.get(s.id) ?? 0) === 0).map((s) => s.id)
  const queue = [...(roots.length ? roots : wf.steps.slice(0, 1).map((s) => s.id))]
  for (const r of queue) depth.set(r, 0)
  const seen = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const d = depth.get(id) ?? 0
    for (const c of children.get(id) ?? []) {
      depth.set(c, Math.max(depth.get(c) ?? 0, d + 1))
      queue.push(c)
    }
  }
  // Any node not reached (disconnected) gets stacked at the end.
  let maxDepth = 0
  for (const v of depth.values()) maxDepth = Math.max(maxDepth, v)
  for (const s of wf.steps) {
    if (!depth.has(s.id)) depth.set(s.id, ++maxDepth)
  }

  // Group by depth, order stably by original step order.
  const levels = new Map<number, string[]>()
  for (const s of wf.steps) {
    const d = depth.get(s.id)!
    levels.set(d, [...(levels.get(d) ?? []), s.id])
  }

  const nodes: PositionedNode[] = []
  let maxCols = 0
  const sortedDepths = [...levels.keys()].sort((a, b) => a - b)
  for (const d of sortedDepths) {
    const ids = levels.get(d)!
    maxCols = Math.max(maxCols, ids.length)
    ids.forEach((id, i) => {
      const rowWidth = ids.length * NODE_W + (ids.length - 1) * GAP_X
      const startX = -rowWidth / 2 + NODE_W / 2
      nodes.push({
        step: byId.get(id)!,
        x: startX + i * (NODE_W + GAP_X),
        y: d * (NODE_H + GAP_Y),
      })
    })
  }

  const width = maxCols * NODE_W + (maxCols - 1) * GAP_X
  const height = (sortedDepths.length) * (NODE_H + GAP_Y)
  return { nodes, width, height }
}

export const NODE_SIZE = { width: NODE_W, height: NODE_H }
