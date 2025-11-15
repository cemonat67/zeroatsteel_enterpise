const cfg = window.ZERO_STEEL_CONFIG
document.getElementById('env').textContent = cfg.ENV
const supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY)
const emailEl = document.getElementById('email')
const passEl = document.getElementById('password')
const loginEl = document.getElementById('login')
const logoutEl = document.getElementById('logout')

async function loadEnterpriseSettings() {
  const url = `${cfg.SUPABASE_URL}/rest/v1/enterprise_settings?select=*`
  const r = await fetch(url, { headers: { apikey: cfg.SUPABASE_KEY, Authorization: `Bearer ${cfg.SUPABASE_KEY}` } })
  const rows = await r.json()
  const map = {}
  rows.forEach(row => { map[row.key] = row.value })
  return {
    ets: map['ets_price_eur_per_tco2'],
    cbam_floor: map['cbam_price_floor_eur_per_tco2'],
    elec: map['electricity_price_eur_per_mwh'],
    gas: map['natural_gas_price_eur_per_mwh'],
    h2_price: map['h2_price_eur_per_kg'],
    h2_blend: map['h2_blend_max_pct'],
    scrap: map['scrap_price_baseline'],
    factors: map['emission_factors_overrides']
  }
}

async function loadPlantMetadata(plantId) {
  const url = `${cfg.SUPABASE_URL}/rest/v1/plant_metadata?plant_id=eq.${encodeURIComponent(plantId)}&select=*`
  const r = await fetch(url, { headers: { apikey: cfg.SUPABASE_KEY, Authorization: `Bearer ${cfg.SUPABASE_KEY}` } })
  const rows = await r.json()
  return rows && rows[0] ? rows[0] : null
}

function renderExecKPI(settings) {
  const el = document.getElementById('exec-kpi')
  el.innerHTML = ''
  const cards = [
    { title: 'ETS €/tCO₂', value: settings.ets?.value },
    { title: 'CBAM Floor €/tCO₂', value: settings.cbam_floor?.value },
    { title: 'Electricity €/MWh', value: settings.elec?.value },
    { title: 'H₂ €/kg', value: settings.h2_price?.value }
  ]
  cards.forEach(c => {
    const d = document.createElement('div')
    d.style.display = 'inline-block'
    d.style.padding = '10px'
    d.style.marginRight = '10px'
    d.style.border = '1px solid #e6e6e6'
    d.style.borderRadius = '8px'
    const t = document.createElement('div')
    t.style.fontWeight = '700'
    t.textContent = c.title
    const v = document.createElement('div')
    v.style.fontSize = '20px'
    v.textContent = (c.value !== undefined && c.value !== null) ? String(c.value) : '—'
    d.appendChild(t)
    d.appendChild(v)
    el.appendChild(d)
  })
}

function renderExecSlides(settings) {
  const el = document.getElementById('exec-slides')
  el.innerHTML = ''
  const blocks = [
    { title: 'Energy Mix', lines: [
      `Electricity: ${settings.elec?.value ?? '—'} €/MWh`,
      `Natural Gas: ${settings.gas?.value ?? '—'} €/MWh`
    ]},
    { title: 'Hydrogen', lines: [
      `Price: ${settings.h2_price?.value ?? '—'} €/kg`,
      `Blend cap: ${(settings.h2_blend?.value ?? '—')}`
    ]},
    { title: 'Emission Factors (Overrides)', lines: [
      `Electricity kg/kWh: ${settings.factors?.electricity_kg_per_kwh ?? '—'}`,
      `Gas kg/MWh: ${settings.factors?.natural_gas_kg_per_mwh ?? '—'}`,
      `Lime kg/kg: ${settings.factors?.lime_kg_per_kg ?? '—'}`,
      `Dolomite kg/kg: ${settings.factors?.dolomite_kg_per_kg ?? '—'}`
    ]}
  ]
  blocks.forEach(b => {
    const box = document.createElement('div')
    box.style.border = '1px solid #e6e6e6'
    box.style.borderRadius = '8px'
    box.style.padding = '10px'
    box.style.marginBottom = '10px'
    const t = document.createElement('div')
    t.style.fontWeight = '700'
    t.textContent = b.title
    const ul = document.createElement('ul')
    b.lines.forEach(line => { const li = document.createElement('li'); li.textContent = line; ul.appendChild(li) })
    box.appendChild(t)
    box.appendChild(ul)
    el.appendChild(box)
  })
}

function setupCbamCalculator(settings) {
  const btn = document.getElementById('cbam-calc')
  btn.onclick = () => {
    const ton = parseFloat(document.getElementById('cbam-ton').value || '0')
    const intensity = parseFloat(document.getElementById('cbam-intensity').value || '0')
    const price = (settings.cbam_floor?.value ?? settings.ets?.value ?? 0)
    const cost = Math.round(ton * intensity * price)
    const out = { tonnage: ton, intensity_tco2_per_ton: intensity, price_eur_per_tco2: price, cbam_cost_eur: cost }
    document.getElementById('cbam-result').textContent = JSON.stringify(out, null, 2)
  }
}

function setupCbamAutomation() {
  const btn = document.getElementById('cbam-report')
  btn.onclick = async () => {
    try {
      const id = 'cbam_' + Date.now().toString(36)
      const r = await fetch('/api/auto/cbam-report', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: cfg.CHAT_API_KEY ? `Bearer ${cfg.CHAT_API_KEY}` : '' }, body: JSON.stringify({ batch_id: id }) })
      const d = await r.json()
      if (!r.ok) return alert(d.error || 'error')
      alert('CBAM report queued: ' + (d.batch_id || ''))
    } catch (e) { alert(e.message || 'CBAM report failed') }
  }
}

function setupCbamDownload(settings) {
  const btn = document.getElementById('cbam-download')
  if (!btn) return
  btn.onclick = async () => {
    try {
      const scRaw = document.getElementById('sc-result').textContent || '{}'
      let sc = {}
      try { sc = JSON.parse(scRaw) } catch (_) {}
      const ton = sc.tonnage ?? parseFloat(document.getElementById('cbam-ton').value || '0')
      const intensity = sc.intensity_tco2_per_ton ?? parseFloat(document.getElementById('cbam-intensity').value || '0')
      const ets = sc.scenario?.ets_eur_per_tco2 ?? (settings.ets?.value ?? 0)
      const elec = sc.scenario?.elec_eur_per_mwh ?? (settings.elec?.value ?? 0)
      const h2p = sc.scenario?.h2_eur_per_kg ?? (settings.h2_price?.value ?? 0)
      const blend = sc.scenario?.h2_blend ?? (settings.h2_blend?.value ?? 0)
      const r = await fetch(`${cfg.CHAT_API}/api/reports/cbam`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: cfg.CHAT_API_KEY ? `Bearer ${cfg.CHAT_API_KEY}` : '' }, body: JSON.stringify({ tonnage: ton, intensity_tco2_per_ton: intensity, ets_eur_per_tco2: ets, elec_eur_per_mwh: elec, h2_eur_per_kg: h2p, h2_blend: blend }) })
      const d = await r.json()
      if (!r.ok) return alert(d.error || 'error')
      const url = d.url || (d.result && d.result.pdf_url)
      if (url) {
        window.open(url, '_blank')
      } else {
        alert('No PDF URL returned')
      }
    } catch (e) { alert(e.message || 'Download failed') }
  }
}

function setupExecScenario(settings) {
  const tonEl = document.getElementById('sc-ton')
  const intenEl = document.getElementById('sc-intensity')
  const mwhEl = document.getElementById('sc-mwh')
  const etsEl = document.getElementById('sc-ets')
  const elecEl = document.getElementById('sc-elec')
  const h2El = document.getElementById('sc-h2')
  const h2kgEl = document.getElementById('sc-h2kg')
  const blendEl = document.getElementById('sc-blend')
  tonEl.value = 1000
  intenEl.value = 1.8
  mwhEl.value = 3.0
  etsEl.value = settings.ets?.value ?? 80
  elecEl.value = settings.elec?.value ?? 120
  h2El.value = settings.h2_price?.value ?? 5
  h2kgEl.value = 10
  blendEl.value = settings.h2_blend?.value ?? 0.2
  const btn = document.getElementById('sc-run')
  btn.onclick = () => {
    const ton = parseFloat(tonEl.value || '0')
    const intensity = parseFloat(intenEl.value || '0')
    const mwhPerTon = parseFloat(mwhEl.value || '0')
    const ets = parseFloat(etsEl.value || '0')
    const elec = parseFloat(elecEl.value || '0')
    const h2p = parseFloat(h2El.value || '0')
    const h2kg = parseFloat(h2kgEl.value || '0')
    const blend = parseFloat(blendEl.value || '0')
    const baseEts = settings.ets?.value ?? ets
    const baseElec = settings.elec?.value ?? elec
    const baseH2p = settings.h2_price?.value ?? h2p
    const baseBlend = settings.h2_blend?.value ?? blend
    const cbamCost = ton * intensity * ets
    const elecCost = ton * mwhPerTon * elec
    const h2Cost = ton * h2kg * h2p * blend
    const total = Math.round(cbamCost + elecCost + h2Cost)
    const baseCbam = ton * intensity * baseEts
    const baseElecCost = ton * mwhPerTon * baseElec
    const baseH2Cost = ton * h2kg * baseH2p * baseBlend
    const baseTotal = Math.round(baseCbam + baseElecCost + baseH2Cost)
    const delta = total - baseTotal
    const out = { tonnage: ton, intensity_tco2_per_ton: intensity, mwh_per_ton: mwhPerTon, scenario: { ets_eur_per_tco2: ets, elec_eur_per_mwh: elec, h2_eur_per_kg: h2p, h2_blend: blend }, costs_eur: { cbam: Math.round(cbamCost), electricity: Math.round(elecCost), h2: Math.round(h2Cost), total }, baseline_eur: { cbam: Math.round(baseCbam), electricity: Math.round(baseElecCost), h2: Math.round(baseH2Cost), total: baseTotal }, delta_eur: delta }
    document.getElementById('sc-result').textContent = JSON.stringify(out, null, 2)
  }
}

async function loadFurnaces() {
  const r = await fetch(`${cfg.SUPABASE_URL}/rest/v1/furnaces?select=*`, {
    headers: { apikey: cfg.SUPABASE_KEY, Authorization: `Bearer ${cfg.SUPABASE_KEY}` }
  })
  return await r.json()
}

async function checkHealth() {
  const r = await fetch(`${cfg.SUPABASE_URL}/rest/v1/v_system_status?select=*`, {
    headers: { apikey: cfg.SUPABASE_KEY, Authorization: `Bearer ${cfg.SUPABASE_KEY}` }
  })
  const d = await r.json()
  return d && d[0] ? d[0] : {}
}

async function askAI(prompt) {
  const r = await fetch(`${cfg.N8N_URL}/zero-steel/ai-analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  })
  return await r.json()
}

async function boot() {
  const plantId = 'TKSE_DUISBURG_MAIN'
  try {
    const settings = await loadEnterpriseSettings()
    renderExecKPI(settings)
    renderExecSlides(settings)
    setupCbamCalculator(settings)
    setupCbamAutomation()
    setupCbamDownload(settings)
    setupExecScenario(settings)
    const meta = await loadPlantMetadata(plantId)
    document.getElementById('plant-meta').textContent = JSON.stringify(meta || {}, null, 2)
    await renderCharts()
    setupPdfExport(settings)
  } catch (_) {
    document.getElementById('exec-kpi').textContent = 'Supabase settings okunamadı'
  }
  const furnaces = await loadFurnaces()
  const fEl = document.getElementById('furnaces')
  fEl.innerHTML = ''
  furnaces.forEach(f => {
    const row = document.createElement('div')
    row.textContent = `${f.id || ''} ${f.name || ''} ${f.status || ''}`
    fEl.appendChild(row)
  })

  const h = await checkHealth()
  document.getElementById('health').textContent = JSON.stringify(h, null, 2)

  document.getElementById('ask').addEventListener('click', async () => {
    const prompt = document.getElementById('prompt').value.trim()
    if (!prompt) return
    const resp = await askAI(prompt)
    document.getElementById('ai').textContent = JSON.stringify(resp, null, 2)
  })

  const btn = document.getElementById('aiCompanionBtn')
  const drawer = document.getElementById('aiDrawer')
  const frame = document.getElementById('aiFrame')
  btn.onclick = () => {
    if (!frame.src) {
      const url = new URL(cfg.CHAT_URL)
      url.searchParams.set('mode', 'steel')
      if (cfg.CHAT_API_KEY) url.searchParams.set('api_key', cfg.CHAT_API_KEY)
      frame.src = url.toString()
    }
    drawer.classList.toggle('open')
  }
}

function setupScenarioExport() {
  const btn = document.getElementById('sc-export')
  btn.onclick = () => {
    try {
      const raw = document.getElementById('sc-result').textContent || '{}'
      const j = JSON.parse(raw)
      const rows = [
        ['tonnage','intensity_tco2_per_ton','mwh_per_ton','ets_eur_per_tco2','elec_eur_per_mwh','h2_eur_per_kg','h2_blend','cbam_cost_eur','electricity_cost_eur','h2_cost_eur','total_cost_eur','baseline_total_eur','delta_eur'],
        [j.tonnage,j.intensity_tco2_per_ton,j.mwh_per_ton,j.scenario?.ets_eur_per_tco2,j.scenario?.elec_eur_per_mwh,j.scenario?.h2_eur_per_kg,j.scenario?.h2_blend,j.costs_eur?.cbam,j.costs_eur?.electricity,j.costs_eur?.h2,j.costs_eur?.total,j.baseline_eur?.total,j.delta_eur]
      ]
      const csv = rows.map(r => r.join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'scenario.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch (_) { alert('Export failed') }
  }
}

function setupScenarioPresets() {
  const ets70 = document.getElementById('preset-ets-70')
  const ets90 = document.getElementById('preset-ets-90')
  const e100 = document.getElementById('preset-elec-100')
  const e140 = document.getElementById('preset-elec-140')
  const b01 = document.getElementById('preset-blend-01')
  const b03 = document.getElementById('preset-blend-03')
  const m25 = document.getElementById('preset-mwh-25')
  const m35 = document.getElementById('preset-mwh-35')
  const reset = document.getElementById('preset-reset')
  if (ets70) ets70.onclick = () => { const el = document.getElementById('sc-ets'); if (el) el.value = 70 }
  if (ets90) ets90.onclick = () => { const el = document.getElementById('sc-ets'); if (el) el.value = 90 }
  if (e100) e100.onclick = () => { const el = document.getElementById('sc-elec'); if (el) el.value = 100 }
  if (e140) e140.onclick = () => { const el = document.getElementById('sc-elec'); if (el) el.value = 140 }
  if (b01) b01.onclick = () => { const el = document.getElementById('sc-blend'); if (el) el.value = 0.1 }
  if (b03) b03.onclick = () => { const el = document.getElementById('sc-blend'); if (el) el.value = 0.3 }
  if (m25) m25.onclick = () => { const el = document.getElementById('sc-mwh'); if (el) el.value = 2.5 }
  if (m35) m35.onclick = () => { const el = document.getElementById('sc-mwh'); if (el) el.value = 3.5 }
  if (reset) reset.onclick = () => {
    const ets = document.getElementById('sc-ets')
    const elec = document.getElementById('sc-elec')
    const h2p = document.getElementById('sc-h2')
    const blend = document.getElementById('sc-blend')
    const inten = document.getElementById('sc-intensity')
    const mwh = document.getElementById('sc-mwh')
    const ton = document.getElementById('sc-ton')
    if (ets) ets.value = 80
    if (elec) elec.value = 120
    if (h2p) h2p.value = 5
    if (blend) blend.value = 0.2
    if (inten) inten.value = 1.8
    if (mwh) mwh.value = 3.0
    if (ton) ton.value = 1000
  }
}

function setupRagUpload() {
  const btn = document.getElementById('rag-index')
  if (!btn) return
  btn.onclick = async () => {
    try {
      const titleEl = document.getElementById('rag-title')
      const fileEl = document.getElementById('rag-file')
      const title = titleEl && titleEl.value ? titleEl.value.trim() : 'doc'
      const files = fileEl && fileEl.files ? Array.from(fileEl.files) : []
      if (!files.length) return alert('file required')
      const readFile = (f) => new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result || '').split(',')[1]); fr.onerror = () => reject(new Error('read failed')); fr.readAsDataURL(f) })
      const ids = []
      for (const f of files) {
        const b64 = await readFile(f)
        const r1 = await fetch(`${cfg.CHAT_API}/api/files/save`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: cfg.CHAT_API_KEY ? `Bearer ${cfg.CHAT_API_KEY}` : '' }, body: JSON.stringify({ name: f.name, data: b64, mime: f.type }) })
        const d1 = await r1.json()
        if (!r1.ok) return alert(d1.error || 'error')
        ids.push(d1.id)
      }
      const r2 = await fetch(`${cfg.CHAT_API}/api/rag/index`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: cfg.CHAT_API_KEY ? `Bearer ${cfg.CHAT_API_KEY}` : '' }, body: JSON.stringify({ title, file_ids: ids }) })
      const d2 = await r2.json()
      if (!r2.ok) return alert(d2.error || 'error')
      const outEl = document.getElementById('rag-result')
      if (outEl) outEl.textContent = JSON.stringify(d2, null, 2)
    } catch (e) { alert(e.message || 'RAG index failed') }
  }
}

loginEl.onclick = async () => {
  try {
    const { data, error } = await supa.auth.signInWithPassword({ email: emailEl.value, password: passEl.value })
    if (error) return alert(error.message)
    const tok = data.session && data.session.access_token
    if (tok) {
      cfg.CHAT_API_KEY = tok
      alert('Logged in')
    }
  } catch (e) { alert(e.message || 'Login failed') }
}
logoutEl.onclick = async () => { await supa.auth.signOut(); cfg.CHAT_API_KEY = ''; alert('Logged out') }

boot()
setupScenarioExport()
setupScenarioPresets()
setupRagUpload()
async function loadRollingEnergy(limit = 50) {
  const url = `${cfg.SUPABASE_URL}/rest/v1/rolling_energy?select=*&order=timestamp.desc&limit=${limit}`
  const r = await fetch(url, { headers: { apikey: cfg.SUPABASE_KEY, Authorization: `Bearer ${cfg.SUPABASE_KEY}` } })
  return await r.json()
}

function renderMiniChart(elId, values) {
  const w = 320, h = 80
  const min = Math.min(...values), max = Math.max(...values)
  const scaleX = (i) => (i / Math.max(1, values.length - 1)) * (w - 20) + 10
  const scaleY = (v) => h - 10 - ((v - min) / (Math.max(0.0001, max - min))) * (h - 20)
  const pts = values.map((v, i) => `${Math.round(scaleX(i))},${Math.round(scaleY(v))}`).join(' ')
  const svg = `<svg width="${w}" height="${h}"><polyline fill="none" stroke="#02154e" stroke-width="2" points="${pts}"/></svg>`
  const el = document.getElementById(elId)
  if (el) el.innerHTML = svg
}

async function renderCharts() {
  try {
    const rows = await loadRollingEnergy(60)
    const energy = []
    const co2 = []
    rows.reverse().forEach(r => {
      const kwh = parseFloat(r.kwh || 0)
      const tons = parseFloat(r.tons || 0.0001)
      const co2kg = parseFloat(r.co2_kg || 0)
      energy.push(kwh / tons)
      co2.push(co2kg / tons)
    })
    renderMiniChart('charts-energy', energy)
    renderMiniChart('charts-co2', co2)
  } catch (_) {}
}

function setupPdfExport(settings) {
  const btn = document.getElementById('export-pdf')
  if (!btn) return
  btn.onclick = () => {
    try {
      const scRaw = document.getElementById('sc-result').textContent || '{}'
      const sc = JSON.parse(scRaw)
      const kpi = [
        ['ETS €/tCO₂', settings.ets?.value],
        ['CBAM Floor €/tCO₂', settings.cbam_floor?.value],
        ['Electricity €/MWh', settings.elec?.value],
        ['H₂ €/kg', settings.h2_price?.value]
      ]
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Executive Report</title><style>body{font-family:system-ui;padding:20px}h1{margin:0 0 10px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 10px}</style></head><body><h1>Executive Report — TKSE_DUISBURG_MAIN</h1><h2>KPIs</h2><table>${kpi.map(([k,v])=>`<tr><td>${k}</td><td>${v??'—'}</td></tr>`).join('')}</table><h2>Scenario</h2><pre>${JSON.stringify(sc,null,2)}</pre></body></html>`
      const w = window.open('', '_blank')
      if (w) { w.document.write(html); w.document.close(); w.focus(); w.print() }
    } catch (e) { alert(e.message || 'Export failed') }
  }
}
