import { useState } from 'react'
import type { PortalSummary } from '../lib/data'
import { disconnectPortal, logout } from '../lib/data'

/**
 * Portal switcher + management. Each "Connect another portal" is a separate
 * HubSpot OAuth authorization, where you choose which HubSpot account to grant —
 * that's how multiple portals (with independent tokens) are created.
 */
export function PortalMenu({
  portals,
  portalId,
  onSwitch,
}: {
  portals: PortalSummary[]
  portalId: string | null
  onSwitch: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const current = portals.find((p) => p.id === portalId)

  async function disconnect() {
    if (!current) return
    if (!confirm(`Disconnect “${current.name}”? Its stored token and cached data are removed.`)) return
    setBusy(true)
    try {
      await disconnectPortal(current.id)
      window.location.reload()
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e))
      setBusy(false)
    }
  }

  return (
    <div className="portal-menu">
      <button className="portal-menu__button" onClick={() => setOpen((o) => !o)}>
        <span className="portal-menu__label">{current?.name ?? 'Select portal'}</span>
        <span className="portal-menu__caret">▾</span>
      </button>

      {open && (
        <>
          <div className="portal-menu__backdrop" onClick={() => setOpen(false)} />
          <div className="portal-menu__dropdown">
            <div className="portal-menu__section-title">
              Portals ({portals.length})
            </div>
            <ul className="portal-menu__list">
              {portals.map((p) => (
                <li key={p.id}>
                  <button
                    className={`portal-menu__item ${p.id === portalId ? 'portal-menu__item--on' : ''}`}
                    onClick={() => { onSwitch(p.id); setOpen(false) }}
                  >
                    <span className="portal-menu__item-name">{p.name}</span>
                    {p.lastSynced && (
                      <span className="portal-menu__item-sub">synced {new Date(p.lastSynced).toLocaleDateString()}</span>
                    )}
                    {p.id === portalId && <span className="portal-menu__check">✓</span>}
                  </button>
                </li>
              ))}
              {portals.length === 0 && <li className="portal-menu__empty">No portals yet.</li>}
            </ul>

            <div className="portal-menu__divider" />
            {/* Full navigation so the browser follows the OAuth redirect. */}
            <a className="portal-menu__action" href="/auth/hubspot">
              ＋ Connect another portal
              <span className="portal-menu__hint">You’ll pick which HubSpot account to authorize.</span>
            </a>
            {current && (
              <button className="portal-menu__action portal-menu__action--danger" onClick={disconnect} disabled={busy}>
                Disconnect “{current.name}”
              </button>
            )}
            <button className="portal-menu__action" onClick={() => logout().then(() => window.location.reload())}>
              Log out
            </button>
          </div>
        </>
      )}
    </div>
  )
}
