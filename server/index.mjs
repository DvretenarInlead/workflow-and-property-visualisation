import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')

const PORT = process.env.PORT || 8080
// Default to the latest Opus; override with ANTHROPIC_MODEL if your key targets another model.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5'

const app = express()
app.use(express.json({ limit: '1mb' }))

// --- Load the workflow dataset the chat reasons over (live pull preferred, sample fallback) ---
async function loadDataset() {
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
  return lines.join('\n')
}

let cachedPrompt = null
async function systemPrompt() {
  if (!cachedPrompt) cachedPrompt = buildSystemPrompt(await loadDataset())
  return cachedPrompt
}

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

  const client = new Anthropic()
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      output_config: { effort: 'low' }, // snappy interactive answers
      system: await systemPrompt(),
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

app.listen(PORT, () => {
  console.log(`Server listening on :${PORT} (model: ${MODEL})`)
})
