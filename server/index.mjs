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

// In-memory runtime log (newest first, capped). Mirrored to stdout so the
// platform's runtime logs (e.g. Digital Ocean) capture the same events.
const MAX_LOG = 500
const runtimeLog = []
function logEvent(e) {
  const entry = {
    at: new Date().toISOString(),
    level: e.level || 'info',
    category: e.category || 'system',
    ...e,
  }
  runtimeLog.unshift(entry)
  if (runtimeLog.length > MAX_LOG) runtimeLog.length = MAX_LOG
  const parts = [
    `[${entry.level.toUpperCase()}]`,
    entry.category,
    entry.portal && `portal=${entry.portal}`,
    entry.endpoint,
    entry.status && `→ ${entry.status}`,
    entry.message,
    entry.ms != null && `(${entry.ms}ms)`,
  ].filter(Boolean)
  const line = parts.join(' ')
  if (entry.level === 'error') console.error(line)
  else if (entry.level === 'warn') console.warn(line)
  else console.log(line)
}
// Back-compat helper for HubSpot API calls: derive level from status.
function logHubspot(e) {
  const level = e.status === 'error' ? 'error' : e.status === 'skipped' ? 'warn' : 'info'
  logEvent({ level, category: 'hubspot', ...e })
}

const app = express()
app.use(express.json({ limit: '1mb' }))

// Request logging for API/auth routes (skips noisy polling of logs/health).
app.use((req, res, next) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/auth')) return next()
  if (req.path === '/api/logs' || req.path === '/api/health') return next()
  const started = Date.now()
  res.on('finish', () => {
    logEvent({
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      category: 'http',
      endpoint: `${req.method} ${req.path}`,
      status: String(res.statusCode),
      ms: Date.now() - started,
    })
  })
  next()
})

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
app.get('/api/logs', (req, res) => {
  const level = req.query.level
  const entries = level && level !== 'all' ? runtimeLog.filter((e) => e.level === level) : runtimeLog
  res.json({ entries })
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

// Start the HubSpot OAuth flow ("Connect HubSpot" / "Connect another portal").
app.get('/auth/hubspot', async (_req, res) => {
  if (!PORTAL_MODE) return res.redirect('/')
  try {
    const state = randomToken()
    await db.saveOAuthState(state)
    logEvent({ category: 'oauth', message: 'authorization started' })
    res.redirect(oauth.authorizeUrl(state))
  } catch (err) {
    logEvent({ level: 'error', category: 'oauth', message: `authorize failed: ${err?.message}` })
    res.status(500).send(`Could not start OAuth: ${err?.message || 'unknown error'}`)
  }
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

// Disconnect (delete) a portal.
app.delete('/api/portals/:id', requireSession, async (req, res) => {
  try {
    await db.deletePortal(req.params.id)
    logEvent({ category: 'portal', message: `disconnected portal ${req.params.id}` })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Could not disconnect portal.' })
  }
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
    logEvent({ level: 'error', category: 'chat', message: msg })
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
