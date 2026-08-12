import { useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Workflow, StepKind, WorkflowStep } from '../types'
import { layoutWorkflow, NODE_SIZE } from '../lib/layout'

const KIND_META: Record<StepKind, { label: string; color: string; icon: string }> = {
  trigger: { label: 'Trigger', color: '#0ea5e9', icon: '⚡' },
  branch: { label: 'Branch', color: '#a855f7', icon: '⑃' },
  action: { label: 'Action', color: '#334155', icon: '▶' },
  setproperty: { label: 'Set property', color: '#f59e0b', icon: '✎' },
  delay: { label: 'Delay', color: '#64748b', icon: '⏱' },
  goto: { label: 'Go to', color: '#0d9488', icon: '↺' },
  end: { label: 'End', color: '#ef4444', icon: '■' },
}

type StepNodeData = { step: WorkflowStep; highlight?: string | null }

function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const { step, highlight } = data
  const meta = KIND_META[step.kind]
  const refs = [...step.reads, ...step.writes]
  const isHighlighted = highlight ? refs.includes(highlight) : false
  return (
    <div
      className="step-node"
      style={{
        width: NODE_SIZE.width,
        borderColor: meta.color,
        boxShadow: isHighlighted ? `0 0 0 3px ${meta.color}` : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="step-node__header" style={{ background: meta.color }}>
        <span className="step-node__icon">{meta.icon}</span>
        <span className="step-node__kind">{meta.label}</span>
      </div>
      <div className="step-node__body">
        <div className="step-node__title">{step.title}</div>
        {step.detail && <div className="step-node__detail">{step.detail}</div>}
        {refs.length > 0 && (
          <div className="step-node__props">
            {step.reads.map((p) => (
              <span key={`r-${p}`} className={`chip chip--read${highlight === p ? ' chip--on' : ''}`}>
                {p}
              </span>
            ))}
            {step.writes.map((p) => (
              <span key={`w-${p}`} className={`chip chip--write${highlight === p ? ' chip--on' : ''}`}>
                {p}
              </span>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const nodeTypes = { step: StepNode }

export function WorkflowFlow({
  workflow,
  highlightProperty,
}: {
  workflow: Workflow
  highlightProperty?: string | null
}) {
  const { nodes, edges } = useMemo(() => {
    const { nodes: positioned } = layoutWorkflow(workflow)
    const rfNodes: Node<StepNodeData>[] = positioned.map((p) => ({
      id: p.step.id,
      type: 'step',
      position: { x: p.x, y: p.y },
      data: { step: p.step, highlight: highlightProperty },
      draggable: true,
    }))
    const rfEdges: Edge[] = workflow.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: workflow.enabled,
      style: { stroke: '#94a3b8', strokeWidth: 1.5 },
      labelStyle: { fill: '#475569', fontWeight: 600, fontSize: 11 },
      labelBgStyle: { fill: '#f1f5f9' },
    }))
    return { nodes: rfNodes, edges: rfEdges }
  }, [workflow, highlightProperty])

  return (
    <div className="flow-canvas">
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
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => KIND_META[(n.data as StepNodeData).step.kind]?.color ?? '#334155'}
        />
      </ReactFlow>
    </div>
  )
}

export { KIND_META }
