import test from 'node:test'
import assert from 'node:assert/strict'
import { RateLimiter } from '../../dist/server/ratelimit.js'

test('a bucket allows a burst then asks the caller to wait', () => {
  let now = 0
  const limiter = new RateLimiter({ capacity: 2, refillPerSecond: 1, now: () => now })
  assert.equal(limiter.take('alice').ok, true)
  assert.equal(limiter.take('alice').ok, true)
  const denied = limiter.take('alice')
  assert.equal(denied.ok, false)
  assert.ok(denied.retryAfterMs >= 900)
  assert.equal(limiter.take('bob').ok, true)
})

test('tokens refill over time', () => {
  let now = 0
  const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 2, now: () => now })
  assert.equal(limiter.take('alice').ok, true)
  assert.equal(limiter.take('alice').ok, false)
  now = 500
  assert.equal(limiter.take('alice').ok, true)
})

test('idle buckets are pruned', () => {
  let now = 0
  const limiter = new RateLimiter({ capacity: 1, now: () => now })
  limiter.take('alice')
  limiter.take('bob')
  now = 2 * 60 * 60 * 1000
  limiter.prune()
  assert.equal(limiter.size(), 0)
})
