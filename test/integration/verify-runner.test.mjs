import test from 'node:test'
import assert from 'node:assert/strict'
import { TeamplaneError } from '../../dist/core/util.js'
import { makeWorkspace } from '../helpers.mjs'

test('verifyRequireRunner refuses server-side verification without a sandbox runner', async (t) => {
  const previous = process.env.TEAMPLANE_VERIFY_REQUIRE_RUNNER
  process.env.TEAMPLANE_VERIFY_REQUIRE_RUNNER = '1'
  t.after(() => {
    if (previous === undefined) delete process.env.TEAMPLANE_VERIFY_REQUIRE_RUNNER
    else process.env.TEAMPLANE_VERIFY_REQUIRE_RUNNER = previous
  })

  const { repo, init, workspace } = makeWorkspace()
  t.after(() => workspace.log.close())
  const service = workspace.service
  const alice = service.authenticate(init.token)

  const task = service.createTask(alice, { title: 'sandboxed verify', repoPath: repo, verify: ['node -e "process.exit(0)"'] })
  const mandate = service.issueMandate(alice, { subject: init.principal.id, task: task.id, paths: ['src'], ttlSeconds: 600 })

  assert.throws(
    () => service.submit(alice, task.id, {}, mandate.record.claims),
    (error) => error instanceof TeamplaneError && error.status === 503 && error.code === 'verify_runner_required',
  )
})
