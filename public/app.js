const chatEl = document.getElementById('chat')
const formEl = document.getElementById('composer')
const inputEl = document.getElementById('input')
const modelEl = document.getElementById('model')
const clearEl = document.getElementById('clear')
const OPENAI_MODEL = 'gpt-4o-mini'
const apiKeyEl = document.getElementById('api-key')
const cancelEl = document.getElementById('cancel')
let currentEventSource = null
let currentSessionId = null
const finalOutEl = document.getElementById('final-output')
const terminalEl = document.getElementById('terminal')
const copyFinalBtn = document.getElementById('copy-final')
const terminalCmdEl = document.getElementById('terminal-cmd')
const terminalRunBtn = document.getElementById('terminal-run')
const filesInputEl = document.getElementById('files-input')
const filesUploadBtn = document.getElementById('files-upload')
const filesListEl = document.getElementById('files-list')
const imagesInputEl = document.getElementById('images-input')
const imagesUploadBtn = document.getElementById('images-upload')
const folderInputEl = document.getElementById('folder-input')
const folderUploadBtn = document.getElementById('folder-upload')
const historyQueryEl = document.getElementById('history-query')
const historyRefreshEl = document.getElementById('history-refresh')
const historyListEl = document.getElementById('history-list')
const actionsEl = document.getElementById('actions')
const roleBadgeEl = document.getElementById('role-badge')
let currentRole = 'user'

function normalizeModel(val) {
  if (!val) return 'claude-3-5-sonnet-latest'
  if (val.includes('sonnet')) return 'claude-3-5-sonnet-latest'
  if (val.includes('haiku')) return 'claude-3-5-haiku-latest'
  return val
}

modelEl.value = normalizeModel(modelEl.value)

let messages = [
  { role: 'user', content: [{ type: 'text', text: 'Merhaba Zero@AgentAI!' }] },
]


async function loadModels() {
  try {
    const res = await fetch('/api/models')
    const data = await res.json()
    if (res.ok && Array.isArray(data.models) && data.models.length) {
      modelEl.innerHTML = ''
      data.models.forEach(id => {
        const opt = document.createElement('option')
        opt.value = id
        opt.textContent = id
        modelEl.appendChild(opt)
      })
      const preferred = data.models.find(id => id.includes('haiku')) || data.models[0]
      modelEl.value = preferred
    }
  } catch (_) {
    // sessiz geç
  }
}

loadModels()

 

render()
terminalEl.textContent = 'Hazır\n'
let lastValidatorItems = []
let selectedFileIds = new Set()

formEl.addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = inputEl.value.trim()
  if (!text) return
  setLoading(true)
  try {
    const encode = (obj) => {
      try { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))) } catch (_) { return '' }
    }
    const sessionId = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
    currentSessionId = sessionId
    const params = new URLSearchParams({ text, claude_model: normalizeModel(modelEl.value), openai_model: OPENAI_MODEL, max_iters: '3', history: encode(messages), file_ids: Array.from(selectedFileIds).join(','), api_key: (apiKeyEl && apiKeyEl.value) ? apiKeyEl.value : '', session_id: sessionId, mode: modeParam })
    const es = new EventSource('/api/pipeline/stream?' + params.toString())
    currentEventSource = es
    messages = []
    render()
    lastValidatorItems = []
    es.addEventListener('claude', (ev) => {
      try { const d = JSON.parse(ev.data); messages.push({ role: 'assistant', content: [{ type: 'text', text: d.text || '' }] }); render() } catch (_) {}
    })
    // validator events ignored for now
    es.addEventListener('session', (ev) => {
      try { const d = JSON.parse(ev.data); terminalEl.textContent += 'Session: ' + (d.id || '') + '\n' } catch (_) {}
    })
    es.addEventListener('final', (ev) => {
      try { const d = JSON.parse(ev.data); finalOutEl.value = d.text || ''; es.close(); setLoading(false) } catch (_) { es.close(); setLoading(false) }
    })
    es.addEventListener('status', (ev) => { try { const d = JSON.parse(ev.data); if (d && d.cancelled) terminalEl.textContent += 'Cancelled by user\n' } catch(_){} es.close(); currentEventSource = null; setLoading(false) })
    es.addEventListener('error', (ev) => { es.close(); setLoading(false); finalOutEl.value = 'Hata' })
  } catch (err) {
    finalOutEl.value = 'Hata: ' + (err && err.message ? err.message : 'Bilinmeyen')
  } finally {
    setLoading(false)
  }
})

clearEl.addEventListener('click', () => {
  inputEl.value = ''
})



function extractText(data) {
  try {
    const blocks = data && data.content ? data.content : (data.output && data.output[0] && data.output[0].content)
    if (Array.isArray(blocks)) {
      const textBlock = blocks.find(b => b.type === 'text')
      return textBlock ? textBlock.text : JSON.stringify(data)
    }
    return typeof data === 'string' ? data : JSON.stringify(data)
  } catch (_) {
    return 'Yanıt çözümlenemedi.'
  }
}

function render() {
  chatEl.innerHTML = ''
  messages.forEach(m => {
    const row = document.createElement('div')
    row.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant')

    const avatar = document.createElement('div')
    avatar.className = 'avatar ' + (m.role === 'user' ? 'user' : 'assistant')
    avatar.textContent = m.role === 'user' ? 'U' : 'A'

    const content = document.createElement('div')
    content.className = 'content'
    const text = m.content && m.content[0] && m.content[0].text ? m.content[0].text : ''
    content.textContent = text

    row.appendChild(avatar)
    row.appendChild(content)
    chatEl.appendChild(row)
  })
  renderActions()
}

function setLoading(isLoading) {
  const sendBtn = document.getElementById('send')
  sendBtn.disabled = isLoading
  sendBtn.textContent = isLoading ? 'Gönderiliyor…' : 'Gönder'
}

 

function renderPipeline(iterations) {
  messages = []
  iterations.forEach(it => {
    messages.push({ role: 'assistant', content: [{ type: 'text', text: it.claude || '' }] })
  })
  render()
}

function terminalLog(iterations, status) {
  const lines = []
  iterations.forEach((it, idx) => {
    lines.push('Claude #' + (idx + 1) + ': ' + (it.claude ? it.claude.slice(0, 200) + (it.claude.length > 200 ? '…' : '') : ''))
  })
  lines.push('Status: ' + status)
  terminalEl.textContent = lines.join('\n')
}

copyFinalBtn.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(finalOutEl.value || '') } catch (_) {}
})
terminalRunBtn.addEventListener('click', async () => {
  const cmd = terminalCmdEl.value.trim()
  if (!cmd) return
  terminalCmdEl.value = ''
  terminalEl.textContent += '$ ' + cmd + '\n'
  try {
    const res = await fetch('/api/terminal/exec', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': (apiKeyEl && apiKeyEl.value) ? apiKeyEl.value : '' }, body: JSON.stringify({ cmd }) })
    const data = await res.json()
    if (!res.ok) {
      terminalEl.textContent += (data && data.error ? data.error : 'Error') + '\n'
      return
    }
    if (data.stdout) terminalEl.textContent += data.stdout
    if (data.stderr) terminalEl.textContent += data.stderr
    terminalEl.textContent += (typeof data.code === 'number' ? ('[exit ' + data.code + ']\n') : '')
  } catch (err) {
    terminalEl.textContent += 'Error: ' + (err && err.message ? err.message : 'Unknown') + '\n'
  }
})

filesUploadBtn.addEventListener('click', async () => {
  const files = Array.from(filesInputEl.files || [])
  if (!files.length) return
  for (const f of files) {
    try {
      let body
      if (f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf') {
        const { base64 } = await readImageBase64(f)
        body = { name: f.name, data: base64, mime: 'application/pdf' }
      } else if (f.name.toLowerCase().endsWith('.docx') || f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const { base64 } = await readImageBase64(f)
        body = { name: f.name, data: base64, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
      } else {
        const txt = await readFileText(f)
        body = { name: f.name, text: txt }
      }
      const res = await fetch('/api/files/save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': (apiKeyEl && apiKeyEl.value) ? apiKeyEl.value : '' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (res.ok && data.id) {
        terminalEl.textContent += 'Uploaded: ' + f.name + '\n'
      } else {
        terminalEl.textContent += 'Upload error: ' + (data && data.error ? data.error : 'Unknown') + '\n'
      }
    } catch (err) {
      terminalEl.textContent += 'Upload error: ' + (err && err.message ? err.message : 'Unknown') + '\n'
    }
  }
  filesInputEl.value = ''
  await refreshFiles()
})

imagesUploadBtn.addEventListener('click', async () => {
  const files = Array.from(imagesInputEl.files || [])
  if (!files.length) return
  for (const f of files) {
    const { base64, mime } = await readImageBase64(f)
    try {
      const res = await fetch('/api/files/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, data: base64, mime }) })
      const data = await res.json()
      if (res.ok && data.id) {
        terminalEl.textContent += 'Uploaded image: ' + f.name + '\n'
      } else {
        terminalEl.textContent += 'Upload error: ' + (data && data.error ? data.error : 'Unknown') + '\n'
      }
    } catch (err) {
      terminalEl.textContent += 'Upload error: ' + (err && err.message ? err.message : 'Unknown') + '\n'
    }
  }
  imagesInputEl.value = ''
  await refreshFiles()
})

folderUploadBtn.addEventListener('click', async () => {
  const files = Array.from(folderInputEl.files || [])
  if (!files.length) return
  for (const f of files) {
    if ((f.type || '').startsWith('image/')) {
      const { base64, mime } = await readImageBase64(f)
      await fetch('/api/files/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, data: base64, mime }) })
    } else {
      const txt = await readFileText(f)
      await fetch('/api/files/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, text: txt }) })
    }
  }
  folderInputEl.value = ''
  terminalEl.textContent += 'Folder uploaded.\n'
  await refreshFiles()
})

async function refreshFiles() {
  try {
    const res = await fetch('/api/files/list', { headers: { 'X-API-Key': (apiKeyEl && apiKeyEl.value) ? apiKeyEl.value : '' } })
    const data = await res.json()
    if (res.ok && Array.isArray(data.files)) {
      filesListEl.innerHTML = ''
      data.files.forEach(f => {
        const row = document.createElement('div')
        row.className = 'file-item'
        const cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.checked = selectedFileIds.has(f.id)
        cb.addEventListener('change', () => { if (cb.checked) selectedFileIds.add(f.id); else selectedFileIds.delete(f.id) })
        const label = document.createElement('span')
        label.textContent = f.name + ' (' + (f.size || 0) + ' bytes)'
        row.appendChild(cb)
        row.appendChild(label)
        filesListEl.appendChild(row)
      })
    }
  } catch (_) {}
}

cancelEl.addEventListener('click', async () => {
  try {
    if (currentEventSource) { currentEventSource.close(); currentEventSource = null }
    if (currentSessionId) {
      await fetch('/api/chat/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': (apiKeyEl && apiKeyEl.value) ? apiKeyEl.value : '' },
        body: JSON.stringify({ session_id: currentSessionId })
      })
      terminalEl.textContent += 'Cancel requested\n'
    }
  } catch (_) {}
})

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('read error'))
    reader.readAsText(file)
  })
}

function readImageBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const parts = result.split(',')
      resolve({ base64: parts[1] || '', mime: file.type || 'image/png' })
    }
    reader.onerror = () => reject(reader.error || new Error('read error'))
    reader.readAsDataURL(file)
  })
}

refreshFiles()
await refreshRole()

async function refreshHistory() {
  try {
    const q = (historyQueryEl && historyQueryEl.value) ? historyQueryEl.value.trim() : ''
    const url = '/api/session/list?limit=20' + (q ? ('&query=' + encodeURIComponent(q)) : '')
    const res = await fetch(url, { headers: { 'X-API-Key': (apiKeyEl && apiKeyEl.value) ? apiKeyEl.value : '' } })
    const data = await res.json()
    if (res.ok && Array.isArray(data)) {
      historyListEl.innerHTML = ''
      data.forEach(item => {
        const row = document.createElement('div')
        row.className = 'history-item'
        const title = document.createElement('div')
        title.textContent = item.title || '(no title)'
        const meta = document.createElement('div')
        meta.style.fontSize = '12px'
        meta.style.color = '#4a4a4a'
        meta.textContent = (item.created_at || '')
        const badge = document.createElement('span')
        badge.className = 'badge'
        badge.textContent = item.mode || 'general'
        meta.appendChild(badge)
        row.appendChild(title)
        row.appendChild(meta)
        row.onclick = async () => {
          try {
            const r = await fetch('/api/session/' + encodeURIComponent(item.id), { headers: { 'X-API-Key': (apiKeyEl && apiKeyEl.value) ? apiKeyEl.value : '' } })
            const j = await r.json()
            if (r.ok && j && Array.isArray(j.messages)) {
              messages = j.messages
              render()
              finalOutEl.value = ''
              terminalEl.textContent += 'Loaded session ' + item.id + '\n'
            }
          } catch (_) {}
        }
        historyListEl.appendChild(row)
      })
    }
  } catch (_) {}
}

historyRefreshEl.addEventListener('click', refreshHistory)
historyQueryEl.addEventListener('input', () => { if (!historyQueryEl.value || historyQueryEl.value.length >= 2) refreshHistory() })
refreshHistory()
function renderActions() {
  if (!actionsEl) return
  actionsEl.innerHTML = ''
  const latest = messages[messages.length - 1]
  const text = latest && latest.content && latest.content[0] && latest.content[0].text ? latest.content[0].text : ''
  const items = []
  if (/cbam/i.test(text)) {
    const m = text.match(/batch\s([A-Za-z0-9_-]+)/i)
    const bid = m ? m[1] : ''
    items.push({ title: 'Generate CBAM Report' , action: 'cbam', batch_id: bid })
  }
  if (/open\s*batch/i.test(text)) {
    const m = text.match(/batch\s([A-Za-z0-9_-]+)/i)
    const bid = m ? m[1] : ''
    items.push({ title: 'Open Batch', action: 'open_batch', batch_id: bid })
  }
  items.forEach(it => {
    const card = document.createElement('div')
    card.className = 'action-card'
    const t = document.createElement('div')
    t.className = 'title'
    t.textContent = it.title + (it.batch_id ? (' [' + it.batch_id + ']') : '')
    const btn = document.createElement('button')
    btn.className = 'run'
    btn.textContent = 'Run'
    btn.onclick = async () => {
      try {
        if (it.action === 'cbam') {
          await fetch('/api/auto/cbam-report', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': (apiKeyEl && apiKeyEl.value) ? apiKeyEl.value : '' }, body: JSON.stringify({ batch_id: it.batch_id }) })
        } else if (it.action === 'open_batch') {
          await fetch('/api/auto/open-batch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': (apiKeyEl && apiKeyEl.value) ? apiKeyEl.value : '' }, body: JSON.stringify({ batch_id: it.batch_id }) })
        }
        await fetch('/api/actions/log', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': (apiKeyEl && apiKeyEl.value) ? apiKeyEl.value : '' }, body: JSON.stringify({ action: it.action, meta: it }) })
        terminalEl.textContent += 'Action executed: ' + it.title + '\n'
      } catch (_) {}
    }
    card.appendChild(t)
    card.appendChild(btn)
    actionsEl.appendChild(card)
  })
}
async function refreshRole() {
  try {
    const res = await fetch('/api/me', { headers: { 'X-API-Key': (apiKeyEl && apiKeyEl.value) ? apiKeyEl.value : '' } })
    const data = await res.json()
    if (res.ok && data && data.role) {
      currentRole = data.role
      if (roleBadgeEl) roleBadgeEl.textContent = currentRole
      applyRoleVisibility()
    }
  } catch (_) {}
}

function applyRoleVisibility() {
  const filesPanel = document.getElementById('files-list')?.parentElement
  const terminalPanel = document.getElementById('terminal')?.parentElement?.parentElement
  const historyPanel = document.getElementById('history-panel')
  if (currentRole === 'operator') {
    if (filesPanel) filesPanel.style.display = 'none'
    if (terminalPanel) terminalPanel.style.display = 'none'
    if (historyPanel) historyPanel.style.display = 'none'
  } else if (currentRole === 'exec') {
    if (filesPanel) filesPanel.style.display = 'none'
    if (terminalPanel) terminalPanel.style.display = 'none'
    if (historyPanel) historyPanel.style.display = ''
  } else if (currentRole === 'engineer') {
    if (filesPanel) filesPanel.style.display = ''
    if (terminalPanel) terminalPanel.style.display = ''
    if (historyPanel) historyPanel.style.display = ''
  } else if (currentRole === 'admin') {
    if (filesPanel) filesPanel.style.display = ''
    if (terminalPanel) terminalPanel.style.display = ''
    if (historyPanel) historyPanel.style.display = ''
  }
}
const urlParams = new URLSearchParams(location.search)
const modeParam = urlParams.get('mode') || ''
