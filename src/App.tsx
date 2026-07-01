import { useEffect, useMemo, useState } from 'react'
import type { WorkflowDataset } from './types'
import { loadDataset, propertiesAcrossWorkflows, datasetStats } from './lib/data'
import { Overview } from './components/Overview'
import { PropertyMap } from './components/PropertyMap'
import { WorkflowFlow, KIND_META } from './components/WorkflowFlow'

type Tab = 'overview' | 'flow' | 'properties'

export function App() {
  const [dataset, setDataset] = useState<WorkflowDataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)

  useEffect(() => {
    loadDataset().then(setDataset).catch((e) => setError(String(e)))
  }, [])

  const workflows = dataset?.workflows ?? []
  const properties = useMemo(() => propertiesAcrossWorkflows(workflows), [workflows])
  const stats = useMemo(() => datasetStats(workflows, properties), [workflows, properties])
  const selected = workflows.find((w) => w.id === selectedId) ?? workflows[0]

  useEffect(() => {
    if (!selectedId && workflows.length) setSelectedId(workflows[0].id)
  }, [workflows, selectedId])

  function openWorkflow(id: string, property?: string) {
    setSelectedId(id)
    setHighlight(property ?? null)
    setTab('flow')
  }

  function openProperty(name: string) {
    setHighlight(name)
    setTab('properties')
  }

  if (error) {
    return (
      <div className="app">
        <div className="empty">
          <h1>Couldn’t load workflow data</h1>
          <pre>{error}</pre>
          <p>Run <code>npm run fetch</code> with a HubSpot token, or restore <code>public/data/workflows.sample.json</code>.</p>
        </div>
      </div>
    )
  }

  if (!dataset) {
    return <div className="app"><div className="empty"><h1>Loading…</h1></div></div>
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo">⧉</span>
          <div>
            <div className="topbar__title">HubSpot Workflow &amp; Property Visualiser</div>
            <div className="topbar__sub">
              {dataset.source === 'live' ? 'Live data' : 'Sample data'} · generated{' '}
              {new Date(dataset.generatedAt).toLocaleString()}
            </div>
          </div>
        </div>
        <nav className="tabs">
          <button className={tab === 'overview' ? 'tab tab--on' : 'tab'} onClick={() => setTab('overview')}>
            Overview
          </button>
          <button className={tab === 'flow' ? 'tab tab--on' : 'tab'} onClick={() => setTab('flow')}>
            Workflow flow
          </button>
          <button className={tab === 'properties' ? 'tab tab--on' : 'tab'} onClick={() => setTab('properties')}>
            Property map
          </button>
        </nav>
      </header>

      <main className="main">
        {tab === 'overview' && (
          <Overview
            workflows={workflows}
            properties={properties}
            stats={stats}
            onOpenWorkflow={(id) => openWorkflow(id)}
            onOpenProperty={openProperty}
          />
        )}

        {tab === 'flow' && selected && (
          <div className="flow-view">
            <aside className="flow-sidebar">
              <div className="flow-sidebar__section">
                <label className="field-label">Workflow</label>
                <select
                  className="input"
                  value={selected.id}
                  onChange={(e) => {
                    setSelectedId(e.target.value)
                    setHighlight(null)
                  }}
                >
                  {workflows.map((wf) => (
                    <option key={wf.id} value={wf.id}>
                      {wf.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flow-sidebar__meta">
                <span className="tag">{selected.objectType}</span>
                <span className={`status ${selected.enabled ? 'status--on' : 'status--off'}`}>
                  {selected.enabled ? 'Enabled' : 'Off'}
                </span>
                <span className="muted">{selected.steps.length} steps</span>
              </div>

              <div className="flow-sidebar__section">
                <label className="field-label">Highlight property</label>
                <select
                  className="input"
                  value={highlight ?? ''}
                  onChange={(e) => setHighlight(e.target.value || null)}
                >
                  <option value="">None</option>
                  {selected.properties.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} ({p.reads}R/{p.writes}W)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flow-sidebar__section">
                <label className="field-label">Legend</label>
                <ul className="kind-legend">
                  {Object.entries(KIND_META).map(([k, m]) => (
                    <li key={k}>
                      <span className="kind-legend__swatch" style={{ background: m.color }} />
                      {m.label}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flow-sidebar__section">
                <label className="field-label">Properties used</label>
                <ul className="side-props">
                  {selected.properties.map((p) => (
                    <li
                      key={p.name}
                      className={highlight === p.name ? 'side-props__item side-props__item--on' : 'side-props__item'}
                      onClick={() => setHighlight(highlight === p.name ? null : p.name)}
                    >
                      <span className="side-props__name">{p.name}</span>
                      <span className="side-props__badges">
                        {p.reads > 0 && <span className="chip chip--read">{p.reads}R</span>}
                        {p.writes > 0 && <span className="chip chip--write">{p.writes}W</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>

            <WorkflowFlow workflow={selected} highlightProperty={highlight} />
          </div>
        )}

        {tab === 'properties' && (
          <PropertyMap
            workflows={workflows}
            properties={properties}
            onSelectWorkflow={(id, property) => openWorkflow(id, property)}
          />
        )}
      </main>
    </div>
  )
}
