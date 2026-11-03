const $ = (id) => document.getElementById(id)
const state = {
  token: localStorage.getItem('teamplane.token') ?? '',
  events: [],
  source: null,
  timer: null,
  noStream: false,
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      authorization: `Bearer ${state.token}`,
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { raw: text }
  }
  if (!response.ok) {
    const error = payload?.error
    throw new Error(error ? `${error.code}: ${error.message}` : `HTTP ${response.status}`)
  }
  return payload
}

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function badge(text, tone = '') {
  return element('span', `badge ${tone}`.trim(), text)
}

function short(id) {
  return String(id ?? '').length > 22 ? `${String(id).slice(0, 10)}…${String(id).slice(-6)}` : String(id ?? '')
}

function when(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

async function connect() {
  const token = $('token').value.trim()
  if (!token) return
  state.token = token
  try {
    const me = await api('/v1/me')
    localStorage.setItem('teamplane.token', token)
    $('gate').hidden = true
    $('app').hidden = false
    $('principal').textContent = `${me.principal.display} · ${me.roles.join(', ')}`
    await refresh()
    startStream()
    if (state.timer) clearInterval(state.timer)
    state.timer = setInterval(refresh, 5000)
  } catch (error) {
    $('gate-error').textContent = error.message
    localStorage.removeItem('teamplane.token')
  }
}

async function refresh() {
  try {
    const snapshot = await api('/v1/state')
    $('team-name').textContent = snapshot.name ?? ''
    $('stat-tasks').textContent = String(snapshot.tasks?.length ?? 0)
    $('stat-leases').textContent = String(snapshot.leases?.length ?? 0)
    $('stat-approvals').textContent = String(snapshot.approvals?.length ?? 0)
    $('stat-events').textContent = String(snapshot.events ?? 0)
    renderTasks(snapshot.tasks ?? [])
    renderApprovals(snapshot.approvals ?? [])
    if (!$('task-repo').value && snapshot.tasks?.[0]?.repoPath) $('task-repo').placeholder = snapshot.tasks[0].repoPath
    const policy = await api('/v1/policy')
    $('policy-json').textContent = JSON.stringify(policy, null, 2)
    if (state.noStream) {
      const feed = await api('/v1/events?since=0')
      state.events = (feed.events ?? []).slice(-12).reverse()
      renderFeed()
      $('live-dot').className = 'dot on'
      $('live-label').textContent = 'snapshot'
    }
  } catch (error) {
    $('live-label').textContent = error.message
  }
}

function renderTasks(tasks) {
  const overview = $('overview-tasks')
  overview.replaceChildren()
  const tableBody = $('tasks-table').querySelector('tbody')
  tableBody.replaceChildren()
  if (tasks.length === 0) {
    overview.append(element('p', 'muted', 'No tasks yet.'))
    return
  }
  for (const task of tasks) {
    const row = element('div', 'item')
    row.append(element('span', 'id', short(task.id)))
    row.append(element('span', 'title', task.title))
    row.append(element('span', 'spacer'))
    row.append(badge(task.status, task.status === 'merged' ? 'ok' : task.status === 'active' ? 'warn' : ''))
    overview.append(row)

    const tr = document.createElement('tr')
    const idCell = element('td', 'mono', short(task.id))
    const titleCell = element('td', '', task.title)
    const statusCell = element('td')
    statusCell.append(badge(task.status, task.status === 'merged' ? 'ok' : task.status === 'active' ? 'warn' : ''))
    const mandateCell = element('td', 'mono', short(task.mandateId ?? '—'))
    const worktreeCell = element('td', 'mono', task.worktree ? short(task.worktree) : '—')
    tr.append(idCell, titleCell, statusCell, mandateCell, worktreeCell)
    tableBody.append(tr)
  }
}

function renderApprovals(approvals) {
  const target = $('approvals')
  target.replaceChildren()
  if (approvals.length === 0) {
    target.append(element('p', 'muted', 'Nothing waits for a human.'))
    return
  }
  for (const approval of approvals) {
    const item = element('div', 'item approval')
    item.append(badge('pending', 'warn'))
    item.append(element('span', 'title', `${approval.action} → ${approval.resource}`))
    const note = element('span', 'note', `expires ${when(approval.expiresAt)}`)
    item.append(note)
    const actions = element('span', 'actions')
    const approve = element('button', 'mini', 'Approve')
    approve.addEventListener('click', () => resolveApproval(approval.id, true))
    const reject = element('button', 'mini ghost', 'Reject')
    reject.addEventListener('click', () => resolveApproval(approval.id, false))
    actions.append(approve, reject)
    item.append(actions)
    target.append(item)
  }
}

async function resolveApproval(id, approve) {
  try {
    await api(`/v1/approvals/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ approve, reason: approve ? 'approved in console' : 'rejected in console' }),
    })
    await refresh()
  } catch (error) {
    $('live-label').textContent = error.message
  }
}

async function createTask(event) {
  event.preventDefault()
  const title = $('task-title').value.trim()
  if (!title) return
  try {
    const body = { title, baseBranch: 'main' }
    if ($('task-repo').value.trim()) body.repoPath = $('task-repo').value.trim()
    await api('/v1/tasks', { method: 'POST', body: JSON.stringify(body) })
    $('task-title').value = ''
    await refresh()
  } catch (error) {
    $('live-label').textContent = error.message
  }
}

function startStream() {
  if (state.noStream) return
  if (state.source) state.source.close()
  const source = new EventSource(`/v1/stream?token=${encodeURIComponent(state.token)}`)
  state.source = source
  source.addEventListener('hello', () => {
    $('live-dot').className = 'dot on'
    $('live-label').textContent = 'live'
  })
  source.addEventListener('event', (message) => {
    try {
      const event = JSON.parse(message.data)
      state.events.unshift(event)
      state.events = state.events.slice(0, 80)
      renderFeed()
      if (event.type.startsWith('lease.') || event.type.startsWith('approval.') || event.type.startsWith('task.') || event.type.startsWith('submit.')) {
        refresh()
      }
    } catch {
      /* ignore malformed frames */
    }
  })
  source.onerror = () => {
    $('live-dot').className = 'dot off'
    $('live-label').textContent = 'reconnecting'
  }
}

function renderFeed() {
  const feed = $('feed')
  feed.replaceChildren()
  for (const event of state.events) {
    const row = element('div', 'feed-row')
    row.append(element('span', 'type', event.type))
    row.append(element('span', '', short(event.actor)))
    row.append(element('span', 'at', when(event.at)))
    feed.append(row)
  }
}

async function searchMemory(event) {
  event.preventDefault()
  const query = $('memory-query').value.trim()
  const results = $('memory-results')
  results.replaceChildren()
  if (!query) return
  try {
    const payload = await api(`/v1/memory/search?q=${encodeURIComponent(query)}`)
    if (payload.results.length === 0) {
      results.append(element('p', 'muted', 'No fragments visible to this principal.'))
      return
    }
    for (const fragment of payload.results) {
      const item = element('div', 'item')
      item.append(badge(fragment.kind, 'ok'))
      item.append(element('span', 'title', fragment.topic))
      item.append(element('span', 'spacer'))
      item.append(badge(fragment.visibility, fragment.visibility === 'private' ? 'bad' : 'warn'))
      item.append(element('span', 'id', `score ${fragment.score}`))
      const text = element('p', '', fragment.text)
      text.style.margin = '8px 0 0'
      text.style.width = '100%'
      item.style.flexWrap = 'wrap'
      item.append(text)
      results.append(item)
    }
  } catch (error) {
    results.append(element('p', 'error', error.message))
  }
}

async function explain(event) {
  event.preventDefault()
  try {
    const payload = await api('/v1/policy/explain', {
      method: 'POST',
      body: JSON.stringify({
        action: $('explain-action').value,
        resource: $('explain-resource').value,
      }),
    })
    $('explain-result').textContent = JSON.stringify(payload, null, 2)
  } catch (error) {
    $('explain-result').textContent = error.message
  }
}

async function verifyAudit() {
  try {
    const payload = await api('/v1/audit/verify')
    $('audit-result').textContent = JSON.stringify(payload, null, 2)
  } catch (error) {
    $('audit-result').textContent = error.message
  }
}

function bindTabs() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((node) => node.classList.remove('active'))
      document.querySelectorAll('.panel').forEach((node) => node.classList.remove('active'))
      tab.classList.add('active')
      $(`tab-${tab.dataset.tab}`).classList.add('active')
    })
  }
}

function boot() {
  bindTabs()
  const params = new URLSearchParams(location.search)
  state.noStream = params.has('nostream')
  const queryToken = params.get('token')
  if (queryToken) {
    state.token = queryToken
    localStorage.setItem('teamplane.token', queryToken)
    history.replaceState({}, '', location.pathname)
  }
  $('task-form').addEventListener('submit', createTask)
  $('connect').addEventListener('click', connect)
  $('token').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') connect()
  })
  $('memory-form').addEventListener('submit', searchMemory)
  $('explain-form').addEventListener('submit', explain)
  $('verify').addEventListener('click', verifyAudit)
  if (state.token) {
    $('token').value = state.token
    connect()
  }
}

boot()
