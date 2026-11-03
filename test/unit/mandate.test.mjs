import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeys, signMandate, verifyMandate, decodeMandate, deriveClaims } from '../../dist/domain/mandate.js'

function claims(overrides = {}) {
  return {
    v: 1,
    id: 'mnd_test',
    issuer: 'usr_owner',
    subject: 'usr_agent',
    task: 'tsk_1',
    scope: {
      paths: ['src/auth.ts', 'tests/auth'],
      actions: ['fs.read', 'fs.write', 'lease.acquire'],
      branches: ['tp/tsk_1'],
      memory: ['team/auth'],
    },
    limits: { maxWrites: 100, expiresAt: '2999-01-01T00:00:00.000Z' },
    policyVersion: 1,
    iat: '2026-01-01T00:00:00.000Z',
    exp: '2999-01-01T00:00:00.000Z',
    nonce: 'abc',
    ...overrides,
  }
}

test('sign and verify a mandate', () => {
  const keys = generateKeys()
  const token = signMandate(claims(), keys)
  const verified = verifyMandate(token, keys.publicKeyPem, '2026-06-01T00:00:00.000Z')
  assert.equal(verified.id, 'mnd_test')
  assert.equal(decodeMandate(token).header.kid, keys.kid)
})

test('tampered claims fail verification', () => {
  const keys = generateKeys()
  const token = signMandate(claims(), keys)
  const [header, body, signature] = token.split('.')
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  payload.scope.paths = ['**']
  const forged = `${header}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`
  assert.throws(() => verifyMandate(forged, keys.publicKeyPem, '2026-06-01T00:00:00.000Z'), /signature/)
})

test('expired mandates are rejected', () => {
  const keys = generateKeys()
  const token = signMandate(claims({ exp: '2026-01-02T00:00:00.000Z' }), keys)
  assert.throws(() => verifyMandate(token, keys.publicKeyPem, '2026-06-01T00:00:00.000Z'), /expired/)
})

test('derivation narrows and never expands', () => {
  const parent = claims()
  const child = deriveClaims(parent, { paths: ['src/auth.ts'], actions: ['fs.read'], ttlSeconds: 60 }, '2026-06-01T00:00:00.000Z')
  assert.deepEqual(child.scope.paths, ['src/auth.ts'])
  assert.deepEqual(child.scope.actions, ['fs.read'])
  assert.ok(child.exp <= parent.exp)

  assert.throws(() => deriveClaims(parent, { paths: ['src/other.ts'] }, '2026-06-01T00:00:00.000Z'), /outside the parent/)
  assert.throws(() => deriveClaims(parent, { actions: ['git.push'] }, '2026-06-01T00:00:00.000Z'), /outside the parent/)
  assert.throws(() => deriveClaims(parent, { branches: ['main'] }, '2026-06-01T00:00:00.000Z'), /outside the parent/)
  const shortParent = claims({ exp: '2026-06-02T00:00:00.000Z' })
  assert.throws(() => deriveClaims(shortParent, { ttlSeconds: 10_000_000 }, '2026-06-01T00:00:00.000Z'), /outlive/)
})

test('a derived mandate cannot raise the write limit', () => {
  const parent = claims()
  assert.throws(() => deriveClaims(parent, { maxWrites: 101 }, '2026-06-01T00:00:00.000Z'), /write limit/)
})
