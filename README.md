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
| **Overview** | Counts, enabled/off status, workflows-per-object, and the most-used properties ranked by read/write references. |
| **Workflow flow** | Per-workflow diagram (React Flow). Nodes are colour-coded by type (trigger / branch / action / set-property / delay / end). Pick a property to highlight everywhere it's touched. |
| **Property map** | A property × workflow matrix. Each cell is **R** (read), **W** (write) or **RW**. Filter by object type or "shared only", and click any cell to jump into that workflow with the property highlighted. |

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173  (uses bundled sample data)
```

Build a static bundle you can host anywhere:

```bash
npm run build      # outputs to dist/
npm run preview
```

## Using your real HubSpot data

1. In HubSpot, create a **Private App** (Settings → Integrations → Private Apps)
   with the scopes `automation` (read) and `crm.schemas.contacts.read`.
2. Copy the token:

   ```bash
   cp .env.example .env
   # edit .env and set HUBSPOT_TOKEN=pat-na1-...
   ```

3. Pull and normalise your workflows:

   ```bash
   set -a && source .env && set +a
   npm run fetch
   ```

   This calls the HubSpot v4 flows API (`/automation/v4/flows`), normalises each
   workflow into the app's schema, and writes `public/data/workflows.json`. The
   app prefers this file over the sample automatically.

The fetched file is git-ignored so you don't commit portal data.

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
scripts/fetch-workflows.mjs         HubSpot API → normalised JSON
public/data/workflows.sample.json   Committed demo data
src/types.ts                        Shared normalised schema
src/lib/data.ts                     Loading + cross-workflow aggregation
src/lib/layout.ts                   Layered graph layout for the flow diagram
src/components/Overview.tsx         Dashboard
src/components/WorkflowFlow.tsx     React Flow diagram + custom nodes
src/components/PropertyMap.tsx      Property × workflow matrix
```
