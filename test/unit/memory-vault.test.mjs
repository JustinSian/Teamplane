import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyState } from '../../dist/store/eventlog.js'
import { generateKeys } from '../../dist/domain/mandate.js'
import { MemoryVault } from '../../dist/store/memory.js'

test('a 0.3 event with inline text is migrated into the vault', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'teamplane-vault-'))
  const state = emptyState()
  state.memory.set('mem_legacy', {
    id: 'mem_legacy',
    owner: 'usr_alice',
    kind: 'decision',
    topic: 'legacy',
    text: 'text from a 0.3 event',
    visibility: 'team',
    namespace: 'team',
    provenance: { files: [], commits: [], tasks: [] },
    createdAt: '2026-01-01T00:00:00.000Z',
    supersedes: null,
  })

  const vault = new MemoryVault(stateDir, generateKeys().privateKeyPem)
  vault.hydrate(state)
  assert.equal(state.memory.get('mem_legacy').text, 'text from a 0.3 event')
  assert.equal(vault.load('mem_legacy').text, 'text from a 0.3 event')
  const raw = readFileSync(join(stateDir, 'memory', 'mem_legacy.json'), 'utf8')
  assert.ok(!raw.includes('text from a 0.3 event'))
  assert.match(raw, /"v":1/)
})
