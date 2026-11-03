import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventLog } from '../../dist/store/eventlog.js'
import { defaultPolicy } from '../../dist/policy/engine.js'

function makeLog(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'teamplane-log-'))
  return { dir, log: EventLog.open(dir, options) }
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

test('the log rotates into segments and still verifies', () => {
  const { dir, log } = makeLog({ maxSegmentEvents: 3 })
  for (let index = 0; index < 10; index += 1) {
    log.append('policy.updated', 'system', defaultPolicy())
  }
  log.close()

  const archives = readdirSync(join(dir, 'archive')).filter((name) => name.endsWith('.jsonl'))
  assert.equal(archives.length, 3)
  assert.equal(log.verify().ok, true)
  assert.equal(log.verify().events, 10)

  const reopened = EventLog.open(dir, { maxSegmentEvents: 3 })
  assert.equal(reopened.state.lastSeq, 10)
  assert.equal(reopened.verify().ok, true)
  reopened.close()

  rmSync(join(dir, 'snapshot.json'), { force: true })
  const first = join(dir, 'archive', archives[0])
  const lines = readFileSync(first, 'utf8').split(String.fromCharCode(10))
  const parsed = JSON.parse(lines[0])
  parsed.actor = 'attacker'
  lines[0] = JSON.stringify(parsed)
  writeFileSync(first, lines.join(String.fromCharCode(10)))
  assert.throws(() => EventLog.open(dir, { maxSegmentEvents: 3 }), /hash mismatch/)
})

test('a forged snapshot is ignored because startup replays the chain', () => {
  const { dir, log } = makeLog()
  log.append('policy.updated', 'system', defaultPolicy())
  log.append('principal.created', 'system', {
    id: 'usr_real',
    kind: 'user',
    display: 'alice',
    tokenHash: 'hash',
    createdAt: '2026-01-01T00:00:00.000Z',
    disabled: false,
  })
  log.close()

  const snapshotPath = join(dir, 'snapshot.json')
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
  snapshot.state.principals.push({
    id: 'usr_evil',
    kind: 'user',
    display: 'mallory',
    tokenHash: 'forged',
    createdAt: '2026-01-01T00:00:00.000Z',
    disabled: false,
  })
  writeFileSync(snapshotPath, JSON.stringify(snapshot))

  const reopened = EventLog.open(dir)
  assert.equal(reopened.state.principals.has('usr_real'), true)
  assert.equal(reopened.state.principals.has('usr_evil'), false)
  reopened.close()
})
