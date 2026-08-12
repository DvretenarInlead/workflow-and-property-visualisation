# HubSpot Workflow & Property Visualiser

An interactive visualiser for **HubSpot workflows** and the **CRM properties they
use**. It answers the two questions that are painful in the HubSpot UI:

1. *What does this workflow actually do?* — a clean, colour-coded flow diagram of
   triggers, branches, actions, delays and property writes.
2. *Which workflows will break if I change this property?* — a cross-workflow
   property-usage matrix showing every read / write of every property.

Built with React + Vite + [React Flow](https://reactflow.dev/). Ships with sample
data so it runs with zero setup, and a fetch script that pulls your real workflows
from the HubSpot Automation API.

## Views

| View | What it shows |
| --- | --- |
| **Overview** | Counts, enabled/off status, workflows-per-object, most-used properties, plus how workflows are triggered (trigger-type mix and top enrollment properties). |
| **Audit** | Ranked findings across all workflows: trigger loops (infinite re-enrollment), write races (a property set by several workflows), broken cascades (an enabled workflow enrolled by a property only disabled workflows set), dead writes, overlapping triggers, and empty workflows. |
| **Triggers** | Trigger-first view: pick an enrollment property (e.g. `dealstage`) to see every workflow whose *trigger* uses it — grouped by object and type. |
| **Chains** | The write→enroll cascade graph: when one workflow writes a property that triggers another, an arrow links them. Shows how automation flows across the portal; self-loops are flagged red. |
| **Pipelines** | Deal & ticket pipelines with their stages (order, probability, open/closed), and the automation around each: which workflows read (enroll on) or write (move records through) the stage property. Requires a connected portal (pipelines aren't in the sample). |
| **Reports** | Four analytics charts: property impact (workflows depending on each property), reads vs writes by object, workflow complexity, and step-type mix. Colours use a colourblind-safe, validated palette; light & dark modes both supported. |
| **Workflow flow** | Per-workflow diagram (React Flow). Nodes are colour-coded by type (trigger / branch / action / set-property / delay / end). Pick a property to highlight everywhere it's touched. |
| **Property map** | A property × workflow matrix. Each cell is **R** (read), **W** (write) or **RW**. Filter by object type or "shared only", and click any cell to jump into that workflow with the property highlighted. |
| **Property lookup** | Type a property (e.g. `dealstage`) and CRM object to see every workflow that uses it and the exact steps that read or write it — the "what is each workflow doing with this property?" view. |
| **Ask AI** | A chat that answers questions about your workflows and property dependencies. Backed by the Claude API through a small server-side proxy (the API key never reaches the browser). |
| **Logs** | Every call the server makes to the HubSpot API (from the Refresh button) — time, endpoint, status, result, and duration. Auto-refreshes every 5s. |

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173  (uses bundled sample data)
```

To use the **Ask AI** chat locally, run the server too (in a second terminal) — the
dev server proxies `/api` to it:

```bash
cp .env.example .env         # set ANTHROPIC_API_KEY
set -a && source .env && set +a
npm run server               # http://localhost:8080
```

Build a static bundle and serve it with the app server (this is what production runs):

```bash
npm run build      # outputs to dist/
npm start          # Express serves dist/ + /api/chat on :8080
```

## Deploying to Digital Ocean App Platform

The app is a single Node web service: it builds the static bundle and serves it
alongside the chat proxy, so one component covers everything.

1. Push this branch to GitHub (already wired in `.do/app.yaml`).
2. Create the app:

   ```bash
   doctl apps create --spec .do/app.yaml
   ```

   or, in the DO dashboard: **Create → Apps → GitHub repo**, then set
   **Build command** `npm ci && npm run build`, **Run command** `npm start`,
   **HTTP port** `8080`.
3. Add the environment variable **`ANTHROPIC_API_KEY`** as an encrypted secret.
   (Optional: `ANTHROPIC_MODEL`, default `claude-opus-5`.)

The health check at `/api/health` returns the active model.

> **Why a server at all?** Everything except the chat is static and could be hosted
> as files. The chat calls the Claude API, and the API key must stay server-side —
> so `server/index.mjs` proxies `/api/chat`, injects your workflow data as context,
> and streams the reply back. The browser never sees the key.

## Using your real HubSpot data

1. In HubSpot, create a **Private App** (Settings → Integrations → Private Apps)
   with the `automation` (read) scope.
2. Copy the token:

   ```bash
   cp .env.example .env
   # edit .env and set HUBSPOT_TOKEN=pat-na1-...
   ```

3. **Actually run the pull** (setting the token alone does nothing):

   ```bash
   set -a && source .env && set +a
   npm run fetch      # prints "Wrote N workflows to …/public/data/workflows.json"
   npm run dev        # now shows your workflows
   ```

   This calls the HubSpot v4 flows API (`/automation/v4/flows`), normalises each
   workflow into the app's schema, and writes `public/data/workflows.json`. The
   app prefers this file over the sample automatically.

The fetched file is git-ignored so you don't commit portal data.

### Refreshing from inside the app (no rebuild)

When the app is served by its Node server (`npm start`, or on Digital Ocean), the
header has a **↻ Refresh from HubSpot** button. It calls `POST /api/refresh`, which
pulls live workflows using the server-side `HUBSPOT_TOKEN`, holds the result in
memory, and the app re-renders against it — no rebuild or redeploy. The **Logs** tab
shows each HubSpot call (status, workflow count, duration).

- Set `HUBSPOT_TOKEN` as a **run-time** secret (`scope: RUN_TIME` in `.do/app.yaml`,
  already configured) — it's read when the button is pressed, not at build time.
- The refreshed data lives in memory for that server instance and resets on restart
  or redeploy; press Refresh again to re-pull. (The token is never exposed to the
  browser — only the server calls HubSpot.)
- The server's environment must allow outbound HTTPS to `api.hubapi.com`. Digital
  Ocean App Platform allows outbound by default; a locked-down egress policy would
  need that host allowlisted.

> **Note:** `/api/refresh` is unauthenticated — anyone who can reach the app can
> trigger a pull. Fine for an internal tool; if the app is public, put it behind
> your own auth (or ask and I'll add a shared-secret gate).

### Still seeing only sample data?

The app falls back to the sample whenever no live data is present. To get live data:

- **In the app (any deploy with the server):** press **↻ Refresh from HubSpot** in
  the header. If it errors, check the **Logs** tab — a 401/403 there means the token
  is missing or lacks the `automation` read scope; "HUBSPOT_TOKEN is not set" means
  add it as a **run-time** secret on your host and restart.
- **Locally without the button:** run `npm run fetch` (step 3) to write
  `public/data/workflows.json`, then `npm run dev`.
- **On Digital Ocean:** set `HUBSPOT_TOKEN` as a secret (scope **Run time**), deploy,
  then press Refresh in the app. No rebuild needed to re-pull.

## Portal mode (multi-portal + HubSpot OAuth)

The app runs in one of two modes, chosen automatically by which env vars are set:

- **Standalone** (default) — one portal via a single `HUBSPOT_TOKEN`, no login. Everything above.
- **Portal mode** — users **Connect HubSpot** via OAuth; each portal is stored (with its
  token **encrypted at rest**) in Postgres and can be switched between. Adds the login
  screen, a portal switcher, and the Pipelines view. Activates when **all** of
  `DATABASE_URL`, `APP_SECRET`, `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, and
  `HUBSPOT_REDIRECT_URI` are set.

### Setting up portal mode

1. **Create a HubSpot public app** (Developer account → Apps → Create app → Auth tab):
   - **Redirect URL:** `https://<your-app>/auth/hubspot/callback` (must match `HUBSPOT_REDIRECT_URI` exactly).
   - **Scopes:** `oauth automation crm.objects.deals.read crm.objects.tickets.read`
     (automation → workflows; deals/tickets → pipelines). Copy the **Client ID** and **Client secret**.
2. **Provision Postgres** — on Digital Ocean the `databases` block in `.do/app.yaml` attaches a
   managed DB and binds `DATABASE_URL` automatically. Tables are created on boot.
3. **Set the env vars** (see `.env.example` / `.do/app.yaml`): `APP_SECRET` (long random),
   `DATABASE_URL`, `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, `HUBSPOT_REDIRECT_URI`.
4. Deploy, open the app, click **Connect HubSpot**, authorize, then **Refresh** the portal to sync.

Tokens auto-refresh (OAuth access tokens expire ~30 min; the stored refresh token is used).
Cached workflow + pipeline data lives in Postgres per portal and is re-pulled on Refresh.

### Data pulled per portal

- Workflows: `GET /automation/v4/flows` (list) → then each flow's full detail via
  `GET /automation/{version}/flows/{flowId}` for accurate steps/enrollment (set
  `HUBSPOT_ENRICH=0` to skip the per-flow detail calls; `HUBSPOT_FLOWS_VERSION` overrides the version).
- Pipelines: `GET /crm/v3/pipelines/deals` and `GET /crm/v3/pipelines/tickets`.

All read-only. Portal mode needs the deal/ticket read scopes **in addition to** `automation` —
so it reads more object types than standalone, but still never writes to HubSpot.

## How property extraction works

The app never sees HubSpot's raw payloads. `scripts/fetch-workflows.mjs`
normalises each workflow into the schema in `src/types.ts`:

- **Steps** — the enrollment trigger plus each action, classified into
  trigger / branch / action / set-property / delay / go-to / end.
- **Property references** — a recursive walk over every filter, criterion and
  action field collects property names (`property`, `propertyName`,
  `targetProperty`). Set-property actions count as **writes**; everything else
  counts as **reads**.
- **Usage rollup** — per-workflow and cross-workflow read/write counts, which
  power the Overview rankings and the Property map.

HubSpot's automation payloads vary by portal and workflow age (v3 vs v4). The
normaliser is deliberately defensive — unknown action shapes degrade to a
labelled generic step rather than failing — so refine the mappers in
`scripts/fetch-workflows.mjs` against your real payloads if a specific action
type needs richer handling.

## Project layout

```
server/index.mjs                    Express: static app + chat proxy + portal/OAuth/pipeline routes
server/hubspot.mjs                  HubSpot pulls: flows (list + detail), pipelines, normalisation
server/oauth.mjs                    HubSpot OAuth (authorize, token exchange, refresh)
server/db.mjs                       Postgres: portals + encrypted tokens + cached data
server/crypto.mjs                   AES-256-GCM token encryption + signed session cookies
.do/app.yaml                        Digital Ocean App Platform spec (+ managed Postgres)
scripts/fetch-workflows.mjs         HubSpot API → normalised JSON
public/data/workflows.sample.json   Committed demo data
src/types.ts                        Shared normalised schema
src/lib/data.ts                     Loading + cross-workflow aggregation
src/lib/analysis.ts                 Triggers, cascade graph, audit findings
src/lib/reports.ts                  Report aggregations
src/lib/layout.ts                   Layered graph layout for the flow diagram
src/components/Overview.tsx         Dashboard
src/components/Reports.tsx          Analytics charts
src/components/WorkflowFlow.tsx     React Flow diagram + custom nodes
src/components/PropertyMap.tsx      Property × workflow matrix
src/components/PropertyLookup.tsx   Property-first drill-down
src/components/Chat.tsx             Ask-AI chat UI
```
