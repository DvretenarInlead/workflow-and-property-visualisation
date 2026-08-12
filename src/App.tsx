import { useEffect, useMemo, useState } from 'react'
import type { WorkflowDataset } from './types'
import {
  loadDataset,
  refreshFromHubspot,
  propertiesAcrossWorkflows,
  datasetStats,
  getSession,
  loadPortalDataset,
  refreshPortal,
  logout,
  NeedsSyncError,
  type SessionInfo,
} from './lib/data'
import { Overview } from './components/Overview'
import { PropertyMap } from './components/PropertyMap'
import { PropertyLookup } from './components/PropertyLookup'
import { Reports } from './components/Reports'
import { Audit } from './components/Audit'
import { TriggerExplorer } from './components/TriggerExplorer'
import { ChainMap } from './components/ChainMap'
import { Pipelines } from './components/Pipelines'
import { Chat } from './components/Chat'
import { Logs } from './components/Logs'
import { Login } from './components/Login'
import { WorkflowFlow, KIND_META } from './components/WorkflowFlow'

type Tab =
  | 'overview'
  | 'audit'
  | 'triggers'
  | 'chains'
  | 'pipelines'
  | 'reports'
  | 'flow'
  | 'properties'
  | 'lookup'
  | 'chat'
  | 'logs'

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [portalId, setPortalId] = useState<string | null>(null)
  const [dataset, setDataset] = useState<WorkflowDataset | null>(null)
  const [needsSync, setNeedsSync] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)

  const isPortal = session?.mode === 'portal'

  // Resolve mode + initial data.
  useEffect(() => {
    getSession().then((s) => {
      setSession(s)
      if (s.mode === 'standalone') {
        loadDataset().then(setDataset).catch((e) => setError(String(e)))
      } else if (s.authenticated && s.portals?.length) {
        setPortalId(s.portals[0].id)
      }
    })
  }, [])

  // Load the selected portal's dataset.
  useEffect(() => {
    if (!portalId) return
    setDataset(null)
    setNeedsSync(false)
    setError(null)
    loadPortalDataset(portalId)
      .then(setDataset)
      .catch((e) => {
        if (e instanceof NeedsSyncError) setNeedsSync(true)
        else setError(String(e))
      })
  }, [portalId])

  async function refresh() {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      if (isPortal && portalId) {
        const { count, pipelines } = await refreshPortal(portalId)
        const fresh = await loadPortalDataset(portalId)
        setDataset(fresh)
        setNeedsSync(false)
        setRefreshMsg(`Pulled ${count} workflows${pipelines ? ` · ${pipelines} pipelines` : ''}.`)
      } else {
        const { count } = await refreshFromHubspot()
        const fresh = await loadDataset()
        setDataset(fresh)
        setRefreshMsg(`Pulled ${count} workflows from HubSpot.`)
      }
    } catch (e) {
      setRefreshMsg(String(e instanceof Error ? e.message : e))
    } finally {
      setRefreshing(false)
    }
  }

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

  if (!session) {
    return <div className="app"><div className="empty"><h1>Loading…</h1></div></div>
  }

  if (isPortal && !session.authenticated) {
    return <Login />
  }

  if (error) {
    return (
      <div className="app">
        <div className="empty">
          <h1>Couldn’t load workflow data</h1>
          <pre>{error}</pre>
          <p>
            {isPortal
              ? 'Try refreshing the portal, or reconnect it.'
              : 'Run `npm run fetch` with a HubSpot token, or restore the sample file.'}
          </p>
        </div>
      </div>
    )
  }

  if (!dataset && !needsSync) {
    return <div className="app"><div className="empty"><h1>Loading…</h1></div></div>
  }

  const portals = session.portals ?? []

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo">⧉</span>
          <div>
            <div className="topbar__title">HubSpot Workflow &amp; Property Visualiser</div>
            <div className="topbar__sub">
              {dataset ? (
                <>
                  <span className={`source-dot ${dataset.source === 'live' ? 'source-dot--live' : 'source-dot--sample'}`} />
                  {dataset.source === 'live' ? 'Live data' : 'Sample data'} · generated{' '}
                  {new Date(dataset.generatedAt).toLocaleString()}
                </>
              ) : (
                <>
                  <span className="source-dot source-dot--sample" /> Not synced yet
                </>
              )}
            </div>
          </div>
          {isPortal && (
            <div className="portal-bar">
              <select
                className="input input--sm"
                value={portalId ?? ''}
                onChange={(e) => setPortalId(e.target.value)}
              >
                {portals.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <a className="btn btn--sm" href="/auth/hubspot" title="Connect another portal">+ Portal</a>
              <button className="btn btn--sm" onClick={() => logout().then(() => window.location.reload())}>
                Log out
              </button>
            </div>
          )}
          <div className="topbar__refresh">
            <button className="btn btn--primary btn--sm" onClick={refresh} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : '↻ Refresh from HubSpot'}
            </button>
            {refreshMsg && <span className="topbar__refresh-msg">{refreshMsg}</span>}
          </div>
        </div>
        <nav className="tabs">
          <button className={tab === 'overview' ? 'tab tab--on' : 'tab'} onClick={() => setTab('overview')}>
            Overview
          </button>
          <button className={tab === 'audit' ? 'tab tab--on' : 'tab'} onClick={() => setTab('audit')}>
            Audit
          </button>
          <button className={tab === 'triggers' ? 'tab tab--on' : 'tab'} onClick={() => setTab('triggers')}>
            Triggers
          </button>
          <button className={tab === 'chains' ? 'tab tab--on' : 'tab'} onClick={() => setTab('chains')}>
            Chains
          </button>
          <button className={tab === 'pipelines' ? 'tab tab--on' : 'tab'} onClick={() => setTab('pipelines')}>
            Pipelines
          </button>
          <button className={tab === 'reports' ? 'tab tab--on' : 'tab'} onClick={() => setTab('reports')}>
            Reports
          </button>
          <button className={tab === 'flow' ? 'tab tab--on' : 'tab'} onClick={() => setTab('flow')}>
            Workflow flow
          </button>
          <button className={tab === 'properties' ? 'tab tab--on' : 'tab'} onClick={() => setTab('properties')}>
            Property map
          </button>
          <button className={tab === 'lookup' ? 'tab tab--on' : 'tab'} onClick={() => setTab('lookup')}>
            Property lookup
          </button>
          <button className={tab === 'chat' ? 'tab tab--on' : 'tab'} onClick={() => setTab('chat')}>
            Ask AI
          </button>
          <button className={tab === 'logs' ? 'tab tab--on' : 'tab'} onClick={() => setTab('logs')}>
            Logs
          </button>
        </nav>
      </header>

      <main className="main">
        {needsSync ? (
          <div className="empty">
            <h2>“{portals.find((p) => p.id === portalId)?.name ?? 'This portal'}” hasn’t been synced yet</h2>
            <p className="muted">Pull its workflows and pipelines from HubSpot to get started.</p>
            <button className="btn btn--primary" onClick={refresh} disabled={refreshing}>
              {refreshing ? 'Syncing…' : '↻ Sync now'}
            </button>
            {refreshMsg && <p className="muted">{refreshMsg}</p>}
          </div>
        ) : (
         <>
        {tab === 'overview' && (
          <Overview
            workflows={workflows}
            properties={properties}
            stats={stats}
            onOpenWorkflow={(id) => openWorkflow(id)}
            onOpenProperty={openProperty}
          />
        )}

        {tab === 'reports' && (
          <Reports
            workflows={workflows}
            properties={properties}
            onOpenWorkflow={(id) => openWorkflow(id)}
            onOpenProperty={openProperty}
          />
        )}

        {tab === 'audit' && (
          <Audit workflows={workflows} onOpenWorkflow={(id, property) => openWorkflow(id, property ?? undefined)} />
        )}

        {tab === 'triggers' && (
          <TriggerExplorer workflows={workflows} onOpenWorkflow={(id, property) => openWorkflow(id, property)} />
        )}

        {tab === 'chains' && <ChainMap workflows={workflows} onOpenWorkflow={(id) => openWorkflow(id)} />}

        {tab === 'pipelines' && (
          <Pipelines
            pipelines={dataset?.pipelines ?? []}
            workflows={workflows}
            onOpenWorkflow={(id, property) => openWorkflow(id, property)}
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

        {tab === 'lookup' && (
          <PropertyLookup
            workflows={workflows}
            properties={properties}
            initialProperty={highlight}
            onOpenWorkflow={(id, property) => openWorkflow(id, property)}
          />
        )}

        {tab === 'chat' && <Chat portalId={isPortal ? portalId : null} />}

        {tab === 'logs' && <Logs />}
         </>
        )}
      </main>
    </div>
  )
}
