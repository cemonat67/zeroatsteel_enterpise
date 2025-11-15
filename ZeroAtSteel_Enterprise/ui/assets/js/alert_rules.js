const apiKeyEl = document.getElementById('api-key')
const listEl = document.getElementById('rules-list')
const idEl = document.getElementById('rule-id')
const nameEl = document.getElementById('rule-name')
const jsonEl = document.getElementById('rule-json')
const enabledEl = document.getElementById('rule-enabled')
const saveEl = document.getElementById('save-rule')
const delEl = document.getElementById('delete-rule')

async function refresh() {
  try {
    const res = await fetch('/api/alert-rules', { headers: { 'X-API-Key': apiKeyEl.value || '' } })
    const data = await res.json()
    if (res.ok && data && Array.isArray(data.rules)) {
      listEl.innerHTML = ''
      data.rules.forEach(r => {
        const row = document.createElement('div')
        row.className = 'history-item'
        const t = document.createElement('div')
        t.textContent = r.name + ' [' + r.id + ']'
        const meta = document.createElement('div')
        meta.style.fontSize = '12px'
        meta.textContent = JSON.stringify(r.rule)
        const badge = document.createElement('span')
        badge.className = 'badge'
        badge.textContent = r.enabled ? 'enabled' : 'disabled'
        meta.appendChild(badge)
        row.appendChild(t)
        row.appendChild(meta)
        row.onclick = () => {
          idEl.value = r.id
          nameEl.value = r.name
          jsonEl.value = JSON.stringify(r.rule, null, 2)
          enabledEl.checked = !!r.enabled
        }
        listEl.appendChild(row)
      })
    }
  } catch (_) {}
}

saveEl.onclick = async () => {
  try {
    const rule = JSON.parse(jsonEl.value || '{}')
    const body = { id: idEl.value || undefined, name: nameEl.value, rule, enabled: enabledEl.checked }
    const res = await fetch('/api/alert-rules', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKeyEl.value || '' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (res.ok) { await refresh() }
    else alert(data.error || 'error')
  } catch (e) { alert(e.message || 'invalid rule json') }
}
delEl.onclick = async () => {
  try {
    const rid = idEl.value
    if (!rid) return alert('id required')
    const res = await fetch('/api/alert-rules/' + encodeURIComponent(rid), { method: 'DELETE', headers: { 'X-API-Key': apiKeyEl.value || '' } })
    const data = await res.json()
    if (res.ok) { idEl.value=''; nameEl.value=''; jsonEl.value=''; await refresh() }
    else alert(data.error || 'error')
  } catch (e) { alert(e.message || 'delete failed') }
}

refresh()
