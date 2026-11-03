import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeWorkspace } from '../helpers.mjs'

test('the signing key lives outside the repository by default', () => {
  const { repo } = makeWorkspace()
  const config = JSON.parse(readFileSync(join(repo, '.teamplane', 'config.json'), 'utf8'))
  assert.ok(config.keysDir)
  assert.equal(existsSync(join(repo, '.teamplane', 'keys', 'root.key')), false)
  assert.equal(existsSync(join(config.keysDir, 'root.key')), true)
  assert.equal(existsSync(join(config.keysDir, 'root.pub')), true)
})
