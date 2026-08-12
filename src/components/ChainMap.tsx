import { useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Workflow } from '../types'
import { chainGraph } from '../lib/analysis'

type WfNodeData = { wf: Workflow; onOpen: (id: string) => void }

function WorkflowNode({ data }: NodeProps<Node<WfNodeData>>) {
  const { wf, onOpen } = data
  return (
    <div className="chain-node" onDoubleClick={() => onOpen(wf.id)} title="Double-click to open flow">
      <Handle type="target" position={Position.Left} />
      <div className="chain-node__name">{wf.name}</div>
      <div className="chain-node__meta">
        <span className="tag">{wf.objectType}</span>
        <span className={`dot ${wf.enabled ? 'dot--on' : 'dot--off'}`} />
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = { wf: WorkflowNode }

/** Longest-path column layout for a small DAG (cycle-safe via a visited guard). */
function layout(nodeIds: string[], edges: { source: string; target: string }[]) {
  const children = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  nodeIds.forEach((id) => indeg.set(id, 0))
  for (const e of edges) {
    if (e.source === e.target) continue
    children.set(e.source, [...(children.get(e.source) ?? []), e.target])
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
  }
  const depth = new Map<string, number>()
  const roots = nodeIds.filter((id) => (indeg.get(id) ?? 0) === 0)
  const queue = [...(roots.length ? roots : nodeIds.slice(0, 1))]
  queue.forEach((id) => depth.set(id, 0))
  const guard = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (guard.has(id)) continue
    guard.add(id)
    const d = depth.get(id) ?? 0
    for (const c of children.get(id) ?? []) {
      depth.set(c, Math.max(depth.get(c) ?? 0, d + 1))
      queue.push(c)
    }
  }
  let maxDepth = 0
  depth.forEach((v) => (maxDepth = Math.max(maxDepth, v)))
  nodeIds.forEach((id) => { if (!depth.has(id)) depth.set(id, ++maxDepth) })

  const cols = new Map<number, string[]>()
  nodeIds.forEach((id) => {
    const d = depth.get(id)!
    cols.set(d, [...(cols.get(d) ?? []), id])
  })
  const pos = new Map<string, { x: number; y: number }>()
  cols.forEach((ids, d) => {
    ids.forEach((id, i) => pos.set(id, { x: d * 300, y: i * 130 }))
  })
  return pos
}

export function ChainMap({
  workflows,
  onOpenWorkflow,
}: {
  workflows: Workflow[]
  onOpenWorkflow: (id: string) => void
}) {
  const { nodes, edges, empty } = useMemo(() => {
    const graph = chainGraph(workflows)
    const ids = [...graph.nodeIds]
    if (ids.length === 0) return { nodes: [], edges: [], empty: true }
    const byId = new Map(workflows.map((w) => [w.id, w]))
    const pos = layout(ids, graph.edges)

    const rfNodes: Node<WfNodeData>[] = ids.map((id) => ({
      id,
      type: 'wf',
      position: pos.get(id) ?? { x: 0, y: 0 },
      data: { wf: byId.get(id)!, onOpen: onOpenWorkflow },
    }))

    // Merge parallel edges (same pair) into one, combining property labels.
    const merged = new Map<string, { source: string; target: string; props: Set<string>; self: boolean }>()
    for (const e of graph.edges) {
      const key = `${e.source}->${e.target}`
      const m = merged.get(key) ?? { source: e.source, target: e.target, props: new Set(), self: e.selfLoop }
      m.props.add(e.property)
      merged.set(key, m)
    }
    const rfEdges: Edge[] = [...merged.values()].map((m) => ({
      id: `${m.source}->${m.target}`,
      source: m.source,
      target: m.target,
      label: [...m.props].join(', '),
      animated: !m.self,
      style: { stroke: m.self ? '#ef4444' : '#94a3b8', strokeWidth: 1.75 },
      labelStyle: { fill: '#475569', fontWeight: 600, fontSize: 11 },
      labelBgStyle: { fill: '#f1f5f9' },
      markerEnd: { type: MarkerType.ArrowClosed, color: m.self ? '#ef4444' : '#94a3b8' },
    }))
    return { nodes: rfNodes, edges: rfEdges, empty: false }
  }, [workflows, onOpenWorkflow])

  if (empty) {
    return (
      <div className="chain-empty">
        <div className="empty">
          <h2>No cascades found</h2>
          <p className="muted">
            No workflow writes a property that another workflow is triggered by. When one does,
            you'll see the write→enroll links here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="chain-view">
      <div className="chain-legend">
        <span className="chain-legend__item"><span className="chain-legend__line" /> A writes a property that enrolls B</span>
        <span className="chain-legend__item"><span className="chain-legend__line chain-legend__line--loop" /> self-loop (re-enrollment risk)</span>
        <span className="muted">Double-click a workflow to open its flow.</span>
      </div>
      <div className="chain-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} color="#e2e8f0" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}
