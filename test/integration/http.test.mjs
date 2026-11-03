import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer } from '../../dist/server/http.js'
import { makeWorkspace } from '../helpers.mjs'

test('HTTP surface: auth, policy, leases, memory, audit and MCP', async (t) => {
  const { init, workspace } = makeWorkspace()
  const running = await startServer(workspace, { port: 0, quiet: true })
  t.after(async () => {
    await running.close()
    workspace.log.close()
  })

  const call = async (path, options = {}) => {
    const response = await fetch(`${running.url}${path}`, {
      ...options,
      headers: {
        ...(options.token === false ? {} : { authorization: `Bearer ${init.token}` }),
        'content-type': 'application/json',
        ...(options.headers ?? {}),
      },
    })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers }
  }

  assert.equal((await call('/healthz', { token: false })).status, 200)
  assert.equal((await call('/v1/me', { token: false })).status, 401)

  const me = await call('/v1/me')
  assert.equal(me.status, 200)
  assert.equal(me.body.principal.display, 'alice')
  assert.deepEqual(me.body.roles, ['owner'])

  const created = await call('/v1/principals', {
    method: 'POST',
    body: JSON.stringify({ kind: 'agent', display: 'bob', roles: ['agent'] }),
  })
  assert.equal(created.status, 201)
  assert.ok(created.body.token.startsWith('tp_'))
  assert.equal(created.body.principal.tokenHash, undefined)

  const explain = await call('/v1/policy/explain', {
    method: 'POST',
    body: JSON.stringify({ action: 'fs.write', resource: 'file:src/auth.ts' }),
  })
  assert.equal(explain.status, 200)
  assert.equal(explain.body.decision, 'allow')

  const task = await call('/v1/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'auth', repoPath: workspace.config.repoPath }),
  })
  assert.equal(task.status, 201)

  const issued = await call('/v1/mandates', {
    method: 'POST',
    body: JSON.stringify({ subject: me.body.principal.id, task: task.body.id, paths: ['src/auth.ts'], ttlSeconds: 60 }),
  })
  assert.equal(issued.status, 201)
  assert.ok(issued.body.token)
  const listed = await call('/v1/mandates')
  assert.ok(listed.body.mandates.length >= 1)
  assert.ok(listed.body.mandates.every((mandate) => mandate.token === undefined))

  const submitWithVerify = await call(`/v1/tasks/${task.body.id}/submit`, {
    method: 'POST',
    body: JSON.stringify({ verify: ['echo PWNED'], requireLease: false }),
  })
  assert.equal(submitWithVerify.status, 422)
  assert.equal(submitWithVerify.body.error.code, 'verify_task_bound')

  const lease = await call('/v1/leases', {
    method: 'POST',
    body: JSON.stringify({ key: 'file:src/auth.ts', task: task.body.id, ttlSeconds: 60 }),
  })
  assert.equal(lease.status, 201)

  const conflict = await call('/v1/leases', {
    method: 'POST',
    body: JSON.stringify({ key: 'dir:src', task: task.body.id, ttlSeconds: 60 }),
  })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.error.code, 'lease_conflict')

  const approval = await call('/v1/approvals', {
    method: 'POST',
    body: JSON.stringify({ action: 'git.push', resource: 'branch:main', requiredRole: 'agent', fields: { request: { force: true } } }),
  })
  assert.equal(approval.status, 201)
  assert.equal(approval.body.requiredRole, 'owner')

  const memory = await call('/v1/memory', {
    method: 'POST',
    body: JSON.stringify({ kind: 'decision', topic: 'rotation', text: 'Rotate on use.', visibility: 'team', namespace: 'team' }),
  })
  assert.equal(memory.status, 201)

  const search = await call('/v1/memory/search?q=rotation')
  assert.equal(search.status, 200)
  assert.ok(search.body.results.length >= 1)

  await call('/v1/memory', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'decision',
      topic: 'layoff',
      text: 'PRIVATE: layoff list ships friday',
      visibility: 'private',
      namespace: 'team',
    }),
  })
  const ownerEvents = await call('/v1/events?types=memory.written')
  assert.ok(ownerEvents.body.events.length >= 1)
  assert.ok(ownerEvents.body.events.every((event) => event.data?.text === undefined))
  const bobEvents = await fetch(`${running.url}/v1/events?types=memory.written`, {
    headers: { authorization: `Bearer ${created.body.token}` },
  }).then((response) => response.json())
  assert.ok(bobEvents.events.length >= 1)
  assert.ok(bobEvents.events.every((event) => event.data?.text === undefined))
  assert.ok(bobEvents.events.some((event) => event.data?.redacted === true))

  const audit = await call('/v1/audit/verify')
  assert.equal(audit.status, 200)
  assert.equal(audit.body.ok, true)

  // SSE resumes from `since` (or Last-Event-ID) and frames carry the event id.
  const ticket = await call('/v1/stream-ticket', { method: 'POST' })
  assert.equal(ticket.status, 201)
  assert.ok(ticket.body.ticket)
  const controller = new AbortController()
  try {
    const stream = await fetch(`${running.url}/v1/stream?ticket=${encodeURIComponent(ticket.body.ticket)}&since=1&types=principal.created`, {
      signal: controller.signal,
    })
    const reader = stream.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const deadline = Date.now() + 3000
    while (!buffer.includes('principal.created') && Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
    }
    assert.match(buffer, /id: 2/)
    assert.match(buffer, /principal\.created/)
  } finally {
    controller.abort()
  }

  const mcp = await call('/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  assert.equal(mcp.status, 200)
  assert.ok(mcp.body.result.tools.some((tool) => tool.name === 'tp_whoami'))

  const whoami = await call('/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'tp_whoami', arguments: {} } }),
  })
  assert.equal(whoami.status, 200)
  assert.equal(whoami.body.result.isError, false)
})
