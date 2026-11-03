import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer } from '../../dist/server/http.js'
import { makeWorkspace } from '../helpers.mjs'

test('unauthenticated requests are rate limited by IP', async (t) => {
  const previousBurst = process.env.TEAMPLANE_RATE_BURST
  const previousRate = process.env.TEAMPLANE_RATE_PER_SECOND
  process.env.TEAMPLANE_RATE_BURST = '2'
  process.env.TEAMPLANE_RATE_PER_SECOND = '0'

  const { workspace } = makeWorkspace()
  const running = await startServer(workspace, { port: 0, quiet: true })
  t.after(async () => {
    await running.close()
    workspace.log.close()
    if (previousBurst === undefined) delete process.env.TEAMPLANE_RATE_BURST
    else process.env.TEAMPLANE_RATE_BURST = previousBurst
    if (previousRate === undefined) delete process.env.TEAMPLANE_RATE_PER_SECOND
    else process.env.TEAMPLANE_RATE_PER_SECOND = previousRate
  })

  const statuses = []
  for (let index = 0; index < 3; index += 1) {
    const response = await fetch(`${running.url}/v1/me`, { headers: { authorization: 'Bearer not-a-real-token' } })
    statuses.push(response.status)
  }
  assert.deepEqual(statuses, [401, 401, 429])
})
