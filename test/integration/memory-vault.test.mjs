import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadWorkspace } from '../../dist/core/config.js'
import { makeWorkspace } from '../helpers.mjs'

test('memory text lives in the vault, not the event log, and survives restart', async (t) => {
  const { repo, init, workspace } = makeWorkspace()
  const token = init.token
  const actor = workspace.service.authenticate(token)
  const fragment = workspace.service.writeMemory(actor, {
    kind: 'decision',
    topic: 'layoff',
    text: 'PRIVATE: the layoff list ships friday',
    visibility: 'private',
    namespace: 'team',
  })
  const logText = readFileSync(join(repo, '.teamplane', 'events.jsonl'), 'utf8')
  assert.ok(!logText.includes('layoff list'))
  assert.match(logText, /textHash/)
  assert.ok(existsSync(join(repo, '.teamplane', 'memory', `${fragment.id}.json`)))

  workspace.log.close()
  const reopened = loadWorkspace(repo)
  t.after(() => reopened.log.close())
  const results = reopened.service.searchMemory(reopened.service.authenticate(token), 'layoff')
  assert.equal(results.length, 1)
  assert.match(results[0].text, /layoff list/)
})
