import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import * as cookie from 'cookie'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { fetchDataset, fetchPortalData, fetchWorkflowDetail, normaliseWorkflow } from './hubspot.mjs'
import { secretConfigured, sign, verify, randomToken } from './crypto.mjs'
import * as db from './db.mjs'
import * as oauth from './oauth.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')

const PORT = process.env.PORT || 8080
// Default to the latest Opus; override with ANTHROPIC_MODEL if your key targets another model.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5'
const HUBSPOT_BASE = process.env.HUBSPOT_API_BASE || 'https://api.hubapi.com'

// Portal mode activates only when storage, OAuth, and the encryption secret are all set.
const PORTAL_MODE = db.dbConfigured() && oauth.oauthConfigured() && secretConfigured()
const SESSION_COOKIE = 'wf_session'
const SECURE_COOKIE = process.env.NODE_ENV === 'production'

// Live dataset pulled via the Refresh button; wins over any on-disk file until restart.
let liveDataset = null

// In-memory log of calls to the HubSpot API (newest first, capped).
const MAX_LOG = 200
const apiLog = []
function logHubspot(entry) {
  apiLog.unshift({ at: new Date().toISOString(), ...entry })
  if (apiLog.length > MAX_LOG) apiLog.length = MAX_LOG
}

const app = express()
app.use(express.json({ limit: '1mb' }))

// --- Load the on-disk workflow dataset (live build-time pull preferred, sample fallback) ---
async function loadFileDataset() {
  const candidates = [
    join(DIST, 'data', 'workflows.json'),
    join(DIST, 'data', 'workflows.sample.json'),
    join(ROOT, 'public', 'data', 'workflows.json'),
    join(ROOT, 'public', 'data', 'workflows.sample.json'),
  ]
  for (const file of candidates) {
    if (existsSync(file)) {
      try {
        return JSON.parse(await readFile(file, 'utf8'))
      } catch {
        // try next
      }
    }
  }
  return null
}

/** The dataset the app + chat currently use: an in-session refresh wins over the file. */
async function currentDataset() {
  return liveDataset ?? (await loadFileDataset())
}

/** Render the dataset into a compact, readable knowledge base for the system prompt. */
function buildSystemPrompt(dataset) {
  if (!dataset?.workflows?.length) {
    return 'You are a HubSpot workflow assistant, but no workflow data is currently loaded.'
  }
  const lines = []
  lines.push(
    'You are an assistant embedded in a HubSpot workflow & property visualiser.',
    'Answer questions about the workflows and the CRM properties they read and write, using ONLY the data below.',
    'Be concise and specific: name the workflows and steps involved. If something is not in the data, say so.',
    `Data generated ${dataset.generatedAt} (source: ${dataset.source}).`,
    '',
    '# Workflows',
  )
  for (const wf of dataset.workflows) {
    lines.push(
      `\n## ${wf.name}  [object: ${wf.objectType}, ${wf.enabled ? 'enabled' : 'off'}, type: ${wf.type}]`,
    )
    for (const s of wf.steps || []) {
      const reads = s.reads?.length ? ` reads:{${s.reads.join(', ')}}` : ''
      const writes = s.writes?.length ? ` writes:{${s.writes.join(', ')}}` : ''
      const detail = s.detail ? ` — ${s.detail}` : ''
      lines.push(`- (${s.kind}) ${s.title}${detail}${reads}${writes}`)
    }
  }
  if (dataset.pipelines?.length) {
    lines.push('', '# Pipelines (deal & ticket stages)')
    for (const p of dataset.pipelines) {
      const stages = (p.stages || []).map((s) => s.label).join(' → ')
      lines.push(`- ${p.objectType} pipeline “${p.label}”: ${stages}`)
    }
  }
  return lines.join('\n')
}

let cachedPrompt = null
async function systemPrompt(dataset) {
  if (dataset) return buildSystemPrompt(dataset) // portal-specific, not cached
  if (!cachedPrompt) cachedPrompt = buildSystemPrompt(await currentDataset())
  return cachedPrompt
}

// --- Session (portal mode) ---
function getSession(req) {
  const raw = cookie.parse(req.headers.cookie || '')[SESSION_COOKIE]
  return raw ? verify(raw) : null
}
function setSession(res) {
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(SESSION_COOKIE, sign('ok'), {
      httpOnly: true,
      sameSite: 'lax',
      secure: SECURE_COOKIE,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    }),
  )
}
function clearSession(res) {
  res.setHeader('Set-Cookie', cookie.serialize(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 }))
}
function requireSession(req, res, next) {
  if (!PORTAL_MODE) return res.status(404).json({ error: 'Portal mode not enabled.' })
  if (!getSession(req)) return res.status(401).json({ error: 'Not authenticated.' })
  next()
}

/** Return a valid HubSpot access token for a portal, refreshing if near expiry. */
async function validAccessToken(portal) {
  const exp = portal.expiresAt ? new Date(portal.expiresAt).getTime() : 0
  if (exp && exp - Date.now() > 60_000) return portal.token
  const t = await oauth.refresh(portal.refreshToken)
  const expiresAt = new Date(Date.now() + (t.expires_in ?? 1800) * 1000)
  await db.updatePortalTokens(portal.id, {
    token: t.access_token,
    refreshToken: t.refresh_token || portal.refreshToken,
    expiresAt,
  })
  return t.access_token
}

// --- Data + refresh endpoints ---

// The app loads its dataset here (in-session refresh preferred, else the file, else sample).
app.get('/api/data', async (_req, res) => {
  const dataset = await currentDataset()
  if (!dataset) return res.status(404).json({ error: 'No workflow data available.' })
  res.json(dataset)
})

// Refresh CTA: pull live workflows from HubSpot using the server-side token.
app.post('/api/refresh', async (_req, res) => {
  const token = process.env.HUBSPOT_TOKEN
  if (!token) {
    logHubspot({ endpoint: '/automation/v4/flows', status: 'skipped', message: 'HUBSPOT_TOKEN not set' })
    return res.status(400).json({
      error: 'HUBSPOT_TOKEN is not set on the server. Add it as a run-time secret to enable live refresh.',
    })
  }
  const started = Date.now()
  try {
    const dataset = await fetchDataset({ token, base: HUBSPOT_BASE })
    liveDataset = dataset
    cachedPrompt = null // chat should reason over the fresh data
    logHubspot({
      endpoint: '/automation/v4/flows',
      status: 'success',
      workflows: dataset.workflows.length,
      ms: Date.now() - started,
    })
    res.json({ ok: true, count: dataset.workflows.length, generatedAt: dataset.generatedAt })
  } catch (err) {
    logHubspot({
      endpoint: '/automation/v4/flows',
      status: 'error',
      message: err?.message || 'HubSpot request failed.',
      ms: Date.now() - started,
    })
    res.status(502).json({ error: err?.message || 'HubSpot request failed.' })
  }
})

// HubSpot API call log (newest first).
app.get('/api/logs', (_req, res) => {
  res.json({ entries: apiLog })
})

// Retrieve one workflow's full detail (GET /automation/{version}/flows/{flowId}).
// Standalone mode uses the single server-side token.
app.get('/api/workflows/:flowId', async (req, res) => {
  const token = process.env.HUBSPOT_TOKEN
  if (!token) return res.status(400).json({ error: 'HUBSPOT_TOKEN not set.' })
  const started = Date.now()
  try {
    const raw = await fetchWorkflowDetail({ token, flowId: req.params.flowId, base: HUBSPOT_BASE })
    logHubspot({ endpoint: `/automation/*/flows/${req.params.flowId}`, status: 'success', ms: Date.now() - started })
    res.json({ raw, workflow: normaliseWorkflow(raw) })
  } catch (err) {
    logHubspot({ endpoint: `/automation/*/flows/${req.params.flowId}`, status: 'error', message: err?.message, ms: Date.now() - started })
    res.status(502).json({ error: err?.message || 'HubSpot request failed.' })
  }
})

// --- Portal mode: session, OAuth, and per-portal data ---

// Tells the frontend which mode to run in and (in portal mode) who's logged in.
app.get('/api/session', async (req, res) => {
  if (!PORTAL_MODE) return res.json({ mode: 'standalone' })
  const authenticated = Boolean(getSession(req))
  const portals = authenticated ? await db.listPortals().catch(() => []) : []
  res.json({ mode: 'portal', authenticated, portals })
})

// Start the HubSpot OAuth flow ("Connect HubSpot").
app.get('/auth/hubspot', async (_req, res) => {
  if (!PORTAL_MODE) return res.redirect('/')
  const state = randomToken()
  await db.saveOAuthState(state)
  res.redirect(oauth.authorizeUrl(state))
})

// OAuth callback: exchange the code, create/update the portal, start a session.
app.get('/auth/hubspot/callback', async (req, res) => {
  if (!PORTAL_MODE) return res.redirect('/')
  const { code, state, error } = req.query
  if (error) return res.status(400).send(`HubSpot authorization failed: ${error}`)
  try {
    if (!(await db.consumeOAuthState(String(state || '')))) {
      return res.status(400).send('Invalid or expired OAuth state. Please try connecting again.')
    }
    const tokens = await oauth.exchangeCode(String(code))
    const info = await oauth.tokenInfo(tokens.access_token)
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 1800) * 1000)
    await db.upsertPortal({
      id: randomToken(9),
      hubId: info.hubId,
      name: info.hubDomain || `Portal ${info.hubId}`,
      token: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
    })
    logHubspot({ endpoint: '/oauth/v1/token', status: 'success', message: `connected ${info.hubDomain || info.hubId}` })
    setSession(res)
    res.redirect('/')
  } catch (err) {
    logHubspot({ endpoint: '/oauth/v1/token', status: 'error', message: err?.message })
    res.status(502).send(`Could not connect portal: ${err?.message || 'unknown error'}`)
  }
})

app.post('/auth/logout', (_req, res) => {
  clearSession(res)
  res.json({ ok: true })
})

// Cached dataset (workflows + pipelines) for one portal.
app.get('/api/portals/:id/data', requireSession, async (req, res) => {
  const data = await db.getPortalData(req.params.id)
  if (!data) return res.status(404).json({ error: 'No data yet — refresh this portal.', needsSync: true })
  res.json(data)
})

// Pull fresh workflows + pipelines for a portal from HubSpot.
app.post('/api/portals/:id/refresh', requireSession, async (req, res) => {
  const portal = await db.getPortalSecret(req.params.id)
  if (!portal) return res.status(404).json({ error: 'Portal not found.' })
  const started = Date.now()
  try {
    const token = await validAccessToken(portal)
    const data = await fetchPortalData({ token, base: HUBSPOT_BASE })
    await db.savePortalData(portal.id, data)
    logHubspot({
      endpoint: '/automation/v4/flows + /crm/v3/pipelines',
      status: 'success',
      portal: portal.name,
      workflows: data.workflows.length,
      ms: Date.now() - started,
    })
    res.json({ ok: true, count: data.workflows.length, pipelines: data.pipelines?.length ?? 0, generatedAt: data.generatedAt })
  } catch (err) {
    logHubspot({
      endpoint: '/automation/v4/flows',
      status: 'error',
      portal: portal.name,
      message: err?.message || 'HubSpot request failed.',
      ms: Date.now() - started,
    })
    res.status(502).json({ error: err?.message || 'HubSpot request failed.' })
  }
})

// Retrieve one workflow's full detail for a portal (fresh from HubSpot).
app.get('/api/portals/:id/workflows/:flowId', requireSession, async (req, res) => {
  const portal = await db.getPortalSecret(req.params.id)
  if (!portal) return res.status(404).json({ error: 'Portal not found.' })
  const started = Date.now()
  try {
    const token = await validAccessToken(portal)
    const raw = await fetchWorkflowDetail({ token, flowId: req.params.flowId, base: HUBSPOT_BASE })
    logHubspot({ endpoint: `/automation/*/flows/${req.params.flowId}`, status: 'success', portal: portal.name, ms: Date.now() - started })
    res.json({ raw, workflow: normaliseWorkflow(raw) })
  } catch (err) {
    logHubspot({ endpoint: `/automation/*/flows/${req.params.flowId}`, status: 'error', portal: portal.name, message: err?.message, ms: Date.now() - started })
    res.status(502).json({ error: err?.message || 'HubSpot request failed.' })
  }
})

// --- Chat proxy: keeps the API key server-side and streams the reply back ---
app.post('/api/chat', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).send('Server is missing ANTHROPIC_API_KEY. Set it in the environment.')
  }
  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : []
  const messages = incoming
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content }))
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).send('Expected a non-empty messages array ending in a user turn.')
  }

  // In portal mode, reason over the selected portal's cached data.
  let portalDataset = null
  if (PORTAL_MODE && req.body?.portalId && getSession(req)) {
    portalDataset = await db.getPortalData(req.body.portalId).catch(() => null)
  }

  const client = new Anthropic()
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      output_config: { effort: 'low' }, // snappy interactive answers
      system: await systemPrompt(portalDataset),
      messages,
    })
    stream.on('text', (delta) => res.write(delta))
    await stream.finalMessage()
    res.end()
  } catch (err) {
    const msg = err?.message || 'Chat request failed.'
    if (!res.headersSent) res.status(502).send(msg)
    else res.end(`\n\n[error: ${msg}]`)
  }
})

app.get('/api/health', (_req, res) => res.json({ ok: true, model: MODEL }))

// --- Static app (built by `npm run build`) with SPA fallback ---
app.use(express.static(DIST))
app.get('*', (_req, res) => {
  const index = join(DIST, 'index.html')
  if (existsSync(index)) res.sendFile(index)
  else res.status(503).send('App not built yet. Run `npm run build`.')
})

async function start() {
  if (PORTAL_MODE) {
    try {
      await db.initSchema()
      console.log('Portal mode enabled (Postgres + HubSpot OAuth).')
    } catch (err) {
      console.error('DB init failed — portal features may not work:', err.message)
    }
  } else {
    console.log('Standalone mode (set DATABASE_URL + HubSpot OAuth + APP_SECRET for portal mode).')
  }
  app.listen(PORT, () => {
    console.log(`Server listening on :${PORT} (model: ${MODEL})`)
  })
}
start()
