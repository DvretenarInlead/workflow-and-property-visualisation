/** Portal-mode landing screen: connect a HubSpot portal via OAuth. */
export function Login() {
  return (
    <div className="app">
      <div className="login">
        <div className="login__card">
          <span className="topbar__logo login__logo">⧉</span>
          <h1 className="login__title">HubSpot Workflow &amp; Property Visualiser</h1>
          <p className="login__sub">
            Connect a HubSpot portal to explore its workflows, properties, triggers, pipelines, and
            automation audit. Read-only — nothing is written back to HubSpot.
          </p>
          {/* Full navigation (not fetch) so the browser follows the OAuth redirect chain. */}
          <a className="btn btn--primary login__btn" href="/auth/hubspot">
            Connect HubSpot
          </a>
          <p className="login__note">
            You'll authorize the app in HubSpot and be returned here. You can connect more portals
            afterwards and switch between them.
          </p>
        </div>
      </div>
    </div>
  )
}
