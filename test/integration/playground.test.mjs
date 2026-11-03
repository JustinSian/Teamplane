import test from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { seedPlayground } from '../../dist/demo/seed.js'

test('playground seeds a team a human can act on', async () => {
  const seed = await seedPlayground({ port: 0 })
  try {
    const headers = { authorization: `Bearer ${seed.tokens.alice}`, 'content-type': 'application/json' }
    const state = await (await fetch(`${seed.running.url}/v1/state`, { headers })).json()
    assert.equal(state.name, 'acme')
    assert.equal(state.tasks.length, 4)
    assert.equal(state.leases.length, 2)
    assert.equal(state.approvals.length, 1)
    assert.ok(state.events >= 10)

    const approval = state.approvals[0]
    const resolved = await (
      await fetch(`${seed.running.url}/v1/approvals/${approval.id}/resolve`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ approve: true, reason: 'playground test' }),
      })
    ).json()
    assert.equal(resolved.status, 'approved')

    const me = await (await fetch(`${seed.running.url}/v1/me`, { headers })).json()
    assert.equal(me.principal.display, 'alice')
    assert.deepEqual(me.roles, ['owner'])
  } finally {
    await seed.running.close()
    seed.workspace.log.close()
    rmSync(seed.root, { recursive: true, force: true })
  }
})
