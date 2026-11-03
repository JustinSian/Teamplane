const $ = (id) => document.getElementById(id)

const EVENT_LABELS = {
  'policy.updated': 'policy updated',
  'principal.created': 'principal created',
  'principal.disabled': 'principal disabled',
  'role.granted': 'role granted',
  'mandate.issued': 'mandate issued',
  'mandate.revoked': 'mandate revoked',
  'task.created': 'task created',
  'task.verify': 'verification changed',
  'task.started': 'task started',
  'task.launched': 'agent launched',
  'task.status': 'task status',
  'lease.acquired': 'file locked',
  'lease.renewed': 'lock renewed',
  'lease.released': 'lock released',
  'memory.written': 'memory written',
  'memory.conflict': 'memory conflict',
  'approval.requested': 'approval requested',
  'approval.resolved': 'approval resolved',
  'approval.consumed': 'approval used',
  'write.authorized': 'write allowed',
  'submit.rejected': 'submit rejected',
  'submit.verified': 'submit verified',
  'submit.merged': 'merged',
  'decision.denied': 'decision denied',
}

function eventLabel(type) {
  return EVENT_LABELS[type] ?? type
}

const state = {
  token: localStorage.getItem('teamplane.token') ?? '',
  events: [],
  source: null,
  timer: null,
  noStream: false,
  reconnectTimer: null,
  policyDirty: false,
  principals: [],
  mandates: [],
  tasks: [],
  expandedEvent: null,
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
    void startStream()
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
    $('demo-badge').hidden = !snapshot.demo
    $('demo-tip').hidden = !snapshot.demo
    const empty = (snapshot.tasks?.length ?? 0) === 0 && (snapshot.leases?.length ?? 0) === 0 && (snapshot.approvals?.length ?? 0) === 0
    $('onboarding').hidden = !empty
    const next = snapshot.next
    $('next').hidden = !next
    if (next) {
      $('next-title').textContent = next.title ?? ''
      $('next-hint').textContent = next.hint ?? ''
      $('next-command').textContent = next.command ?? ''
      $('next-command').hidden = !next.command
      $('copy-next').hidden = !next.command
    }
    state.tasks = snapshot.tasks ?? []
    renderTasks(state.tasks)
    renderApprovals(snapshot.approvals ?? [])

    const principals = await api('/v1/principals')
    state.principals = principals.principals ?? []
    fillSelect(
      $('mandate-subject'),
      state.principals.map((principal) => ({ value: principal.id, label: `${principal.display} (${principal.id})` })),
    )
    fillSelect(
      $('mandate-task'),
      (snapshot.tasks ?? []).map((task) => ({ value: task.id, label: `${task.id} — ${task.title}` })),
    )

    const mandates = await api('/v1/mandates')
    state.mandates = mandates.mandates ?? []
    renderMandates(state.mandates)
    renderTasks(state.tasks)
    fillSelect(
      $('start-task'),
      (snapshot.tasks ?? []).filter((task) => task.status !== 'merged' && task.status !== 'closed').map((task) => ({ value: task.id, label: `${task.id} — ${task.title}` })),
    )
    fillSelect(
      $('start-mandate'),
      state.mandates.filter((mandate) => !mandate.revokedAt).map((mandate) => ({ value: mandate.id, label: `${mandate.id} — ${mandate.claims.subject}` })),
    )

    const policy = await api('/v1/policy')
    if (!state.policyDirty) $('policy-editor').value = JSON.stringify(policy, null, 2)
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

function fillSelect(select, items) {
  const previous = select.value
  select.replaceChildren(
    ...items.map((item) => {
      const option = document.createElement('option')
      option.value = item.value
      option.textContent = item.label
      return option
    }),
  )
  if (items.some((item) => item.value === previous)) select.value = previous
}

async function issueMandate(event) {
  event.preventDefault()
  const paths = $('mandate-paths')
    .value.split(',')
    .map((path) => path.trim())
    .filter(Boolean)
  const result = $('mandate-result')
  try {
    if (paths.length === 0) throw new Error('at least one path is required')
    const issued = await api('/v1/mandates', {
      method: 'POST',
      body: JSON.stringify({
        subject: $('mandate-subject').value,
        task: $('mandate-task').value,
        paths,
        ttlSeconds: Number($('mandate-ttl').value),
      }),
    })
    result.hidden = false
    result.textContent = `mandate ${issued.mandate.id}
subject ${issued.mandate.claims.subject}
paths ${paths.join(', ')}
token ${issued.token}`
    await refresh()
  } catch (error) {
    result.hidden = false
    result.textContent = error.message
  }
}

async function savePolicy() {
  const status = $('policy-status')
  try {
    const policy = JSON.parse($('policy-editor').value)
    const saved = await api('/v1/policy', { method: 'PUT', body: JSON.stringify(policy) })
    state.policyDirty = false
    status.textContent = `applied version ${saved.version}`
  } catch (error) {
    status.textContent = error.message
  }
}

function renderMandates(mandates) {
  const body = $('mandates-table').querySelector('tbody')
  body.replaceChildren()
  for (const mandate of mandates) {
    const tr = document.createElement('tr')
    tr.append(element('td', 'mono', short(mandate.id)))
    tr.append(element('td', 'mono', short(mandate.claims.subject)))
    tr.append(element('td', 'mono', short(mandate.claims.task)))
    const paths = element('td', '', (mandate.claims.scope.paths ?? []).join(', '))
    tr.append(paths)
    const expires = element('td', 'mono', mandate.claims.exp)
    tr.append(expires)
    const action = element('td')
    if (mandate.revokedAt) {
      action.append(badge('revoked', 'bad'))
    } else {
      const revoke = element('button', 'mini ghost', 'Revoke')
      revoke.addEventListener('click', () => revokeMandate(mandate.id))
      action.append(revoke)
    }
    tr.append(action)
    body.append(tr)
  }
}

async function revokeMandate(id) {
  try {
    await api(`/v1/mandates/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'revoked in console' }),
    })
    await refresh()
  } catch (error) {
    $('live-label').textContent = error.message
  }
}

async function startTask(event) {
  event.preventDefault()
  const taskId = $('start-task').value
  const mandateId = $('start-mandate').value
  if (!taskId || !mandateId) return
  try {
    await api(`/v1/tasks/${encodeURIComponent(taskId)}/start`, {
      method: 'POST',
      body: JSON.stringify({ mandateId }),
    })
    await refresh()
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
    const worktreeName = task.worktree ? String(task.worktree).split(/[\\/]/).filter(Boolean).pop() : null
    const worktreeCell = element('td', 'mono', worktreeName ?? '—')
    if (task.worktree) worktreeCell.title = String(task.worktree)
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

async function createWorkingExample() {
  const button = $('starter-task')
  button.disabled = true
  try {
    button.textContent = 'Creating task…'
    const me = await api('/v1/me')
    const task = await api('/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'First task', verify: ['node -e "process.exit(0)"'] }),
    })
    button.textContent = 'Issuing mandate…'
    const issued = await api('/v1/mandates', {
      method: 'POST',
      body: JSON.stringify({ subject: me.principal.id, task: task.id, paths: ['src'], ttlSeconds: 3600 }),
    })
    button.textContent = 'Starting worktree…'
    await api(`/v1/tasks/${encodeURIComponent(task.id)}/start`, {
      method: 'POST',
      body: JSON.stringify({ mandateId: issued.mandate.id }),
    })
    await refresh()
  } catch (error) {
    $('live-label').textContent = error.message
  } finally {
    button.disabled = false
    button.textContent = 'Create a working example'
  }
}

function renderConnect() {
  const config = [
    '- id: mcp-teamplane',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    '    serverName: teamplane',
    '    transport: stdio',
    '    command: teamplane',
    "    args: ['mcp']",
    '    failOnStartupError: false',
    '    env:',
    `      TEAMPLANE_URL: ${location.origin}`,
    '      TEAMPLANE_TOKEN: YOUR_PRINCIPAL_TOKEN',
  ].join('\n')
  $('connect-config').textContent = config
}

async function startStream() {
  if (state.noStream) return
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer)
    state.reconnectTimer = null
  }
  if (state.source) state.source.close()
  let url = `/v1/stream?token=${encodeURIComponent(state.token)}`
  try {
    const ticket = await api('/v1/stream-ticket', { method: 'POST' })
    url = `/v1/stream?ticket=${encodeURIComponent(ticket.ticket)}`
  } catch {
    // Fall back to the legacy query token if the control plane is older.
  }
  const source = new EventSource(url)
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
    source.close()
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer)
    state.reconnectTimer = setTimeout(() => {
      void startStream()
    }, 2000)
  }
}

function renderFeed() {
  const feed = $('feed')
  feed.replaceChildren()
  for (const event of state.events) {
    const row = element('div', 'feed-row')
    row.title = `${event.type} — click for details`
    row.append(element('span', 'type', eventLabel(event.type)))
    row.append(element('span', '', short(event.actor)))
    row.append(element('span', 'at', when(event.at)))
    row.addEventListener('click', () => {
      state.expandedEvent = state.expandedEvent === event.id ? null : event.id
      renderFeed()
    })
    const detail = element('pre', 'feed-detail', JSON.stringify(event, null, 2))
    detail.hidden = state.expandedEvent !== event.id
    feed.append(row, detail)
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
  $('mandate-form').addEventListener('submit', issueMandate)
  $('start-form').addEventListener('submit', startTask)
  $('policy-save').addEventListener('click', savePolicy)
  $('policy-editor').addEventListener('input', () => {
    state.policyDirty = true
  })
  $('connect').addEventListener('click', connect)
  $('token').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') connect()
  })
  $('starter-task').addEventListener('click', createWorkingExample)
  $('copy-connect').addEventListener('click', async () => {
    const button = $('copy-connect')
    try {
      await navigator.clipboard.writeText($('connect-config').textContent)
      $('connect-status').textContent = 'Copied'
      setTimeout(() => {
        $('connect-status').textContent = ''
      }, 1500)
    } catch {
      $('connect-status').textContent = 'Select and copy'
    }
  })
  renderConnect()
  $('copy-next').addEventListener('click', async () => {
    const button = $('copy-next')
    try {
      await navigator.clipboard.writeText($('next-command').textContent)
      button.textContent = 'Copied'
      setTimeout(() => {
        button.textContent = 'Copy'
      }, 1500)
    } catch {
      button.textContent = 'Select and copy'
    }
  })
  $('copy-onboarding').addEventListener('click', async () => {
    const button = $('copy-onboarding')
    try {
      await navigator.clipboard.writeText($('onboarding-commands').textContent)
      button.textContent = 'Copied'
      setTimeout(() => {
        button.textContent = 'Copy commands'
      }, 1500)
    } catch {
      button.textContent = 'Select and copy'
    }
  })
  $('memory-form').addEventListener('submit', searchMemory)
  $('explain-form').addEventListener('submit', explain)
  $('verify').addEventListener('click', verifyAudit)
  const initialTab = params.get('tab')
  if (initialTab) {
    const tab = document.querySelector(`.tab[data-tab="${initialTab}"]`)
    if (tab) tab.click()
  }
  if (state.token) {
    $('token').value = state.token
    connect()
  }
}

boot()
