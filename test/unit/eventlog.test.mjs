import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventLog } from '../../dist/store/eventlog.js'
import { defaultPolicy } from '../../dist/policy/engine.js'

function makeLog() {
  const dir = mkdtempSync(join(tmpdir(), 'teamplane-log-'))
  return { dir, log: EventLog.open(dir) }
}

test('events replay into identical state', () => {
  const { dir, log } = makeLog()
  log.append('policy.updated', 'system', defaultPolicy())
  log.append('principal.created', 'system', {
    id: 'usr_1',
    kind: 'user',
    display: 'alice',
    tokenHash: 'hash',
    createdAt: '2026-01-01T00:00:00.000Z',
    disabled: false,
  })
  log.append('role.granted', 'system', { principalId: 'usr_1', role: 'owner', at: '2026-01-01T00:00:00.000Z' })
  const before = log.state.lastSeq
  log.close()

  const reopened = EventLog.open(dir)
  assert.equal(reopened.state.lastSeq, before)
  assert.equal(reopened.state.principals.get('usr_1').display, 'alice')
  assert.deepEqual(reopened.state.roles.get('usr_1'), ['owner'])
  assert.equal(reopened.verify().ok, true)
  reopened.close()
})

test('tampering is detected by the hash chain', () => {
  const { dir, log } = makeLog()
  log.append('policy.updated', 'system', defaultPolicy())
  log.append('role.granted', 'system', { principalId: 'usr_1', role: 'owner', at: '2026-01-01T00:00:00.000Z' })
  log.close()

  rmSync(join(dir, 'snapshot.json'), { force: true })
  const file = join(dir, 'events.jsonl')
  const lines = readFileSync(file, 'utf8').split('\n')
  const parsed = JSON.parse(lines[0])
  parsed.actor = 'attacker'
  lines[0] = JSON.stringify(parsed)
  writeFileSync(file, lines.join('\n'))

  assert.throws(() => EventLog.open(dir), /hash mismatch/)
})

test('snapshots are a cache, not the source of truth', () => {
  const { dir, log } = makeLog()
  log.append('policy.updated', 'system', defaultPolicy())
  log.writeSnapshot()
  log.close()
  const reopened = EventLog.open(dir)
  assert.equal(reopened.state.policy.version, 1)
  assert.equal(reopened.verify().ok, true)
  reopened.close()
})
