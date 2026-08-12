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
| **Reports** | Four analytics charts: property impact (workflows depending on each property), reads vs writes by object, workflow complexity, and step-type mix. Colours use a colourblind-safe, validated palette; light & dark modes both supported. |
| **Workflow flow** | Per-workflow diagram (React Flow). Nodes are colour-coded by type (trigger / branch / action / set-property / delay / end). Pick a property to highlight everywhere it's touched. |
| **Property map** | A property × workflow matrix. Each cell is **R** (read), **W** (write) or **RW**. Filter by object type or "shared only", and click any cell to jump into that workflow with the property highlighted. |
| **Property lookup** | Type a property (e.g. `dealstage`) and CRM object to see every workflow that uses it and the exact steps that read or write it — the "what is each workflow doing with this property?" view. |
| **Ask AI** | A chat that answers questions about your workflows and property dependencies. Backed by the Claude API through a small server-side proxy (the API key never reaches the browser). |

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

### Still seeing only sample data?

The app loads `workflows.json` if it exists and **falls back to the sample**
otherwise — so you see sample data whenever the fetch hasn't run:

- **Locally:** you set the token but never ran `npm run fetch`. Run it (step 3);
  if it errors, the token is the problem (needs the `automation` read scope and a
  `pat-na1-…` private-app token). After it succeeds, restart `npm run dev`.
- **On Digital Ocean:** the build has to fetch, because `workflows.json` isn't in
  the repo. The included `.do/app.yaml` runs `npm run fetch` during the build and
  declares `HUBSPOT_TOKEN` as a **build-time** secret — set that secret in the DO
  dashboard and redeploy. (Runtime-only env vars aren't visible during the build,
  so a `RUN_TIME` token won't work — it must be `BUILD_TIME`.)

To refresh live data you re-run the fetch (locally) or redeploy (on DO); it isn't
pulled on every page load.

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
server/index.mjs                    Express: serves the built app + /api/chat proxy to Claude
.do/app.yaml                        Digital Ocean App Platform spec
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
