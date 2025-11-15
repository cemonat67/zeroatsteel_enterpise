import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import Anthropic from '@anthropic-ai/sdk'
import dotenv from 'dotenv'
import OpenAI from 'openai'
import { spawn } from 'child_process'
import fs from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')
const mammoth = require('mammoth')
import jwt from 'jsonwebtoken'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
app.use(cors({ origin: (origin, cb) => {
  if (!origin || ALLOWED_ORIGINS.length === 0) return cb(null, true)
  if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
  cb(new Error('CORS blocked'))
}, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','X-API-Key'] }))
app.use(express.json({ limit: '1mb' }))
app.set('trust proxy', true)
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('Referrer-Policy', 'no-referrer')
  res.set('Strict-Transport-Security', 'max-age=31536000')
  const fa = process.env.FRAME_ANCESTORS || ''
  if (fa) res.set('Content-Security-Policy', `frame-ancestors ${fa}`)
  next()
})

function parseWeightedKeys(raw) {
  return raw.split(',').map(s => s.trim()).filter(Boolean).map(entry => {
    const [k, w] = entry.split(':')
    const weight = Math.max(1, parseInt(w || '1', 10) || 1)
    return { key: k, weight }
  })
}
const anthropicWeighted = parseWeightedKeys(process.env.ANTHROPIC_API_KEYS || process.env.ANTHROPIC_API_KEY || '')
const openaiWeighted = parseWeightedKeys(process.env.OPENAI_API_KEYS || process.env.OPENAI_API_KEY || '')
const anthropicPool = anthropicWeighted.flatMap(({ key, weight }) => Array.from({ length: weight }, () => key))
const openaiPool = openaiWeighted.flatMap(({ key, weight }) => Array.from({ length: weight }, () => key))
let anthropicIdx = 0
let openaiIdx = 0
const anthropicCooldown = new Map()
const openaiCooldown = new Map()
function nextKey(pool, idxRef, cooldownMap) {
  const now = Date.now()
  if (!pool.length) return { key: undefined, index: idxRef }
  for (let i = 0; i < pool.length; i++) {
    const j = (idxRef + i) % pool.length
    const k = pool[j]
    const until = cooldownMap.get(k) || 0
    if (now >= until) {
      return { key: k, index: j }
    }
  }
  return { key: pool[0], index: 0 }
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)) }
const BACKOFF_MAX_ATTEMPTS = Math.max(1, parseInt(process.env.BACKOFF_MAX_ATTEMPTS || '5', 10))
const BACKOFF_BASE_MS = Math.max(1, parseInt(process.env.BACKOFF_BASE_MS || '1000', 10))
const BACKOFF_MAX_MS = Math.max(BACKOFF_BASE_MS, parseInt(process.env.BACKOFF_MAX_MS || '16000', 10))
const CLAUDE_MAX_CONCURRENCY = Math.max(1, parseInt(process.env.CLAUDE_MAX_CONCURRENCY || '4', 10))
const OPENAI_MAX_CONCURRENCY = Math.max(1, parseInt(process.env.OPENAI_MAX_CONCURRENCY || '4', 10))
let claudeInFlight = 0
let openaiInFlight = 0
async function acquireClaude() { while (claudeInFlight >= CLAUDE_MAX_CONCURRENCY) { await delay(50) } claudeInFlight++ }
function releaseClaude() { claudeInFlight = Math.max(0, claudeInFlight - 1) }
async function acquireOpenAI() { while (openaiInFlight >= OPENAI_MAX_CONCURRENCY) { await delay(50) } openaiInFlight++ }
function releaseOpenAI() { openaiInFlight = Math.max(0, openaiInFlight - 1) }
async function callClaude(req) {
  const maxAttempts = BACKOFF_MAX_ATTEMPTS
  let attempt = 0
  let lastErr
  while (attempt < maxAttempts) {
    const sel = nextKey(anthropicPool, anthropicIdx, anthropicCooldown)
    anthropicIdx = sel.index + 1
    const client = new Anthropic({ apiKey: sel.key })
    try {
      await acquireClaude()
      const r = await client.messages.create(req)
      releaseClaude()
      return r
    } catch (e) {
      releaseClaude()
      lastErr = e
      const msg = String(e && e.message ? e.message : '').toLowerCase()
      const isRate = msg.includes('rate') || msg.includes('429')
      if (isRate) {
        const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, attempt))
        anthropicCooldown.set(sel.key, Date.now() + backoff)
        await delay(backoff)
        attempt++
        continue
      }
      throw e
    }
  }
  throw lastErr || new Error('Claude call failed')
}
async function callOpenAI(req) {
  const maxAttempts = BACKOFF_MAX_ATTEMPTS
  let attempt = 0
  let lastErr
  while (attempt < maxAttempts) {
    const sel = nextKey(openaiPool, openaiIdx, openaiCooldown)
    openaiIdx = sel.index + 1
    const client = new OpenAI({ apiKey: sel.key })
    try {
      await acquireOpenAI()
      const r = await client.chat.completions.create(req)
      releaseOpenAI()
      return r
    } catch (e) {
      releaseOpenAI()
      lastErr = e
      const msg = String(e && e.message ? e.message : '').toLowerCase()
      const isRate = msg.includes('rate') || msg.includes('429')
      if (isRate) {
        const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, attempt))
        openaiCooldown.set(sel.key, Date.now() + backoff)
        await delay(backoff)
        attempt++
        continue
      }
      throw e
    }
  }
  throw lastErr || new Error('OpenAI call failed')
}

const candidateModels = [
  'claude-3-5-haiku-latest',
  'claude-3-5-sonnet-latest',
  'claude-3-haiku-20240307',
  'claude-3-sonnet-20240229',
  'claude-2.1'
]

const candidateOpenAIModels = [
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4.1-mini',
  'gpt-4.1'
]

const logsDir = path.join(__dirname, 'data', 'logs')
try { fs.mkdirSync(logsDir, { recursive: true }) } catch (_) {}
const filesDir = path.join(__dirname, 'data', 'files')
try { fs.mkdirSync(filesDir, { recursive: true }) } catch (_) {}
const ragDir = path.join(__dirname, 'data', 'rag')
try { fs.mkdirSync(ragDir, { recursive: true }) } catch (_) {}
const reportsDir = path.join(__dirname, 'data', 'reports')
try { fs.mkdirSync(reportsDir, { recursive: true }) } catch (_) {}
const RATE_LIMIT_PER_MINUTE = Math.max(1, parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60', 10))
const TERMINAL_OUTPUT_LIMIT_BYTES = Math.max(1000, parseInt(process.env.TERMINAL_OUTPUT_LIMIT_BYTES || '20000', 10))
const MAX_FILE_SIZE_MB = Math.max(1, parseInt(process.env.MAX_FILE_SIZE_MB || '20', 10))
const RETENTION_DAYS = Math.max(1, parseInt(process.env.RETENTION_DAYS || '30', 10))
const ALLOWED_IPS = (process.env.ALLOWED_IPS || '').split(',').map(s => s.trim()).filter(Boolean)
const API_KEYS = (process.env.API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean).map(pair => { const [k,r] = pair.split(':'); return { key:k, role:(r||'user') } })
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || ''
const SAND_BOX_DIR = process.env.SAND_BOX_DIR ? path.resolve(process.env.SAND_BOX_DIR) : path.join(__dirname, 'sandbox')
try { fs.mkdirSync(SAND_BOX_DIR, { recursive: true }) } catch (_) {}
const rateMap = new Map()
function auth(req, res, next) {
  const hdrAuth = req.headers['authorization']
  const bearer = hdrAuth && hdrAuth.startsWith('Bearer ') ? hdrAuth.slice(7) : ''
  let token = req.headers['x-api-key'] || (req.method === 'GET' ? (req.query.api_key || req.query.token) : undefined)
  let role = 'user'
  if (token) {
    const match = API_KEYS.find(x => x.key === token)
    if (match) { role = match.role }
    else if (SUPABASE_JWT_SECRET) {
      try {
        const payload = jwt.verify(token, SUPABASE_JWT_SECRET)
        role = (payload?.user_metadata?.role) || (payload?.app_metadata?.role) || 'user'
      } catch (e) {}
    }
  } else if (bearer && SUPABASE_JWT_SECRET) {
    try {
      const payload = jwt.verify(bearer, SUPABASE_JWT_SECRET)
      role = (payload?.user_metadata?.role) || (payload?.app_metadata?.role) || 'user'
      token = bearer
    } catch (e) { return res.status(401).json({ error: 'unauthorized' }) }
  } else {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const now = Date.now()
  const bucket = rateMap.get(token) || { ts: now, count: 0 }
  if (now - bucket.ts > 60000) { bucket.ts = now; bucket.count = 0 }
  bucket.count++
  rateMap.set(token, bucket)
  if (bucket.count > RATE_LIMIT_PER_MINUTE) return res.status(429).json({ error: 'rate_limit' })
  req.user = { token, role }
  next()
}
function logEvent(type, meta) {
  try { fs.appendFileSync(path.join(logsDir, 'app.log'), JSON.stringify({ t: new Date().toISOString(), type, meta }) + '\n') } catch (_) {}
}

app.get('/api/models', auth, async (req, res) => {
  try {
    if (!anthropicPool.length) {
      return res.status(400).json({ error: 'ANTHROPIC_API_KEY environment variable not set' })
    }
    res.json({ models: candidateModels })
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.get('/api/openai/models', auth, async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OPENAI_API_KEY environment variable not set' })
    }
    res.json({ models: candidateOpenAIModels })
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.get('/api/me', auth, async (req, res) => {
  try {
    res.json({ role: req.user.role })
  } catch (err) {
    res.status(500).json({ error: 'error' })
  }
})

app.post('/api/actions/log', auth, async (req, res) => {
  try {
    const { action, meta } = req.body || {}
    if (!action) return res.status(400).json({ error: 'action_required' })
    try { fs.appendFileSync(path.join(logsDir, 'actions.log'), JSON.stringify({ t: new Date().toISOString(), user: req.user.token, action, meta }) + '\n') } catch(_) {}
    res.json({ ok: true })
  } catch (err) { const message = err && err.message ? err.message : 'Unknown error'; res.status(500).json({ error: message }) }
})

app.post('/api/auto/cbam-report', auth, async (req, res) => {
  try {
    const { batch_id } = req.body || {}
    if (!batch_id) return res.status(400).json({ error: 'batch_id_required' })
    logEvent('auto_cbam_report', { user: req.user.token, batch_id })
    res.json({ status: 'queued', batch_id })
  } catch (err) { const message = err && err.message ? err.message : 'Unknown error'; res.status(500).json({ error: message }) }
})

app.post('/api/reports/cbam', auth, async (req, res) => {
  try {
    const N8N_URL = process.env.N8N_URL || ''
    if (!N8N_URL) return res.status(400).json({ error: 'N8N_URL_not_configured' })
    const { tonnage, intensity_tco2_per_ton, ets_eur_per_tco2, elec_eur_per_mwh, h2_eur_per_kg, h2_blend } = req.body || {}
    const payload = {
      tonnage: Number(tonnage || 0),
      intensity_tco2_per_ton: Number(intensity_tco2_per_ton || 0),
      ets_eur_per_tco2: Number(ets_eur_per_tco2 || 0),
      elec_eur_per_mwh: Number(elec_eur_per_mwh || 0),
      h2_eur_per_kg: Number(h2_eur_per_kg || 0),
      h2_blend: Number(h2_blend || 0)
    }
    const url = N8N_URL.replace(/\/$/, '') + '/zero-steel/cbam-sim'
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return res.status(r.status || 500).json({ error: data && data.error ? data.error : 'n8n_error' })
    if (data && typeof data.pdf_url === 'string' && data.pdf_url) {
      return res.json({ url: data.pdf_url })
    }
    if (data && typeof data.pdf_base64 === 'string' && data.pdf_base64) {
      const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2,8)
      const fp = path.join(reportsDir, id + '.pdf')
      const buf = Buffer.from(data.pdf_base64, 'base64')
      fs.writeFileSync(fp, buf)
      return res.json({ url: '/api/reports/file/' + id + '.pdf', id })
    }
    return res.json({ result: data })
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.get('/api/reports/file/:name', auth, async (req, res) => {
  try {
    const name = String(req.params.name || '')
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) return res.status(400).json({ error: 'invalid_name' })
    const fp = path.join(reportsDir, name)
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'not_found' })
    res.sendFile(fp)
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/auto/open-batch', auth, async (req, res) => {
  try {
    const { batch_id } = req.body || {}
    if (!batch_id) return res.status(400).json({ error: 'batch_id_required' })
    logEvent('auto_open_batch', { user: req.user.token, batch_id })
    res.json({ status: 'ok', batch_id })
  } catch (err) { const message = err && err.message ? err.message : 'Unknown error'; res.status(500).json({ error: message }) }
})
app.get('/api/alert-rules', auth, async (req, res) => {
  try {
    const fp = path.join(__dirname, 'data', 'alert_rules.json')
    let arr = []
    if (fs.existsSync(fp)) arr = JSON.parse(fs.readFileSync(fp, 'utf8'))
    res.json({ rules: arr })
  } catch (err) { const message = err && err.message ? err.message : 'Unknown error'; res.status(500).json({ error: message }) }
})
app.post('/api/alert-rules', auth, async (req, res) => {
  try {
    if (!(req.user.role === 'admin' || req.user.role === 'engineer')) return res.status(403).json({ error: 'forbidden' })
    const fp = path.join(__dirname, 'data', 'alert_rules.json')
    let arr = []
    if (fs.existsSync(fp)) arr = JSON.parse(fs.readFileSync(fp, 'utf8'))
    const { id, name, rule, enabled } = req.body || {}
    if (!name || !rule) return res.status(400).json({ error: 'name_and_rule_required' })
    let rid = id || (String(Date.now()) + '-' + Math.random().toString(36).slice(2,8))
    const idx = arr.findIndex(x => x.id === rid)
    const item = { id: rid, name, rule, enabled: enabled !== false }
    if (idx >= 0) arr[idx] = item; else arr.push(item)
    fs.writeFileSync(fp, JSON.stringify(arr, null, 2))
    res.json({ id: rid })
  } catch (err) { const message = err && err.message ? err.message : 'Unknown error'; res.status(500).json({ error: message }) }
})
app.delete('/api/alert-rules/:id', auth, async (req, res) => {
  try {
    if (!(req.user.role === 'admin' || req.user.role === 'engineer')) return res.status(403).json({ error: 'forbidden' })
    const fp = path.join(__dirname, 'data', 'alert_rules.json')
    let arr = []
    if (fs.existsSync(fp)) arr = JSON.parse(fs.readFileSync(fp, 'utf8'))
    arr = arr.filter(x => x.id !== req.params.id)
    fs.writeFileSync(fp, JSON.stringify(arr, null, 2))
    res.json({ ok: true })
  } catch (err) { const message = err && err.message ? err.message : 'Unknown error'; res.status(500).json({ error: message }) }
})

function chunkText(text, size = 800) {
  const chunks = []
  let i = 0
  while (i < text.length) {
    chunks.push(text.slice(i, i + size))
    i += size
  }
  return chunks
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length && i < b.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i] }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

app.post('/api/rag/index', auth, async (req, res) => {
  try {
    const { title, text, file_ids } = req.body || {}
    let sourceText = ''
    if (Array.isArray(file_ids) && file_ids.length) {
      for (const id of file_ids) {
        const fp = path.join(filesDir, id + '.json')
        if (fs.existsSync(fp)) {
          const j = JSON.parse(fs.readFileSync(fp, 'utf8'))
          if (j.text) sourceText += '\n\n' + j.text
        }
      }
    } else if (typeof text === 'string' && text.trim()) {
      sourceText = text
    } else {
      return res.status(400).json({ error: 'text_or_file_ids_required' })
    }
    const chunks = chunkText(sourceText, 1000)
    const client = new OpenAI({ apiKey: (openaiPool && openaiPool[0]) ? openaiPool[0] : process.env.OPENAI_API_KEY })
    const embeddings = []
    for (const c of chunks) {
      const r = await client.embeddings.create({ model: 'text-embedding-3-small', input: c })
      embeddings.push({ text: c, embedding: r.data[0].embedding })
    }
    const docId = String(Date.now()) + '-' + Math.random().toString(36).slice(2,8)
    fs.writeFileSync(path.join(ragDir, docId + '.json'), JSON.stringify({ id: docId, title: title || 'doc', chunks: embeddings }, null, 2))
    res.json({ id: docId, chunks: embeddings.length })
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/rag/query', auth, async (req, res) => {
  try {
    const { query, top_k } = req.body || {}
    if (!query) return res.status(400).json({ error: 'query_required' })
    const client = new OpenAI({ apiKey: (openaiPool && openaiPool[0]) ? openaiPool[0] : process.env.OPENAI_API_KEY })
    const qr = await client.embeddings.create({ model: 'text-embedding-3-small', input: query })
    const qemb = qr.data[0].embedding
    const files = fs.readdirSync(ragDir).filter(f => f.endsWith('.json'))
    const candidates = []
    for (const f of files) {
      const j = JSON.parse(fs.readFileSync(path.join(ragDir, f), 'utf8'))
      (j.chunks || []).forEach(ch => {
        const score = cosine(qemb, ch.embedding)
        candidates.push({ text: ch.text, score, doc_id: j.id, title: j.title })
      })
    }
    candidates.sort((a,b) => b.score - a.score)
    const k = Math.max(1, Math.min(parseInt(top_k || '5', 10), 20))
    res.json({ results: candidates.slice(0, k) })
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/chat/cancel', auth, async (req, res) => {
  try {
    const { session_id } = req.body || {}
    if (!session_id) return res.status(400).json({ error: 'session_id_required' })
    if (!abortMap.has(session_id)) return res.status(404).json({ error: 'session_not_found' })
    abortMap.set(session_id, true)
    logEvent('cancel', { user: req.user.token, session_id })
    res.json({ status: 'cancelled' })
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/chat', auth, async (req, res) => {
  try {
    const { messages, system, model, max_tokens } = req.body || {}
    const available = candidateModels
    const preferred = (model && available.includes(model)) ? model : available[0]
    const mt = typeof max_tokens === 'number' ? max_tokens : 1024

    if (!anthropicPool.length) {
      return res.status(400).json({ error: 'ANTHROPIC_API_KEY environment variable not set' })
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' })
    }

    let response
    try {
      response = await callClaude({ model: preferred, max_tokens: mt, system, messages })
    } catch (e1) {
      const m = e1 && e1.message ? e1.message.toLowerCase() : ''
      if (m.includes('not_found') || m.includes('model')) {
        const candidates = available.filter(id => id !== preferred)
        for (const cand of candidates) {
          try {
            response = await callClaude({ model: cand, max_tokens: mt, system, messages })
            break
          } catch (e2) {}
        }
        if (!response) {
          return res.status(404).json({ error: e1.message || 'Model not found', suggestedModels: available })
        }
      } else {
        throw e1
      }
    }

    logEvent('chat', { user: req.user.token, model: preferred })
    res.json(response)
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/openai/chat', auth, async (req, res) => {
  try {
    const { messages, system, model, max_tokens } = req.body || {}
    if (!openaiPool.length) {
      return res.status(400).json({ error: 'OPENAI_API_KEY environment variable not set' })
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' })
    }
    const available = candidateOpenAIModels
    const preferred = (model && available.includes(model)) ? model : available[0]
    const mt = typeof max_tokens === 'number' ? max_tokens : 1024
    const baseMessages = []
    if (system) baseMessages.push({ role: 'system', content: system })
    for (const m of messages) {
      const role = m.role === 'assistant' ? 'assistant' : 'user'
      const text = Array.isArray(m.content) && m.content[0] ? (m.content[0].text || '') : ''
      baseMessages.push({ role, content: text })
    }
    let response
    try {
      const r = await callOpenAI({ model: preferred, messages: baseMessages, max_tokens: mt })
      const out = r && r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content ? r.choices[0].message.content : ''
      response = { content: [{ type: 'text', text: out }] }
    } catch (e1) {
      const m = e1 && e1.message ? e1.message.toLowerCase() : ''
      if (m.includes('model') || m.includes('not_found')) {
        const candidates = available.filter(id => id !== preferred)
        for (const cand of candidates) {
          try {
            const r = await callOpenAI({ model: cand, messages: baseMessages, max_tokens: mt })
            const out = r && r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content ? r.choices[0].message.content : ''
            response = { content: [{ type: 'text', text: out }] }
            break
          } catch (e2) {}
        }
        if (!response) {
          return res.status(404).json({ error: e1.message || 'Model not found', suggestedModels: available })
        }
      } else {
        throw e1
      }
    }
    logEvent('openai_chat', { user: req.user.token, model: preferred })
    res.json(response)
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

const TERMINAL_ENABLED = process.env.TERMINAL_ENABLED === 'true'
const ALLOW_CMDS = ['ls','pwd','mkdir','cp','mv','cat','echo','open','touch','node','npm','yarn','git']
function tokenize(input) {
  const re = /\s*("([^"]*)"|'([^']*)'|([^\s"']+))\s*/g
  const out = []
  let m
  while ((m = re.exec(input)) !== null) {
    if (m[2] !== undefined) out.push(m[2])
    else if (m[3] !== undefined) out.push(m[3])
    else if (m[4] !== undefined) out.push(m[4])
  }
  return out
}
function invalidSymbols(s) {
  return /[;&|><`$]/.test(s)
}
function safeCwd(cwd) {
  const base = __dirname
  if (!cwd) return base
  try {
    const p = path.resolve(base, cwd)
    if (!p.startsWith(base)) return base
    return p
  } catch (_) { return base }
}

app.post('/api/terminal/exec', auth, async (req, res) => {
  try {
    if (!TERMINAL_ENABLED) {
      return res.status(403).json({ error: 'Terminal disabled. Set TERMINAL_ENABLED=true' })
    }
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
    const ip = String((req.headers['x-forwarded-for'] || '').toString().split(',')[0] || req.ip || '')
    if (ALLOWED_IPS.length && !ALLOWED_IPS.includes(ip)) return res.status(403).json({ error: 'ip_forbidden' })
    const { cmd, cwd } = req.body || {}
    if (typeof cmd !== 'string' || !cmd.trim()) {
      return res.status(400).json({ error: 'cmd is required' })
    }
    if (invalidSymbols(cmd)) {
      return res.status(400).json({ error: 'unsupported characters' })
    }
    const tokens = tokenize(cmd)
    const bin = tokens[0]
    const args = tokens.slice(1)
    if (!ALLOW_CMDS.includes(bin)) {
      return res.status(400).json({ error: 'command not allowed', allow: ALLOW_CMDS })
    }
    const runCwd = SAND_BOX_DIR
    const child = spawn(bin, args, { cwd: runCwd })
    let out = ''
    let err = ''
    child.stdout.on('data', d => { out += d.toString(); if (out.length > TERMINAL_OUTPUT_LIMIT_BYTES) child.kill('SIGTERM') })
    child.stderr.on('data', d => { err += d.toString(); if (err.length > TERMINAL_OUTPUT_LIMIT_BYTES) child.kill('SIGTERM') })
    const to = setTimeout(() => { try { child.kill('SIGTERM') } catch(_){} }, 15000)
    child.on('close', code => {
      clearTimeout(to)
      logEvent('terminal', { user: req.user.token, cmd })
      res.json({ code, stdout: out, stderr: err })
    })
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})


app.post('/api/pipeline', async (req, res) => {
  try {
    const { text, claude_model, openai_model, max_iters } = req.body || {}
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(400).json({ error: 'ANTHROPIC_API_KEY environment variable not set' })
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OPENAI_API_KEY environment variable not set' })
    }
    const t = typeof text === 'string' ? text.trim() : ''
    if (!t) {
      return res.status(400).json({ error: 'text is required' })
    }
    const cAvail = candidateModels
    const oAvail = candidateOpenAIModels
    const cModel = (claude_model && cAvail.includes(claude_model)) ? claude_model : cAvail[0]
    const oModel = (openai_model && oAvail.includes(openai_model)) ? openai_model : oAvail[0]
    const maxI = typeof max_iters === 'number' ? Math.max(1, Math.min(5, max_iters)) : 2
    let messages = [{ role: 'user', content: [{ type: 'text', text: t }] }]
    const iterations = []
    let finalOut = null
    for (let i = 0; i < maxI; i++) {
      let claudeResp
      try {
        claudeResp = await anthropic.messages.create({ model: cModel, max_tokens: 1024, messages, system: 'You are Zero@AgentAI. Use precise, concise Turkish. Provide factual, structured answers.' })
      } catch (e1) {
        const m = e1 && e1.message ? e1.message.toLowerCase() : ''
        if (m.includes('model') || m.includes('not_found')) {
          const next = cAvail.find(id => id !== cModel) || cModel
          claudeResp = await anthropic.messages.create({ model: next, max_tokens: 1024, messages, system: 'You are Zero@AgentAI. Use precise, concise Turkish. Provide factual, structured answers.' })
        } else {
          throw e1
        }
      }
      const cTextBlock = Array.isArray(claudeResp?.content) ? claudeResp.content.find(b => b.type === 'text') : null
      const cText = cTextBlock ? cTextBlock.text : ''
      iterations.push({ claude: cText })
      const validatorSystem = 'You are a strict validator. Return JSON only: {"status":"pass|fail","critique":"...","needs":["..."]}. Evaluate correctness, sufficiency and clarity for the user task.'
      let v
      try {
        const r = await openai.chat.completions.create({ model: oModel, messages: [{ role: 'system', content: validatorSystem }, { role: 'user', content: 'Görev: ' + t + '\nCevap:\n' + cText }], max_tokens: 256 })
        const content = r && r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content ? r.choices[0].message.content : ''
        try { v = JSON.parse(content) } catch (_) { v = { status: 'fail', critique: 'Validator JSON parse başarısız', needs: [] } }
      } catch (e2) {
        v = { status: 'fail', critique: 'Validator çağrısı başarısız: ' + (e2 && e2.message ? e2.message : 'bilinmeyen'), needs: [] }
      }
      iterations[iterations.length - 1].validator = v
      if (String(v.status).toLowerCase() === 'pass') {
        finalOut = cText
        break
      }
      const fb = 'Lütfen validator geri bildirimine göre yanıtı düzelt ve tamamla. Geri Bildirim: ' + (v.critique || '') + (Array.isArray(v.needs) && v.needs.length ? ('\nEksikler: ' + v.needs.join(', ')) : '')
      messages.push({ role: 'assistant', content: [{ type: 'text', text: cText }] })
      messages.push({ role: 'user', content: [{ type: 'text', text: fb }] })
    }
    const status = finalOut ? 'pass' : 'fail'
    res.json({ status, output_text: finalOut, iterations })
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.get('/api/pipeline/stream', auth, async (req, res) => {
  try {
    const text = String(req.query.text || '').trim()
    const claude_model = String(req.query.claude_model || '')
    const openai_model = String(req.query.openai_model || '')
    const max_iters_q = Number(req.query.max_iters || 3)
    const history_q = String(req.query.history || '')
    if (!anthropicPool.length || !openaiPool.length) {
      res.status(400).end()
      return
    }
    if (!text) { res.status(400).end(); return }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const send = (event, data) => { res.write(`event: ${event}\n`) ; res.write(`data: ${JSON.stringify(data)}\n\n`) }
    const session_id = String(req.query.session_id || '')
    if (session_id) abortMap.set(session_id, false)
    const cAvail = candidateModels
    const oAvail = candidateOpenAIModels
    const cModel = (claude_model && cAvail.includes(claude_model)) ? claude_model : cAvail[0]
    const oModel = (openai_model && oAvail.includes(openai_model)) ? openai_model : oAvail[0]
    const maxI = Math.max(1, Math.min(5, isNaN(max_iters_q) ? 3 : max_iters_q))
    let baseHist = []
    if (history_q) {
      try {
        const decoded = Buffer.from(history_q, 'base64').toString('utf8')
        const arr = JSON.parse(decoded)
        if (Array.isArray(arr)) baseHist = arr
      } catch (_) {}
    }
    const fileIdsRaw = String(req.query.file_ids || '')
    const mode_q = String(req.query.mode || '')
    let fileContext = ''
    const imageBlocks = []
    if (fileIdsRaw) {
      const ids = fileIdsRaw.split(',').map(s => s.trim()).filter(Boolean)
      const limit = Math.max(1000, parseInt(process.env.FILE_CONTEXT_LIMIT_CHARS || '8000', 10))
      let acc = ''
      for (const id of ids) {
        const fp = path.join(filesDir, id + '.json')
        if (fs.existsSync(fp)) {
          try {
            const j = JSON.parse(fs.readFileSync(fp, 'utf8'))
            if ((j.type || 'text') === 'image' && j.data && j.mime) {
              imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: j.mime, data: j.data } })
            } else if (j.text) {
              const chunk = `\n\n[${j.name}]\n${j.text}`
              if ((acc.length + chunk.length) <= limit) acc += chunk
            }
          } catch (_) {}
        }
      }
      fileContext = acc
    }
    const ctxContent = []
    if (fileContext) ctxContent.push({ type: 'text', text: 'Attached files context:\n' + fileContext })
    for (const ib of imageBlocks) ctxContent.push(ib)
    if (mode_q === 'steel') {
      try {
        const client = new OpenAI({ apiKey: (openaiPool && openaiPool[0]) ? openaiPool[0] : process.env.OPENAI_API_KEY })
        const qr = await client.embeddings.create({ model: 'text-embedding-3-small', input: text })
        const qemb = qr.data[0].embedding
        const files = fs.readdirSync(ragDir).filter(f => f.endsWith('.json'))
        const candidates = []
        for (const f of files) {
          const j = JSON.parse(fs.readFileSync(path.join(ragDir, f), 'utf8'))
          (j.chunks || []).forEach(ch => {
            const score = cosine(qemb, ch.embedding)
            candidates.push({ text: ch.text, score, title: j.title })
          })
        }
        candidates.sort((a,b) => b.score - a.score)
        const top = candidates.slice(0, 3)
        if (top.length) {
          const acc = top.map(it => `\n\n[${it.title}]\n${it.text}`).join('')
          ctxContent.push({ type: 'text', text: 'RAG context:\n' + acc })
        }
      } catch (_) {}
    }
    const ctxMsg = ctxContent.length ? { role: 'user', content: ctxContent } : null
    let messages = [...baseHist, ...(ctxMsg ? [ctxMsg] : []), { role: 'user', content: [{ type: 'text', text: text }] }]
    const systemSteel = 'You are Zero@Steel AI — a steel industry specialist assistant. Use precise, concise technical language aligned with EU CBAM and steel operations. Provide actionable diagnostics and recommendations.'
    const systemDesign = 'You are Zero@Design AI — sustainability design specialist. Answer concisely with design-oriented insights.'
    const systemGeneral = 'You are Zero@AgentAI — a sustainability-focused AI assistant.'
    const systemMsg = mode_q === 'steel' ? systemSteel : (mode_q === 'design' ? systemDesign : systemGeneral)
    for (let i = 0; i < maxI; i++) {
      if (session_id && abortMap.get(session_id) === true) {
        send('status', { cancelled: true })
        abortMap.delete(session_id)
        res.end()
        return
      }
      let claudeResp
      try {
        claudeResp = await callClaude({ model: cModel, max_tokens: 1024, messages, system: systemMsg })
      } catch (e1) {
        const m = e1 && e1.message ? e1.message.toLowerCase() : ''
        if (m.includes('model') || m.includes('not_found')) {
          const next = cAvail.find(id => id !== cModel) || cModel
          claudeResp = await callClaude({ model: next, max_tokens: 1024, messages, system: systemMsg })
        } else { throw e1 }
      }
      const cTextBlock = Array.isArray(claudeResp?.content) ? claudeResp.content.find(b => b.type === 'text') : null
      const cText = cTextBlock ? cTextBlock.text : ''
      send('claude', { index: i, text: cText })
      const validatorSystem = 'You are a strict validator. Return JSON only: {"status":"pass|fail","critique":"...","needs":["..."]}.'
      let v
      try {
        const r = await callOpenAI({ model: oModel, messages: [{ role: 'system', content: validatorSystem }, { role: 'user', content: 'Task: ' + text + '\nAnswer:\n' + cText }], max_tokens: 256 })
        const content = r && r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content ? r.choices[0].message.content : ''
        try { v = JSON.parse(content) } catch (_) { v = { status: 'fail', critique: 'Validator JSON parse failed', needs: [] } }
      } catch (e2) {
        v = { status: 'fail', critique: 'Validator call failed: ' + (e2 && e2.message ? e2.message : 'unknown'), needs: [] }
      }
      send('validator', { index: i, validator: v })
      if (String(v.status).toLowerCase() === 'pass') {
        // auto save session
        ensureDir(sessionDir)
        const sid = String(req.query.session_id || '') || (String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8))
        const fp = path.join(sessionDir, sid + '.json')
        let prev = []
        try { if (fs.existsSync(fp)) { const j = JSON.parse(fs.readFileSync(fp, 'utf8')); if (Array.isArray(j.messages)) prev = j.messages } } catch (_) {}
        const toSave = [...prev, ...messages, { role: 'assistant', content: [{ type: 'text', text: cText }] }]
        try { fs.writeFileSync(fp, JSON.stringify({ messages: toSave, mode: mode_q || 'general', created_at: new Date().toISOString() }, null, 2)) } catch (_) {}
        send('session', { id: sid || session_id })
        logEvent('final', { user: req.user.token })
        send('final', { text: cText })
        if (session_id) abortMap.delete(session_id)
        res.end()
        return
      }
      const fb = 'Adjust answer per validator. Feedback: ' + (v.critique || '') + (Array.isArray(v.needs) && v.needs.length ? ('\nNeeds: ' + v.needs.join(', ')) : '')
      messages.push({ role: 'assistant', content: [{ type: 'text', text: cText }] })
      messages.push({ role: 'user', content: [{ type: 'text', text: fb }] })
    }
    send('status', { done: true })
    if (session_id) abortMap.delete(session_id)
    res.end()
  } catch (err) {
    try { res.write(`event: error\n`); res.write(`data: ${JSON.stringify({ error: err.message || 'Unknown error' })}\n\n`); res.end() } catch (_) {}
  }
})

const sessionDir = path.join(__dirname, 'data', 'sessions')
function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }) } catch (_) {} }
app.post('/api/session/save', auth, async (req, res) => {
  try {
    const { messages } = req.body || {}
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' })
    ensureDir(sessionDir)
    const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8)
    const fp = path.join(sessionDir, id + '.json')
    fs.writeFileSync(fp, JSON.stringify({ messages }, null, 2))
    logEvent('session_save', { user: req.user.token, id })
    res.json({ id })
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})
app.get('/api/session/:id', auth, async (req, res) => {
  try {
    const id = req.params.id
    const fp = path.join(sessionDir, id + '.json')
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'not found' })
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'))
    res.json(data)
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})
app.get('/api/session/list', auth, async (req, res) => {
  try {
    const limit = Math.max(1, parseInt(String(req.query.limit || '50'), 10))
    const query = String(req.query.query || '').toLowerCase()
    ensureDir(sessionDir)
    const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('.json')).map(f => path.join(sessionDir, f))
    files.sort((a, b) => {
      try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs } catch (_) { return 0 }
    })
    const out = []
    for (const fp of files) {
      try {
        const st = fs.statSync(fp)
        const data = JSON.parse(fs.readFileSync(fp, 'utf8'))
        const msgs = Array.isArray(data.messages) ? data.messages : []
        const firstUser = msgs.find(m => m.role === 'user' && Array.isArray(m.content) && m.content[0] && m.content[0].text)
        const title = firstUser ? String(firstUser.content[0].text).slice(0, 80) : ''
        const id = path.basename(fp, '.json')
        const mode = data.mode || 'general'
        const created_at = data.created_at || new Date(st.mtimeMs).toISOString()
        const metaText = (title + ' ' + mode).toLowerCase()
        if (query && !metaText.includes(query)) continue
        out.push({ id, created_at, title, mode })
        if (out.length >= limit) break
      } catch (_) {}
    }
    res.json(out)
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.post('/api/files/save', auth, async (req, res) => {
  try {
    const { name, text, data, mime } = req.body || {}
    if (!name) return res.status(400).json({ error: 'name required' })
    if (!(req.user.role === 'admin' || req.user.role === 'engineer')) return res.status(403).json({ error: 'forbidden' })
    const isImage = !!data && !!mime
    const isText = typeof text === 'string' && text.length > 0
    if (!isImage && !isText && !(data && mime)) return res.status(400).json({ error: 'provide text or data+mime' })
    const sizeB = isText ? Buffer.byteLength(text, 'utf8') : Buffer.byteLength(data || '', 'base64')
    if (sizeB > MAX_FILE_SIZE_MB * 1024 * 1024) return res.status(413).json({ error: 'file_too_large' })
    ensureDir(filesDir)
    const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8)
    const fp = path.join(filesDir, id + '.json')
    let payload
    if (isImage && mime && mime.startsWith('image/')) {
      payload = { id, name, type: 'image', mime, size: Buffer.byteLength(data, 'base64'), data }
    } else if (mime === 'application/pdf' && data) {
      const buf = Buffer.from(data, 'base64')
      const pdf = await pdfParse(buf)
      payload = { id, name, type: 'text', size: Buffer.byteLength(pdf.text || '', 'utf8'), text: pdf.text || '' }
    } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && data) {
      const buf = Buffer.from(data, 'base64')
      const resDoc = await mammoth.extractRawText({ buffer: buf })
      payload = { id, name, type: 'text', size: Buffer.byteLength(resDoc.value || '', 'utf8'), text: resDoc.value || '' }
    } else if (isText) {
      payload = { id, name, type: 'text', size: Buffer.byteLength(text, 'utf8'), text }
    } else {
      payload = { id, name, type: 'binary', size: Buffer.byteLength(data || '', 'base64'), data, mime }
    }
    fs.writeFileSync(fp, JSON.stringify(payload, null, 2))
    logEvent('file_save', { user: req.user.token, id })
    res.json({ id })
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})
app.get('/api/files/list', auth, async (req, res) => {
  try {
    ensureDir(filesDir)
    const items = fs.readdirSync(filesDir).filter(f => f.endsWith('.json')).map(f => {
      try { const j = JSON.parse(fs.readFileSync(path.join(filesDir, f), 'utf8')); return { id: j.id, name: j.name, size: j.size, type: j.type || 'text', mime: j.mime } } catch (_) { return null }
    }).filter(Boolean)
    res.json({ files: items })
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})
app.get('/api/files/:id', auth, async (req, res) => {
  try {
    const id = req.params.id
    const fp = path.join(filesDir, id + '.json')
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'not found' })
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'))
    res.json(data)
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

app.use(express.static(path.join(__dirname, 'public')))
app.get('/healthz', async (req, res) => {
  try {
    const writable = (() => { try { fs.writeFileSync(path.join(logsDir, 'health.tmp'), 'ok'); return true } catch(_) { return false } })()
    res.json({ status: 'ok', uptime_sec: Math.round(process.uptime()), openai_ok: !!openaiPool.length, anthropic_ok: !!anthropicPool.length, fs_writable: writable })
  } catch (err) {
    res.status(500).json({ status: 'error' })
  }
})

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

const port = process.env.PORT || 5173
app.listen(port, () => {
  console.log(`Zero@AgentAI running on http://localhost:${port}`)
})
setInterval(() => {
  try {
    const now = Date.now()
    const ms = RETENTION_DAYS * 24 * 3600 * 1000
    ;[path.join(__dirname, 'data', 'files'), path.join(__dirname, 'data', 'sessions')].forEach(dir => {
      try { fs.mkdirSync(dir, { recursive: true }) } catch (_) {}
      fs.readdirSync(dir).forEach(f => {
        const p = path.join(dir, f)
        const st = fs.statSync(p)
        if (now - st.mtimeMs > ms) { try { fs.unlinkSync(p) } catch(_){} }
      })
    })
  } catch (_) {}
}, 3600 * 1000)
