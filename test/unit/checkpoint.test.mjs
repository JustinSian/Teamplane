import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeys } from '../../dist/domain/mandate.js'
import { signCheckpoint, verifyCheckpoint } from '../../dist/domain/checkpoint.js'

test('a signed checkpoint verifies and detects tampering', () => {
  const keys = generateKeys()
  const checkpoint = signCheckpoint(42, 'a'.repeat(64), keys)
  assert.equal(checkpoint.seq, 42)
  assert.equal(verifyCheckpoint(checkpoint, keys.publicKeyPem), true)

  const forgedSeq = { ...checkpoint, seq: 43 }
  assert.equal(verifyCheckpoint(forgedSeq, keys.publicKeyPem), false)

  const forgedHash = { ...checkpoint, hash: 'b'.repeat(64) }
  assert.equal(verifyCheckpoint(forgedHash, keys.publicKeyPem), false)
})

test('a checkpoint does not verify against a different key', () => {
  const alice = generateKeys()
  const bob = generateKeys()
  const checkpoint = signCheckpoint(1, 'c'.repeat(64), alice)
  assert.equal(verifyCheckpoint(checkpoint, bob.publicKeyPem), false)
})
