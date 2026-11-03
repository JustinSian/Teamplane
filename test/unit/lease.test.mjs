import test from 'node:test'
import assert from 'node:assert/strict'
import { leasesConflict } from '../../dist/domain/service.js'

function lease(key, mode = 'exclusive') {
  return {
    id: `les_${key}`,
    key,
    mode,
    holder: 'mnd_1',
    task: 'tsk_1',
    fencing: 1,
    acquiredAt: '2026-01-01T00:00:00.000Z',
    renewedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2999-01-01T00:00:00.000Z',
    endedAt: null,
    endedReason: null,
  }
}

test('same key conflicts unless both are shared', () => {
  assert.equal(leasesConflict(lease('file:src/a.ts'), 'file:src/a.ts', 'exclusive'), true)
  assert.equal(leasesConflict(lease('file:src/a.ts'), 'file:src/a.ts', 'shared'), true)
  assert.equal(leasesConflict(lease('file:src/a.ts', 'shared'), 'file:src/a.ts', 'shared'), false)
})

test('directory leases cover files below them', () => {
  assert.equal(leasesConflict(lease('dir:src', 'exclusive'), 'file:src/a.ts', 'exclusive'), true)
  assert.equal(leasesConflict(lease('file:src/a.ts', 'exclusive'), 'dir:src', 'exclusive'), true)
  assert.equal(leasesConflict(lease('dir:src'), 'file:tests/a.ts', 'exclusive'), false)
  assert.equal(leasesConflict(lease('dir:src'), 'file:srcx/a.ts', 'exclusive'), false)
})

test('ended leases never conflict', () => {
  const ended = { ...lease('file:src/a.ts'), endedAt: '2026-01-01T01:00:00.000Z' }
  assert.equal(leasesConflict(ended, 'file:src/a.ts', 'exclusive'), false)
})
