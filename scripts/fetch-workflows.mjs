#!/usr/bin/env node
/**
 * Pull HubSpot workflows and write a normalised dataset to
 * public/data/workflows.json (consumed by the app when present).
 *
 * Usage:
 *   HUBSPOT_TOKEN=pat-na1-... node scripts/fetch-workflows.mjs
 *   npm run fetch
 *
 * The shared pull/normalise logic lives in server/hubspot.mjs so the runtime
 * "Refresh from HubSpot" button and this build/CLI step behave identically.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { fetchDataset } from '../server/hubspot.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'public', 'data', 'workflows.json')

const token = process.env.HUBSPOT_TOKEN
const base = process.env.HUBSPOT_API_BASE || 'https://api.hubapi.com'

if (!token) {
  console.error('Missing HUBSPOT_TOKEN. Copy .env.example to .env and set your private-app token.')
  console.error('The app still runs against the committed sample data without this.')
  process.exit(1)
}

try {
  console.log('Fetching HubSpot flows (v4)…')
  const dataset = await fetchDataset({ token, base })
  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(dataset, null, 2))
  console.log(`Wrote ${dataset.workflows.length} workflows to ${OUT}`)
} catch (err) {
  console.error(err.message || err)
  process.exit(1)
}
