import test from 'node:test'
import assert from 'node:assert/strict'
import { decide, defaultPolicy, mandateAllows, validatePolicy } from '../../dist/policy/engine.js'

const alice = {
  principal: { id: 'usr_alice', kind: 'user', display: 'alice', tokenHash: 'x', createdAt: 'now', disabled: false },
  roles: ['owner'],
}

const agent = {
  principal: { id: 'usr_agent', kind: 'agent', display: 'agent', tokenHash: 'y', createdAt: 'now', disabled: false },
  roles: ['agent'],
}

const mandate = {
  v: 1,
  id: 'mnd_1',
  issuer: 'usr_alice',
  subject: 'usr_agent',
  task: 'tsk_1',
  scope: { paths: ['src/auth.ts'], actions: ['fs.read', 'fs.write'], branches: ['tp/tsk_1'], memory: ['team/auth'] },
  limits: { maxWrites: 10, expiresAt: '2999-01-01T00:00:00.000Z' },
  policyVersion: 1,
  iat: '2026-01-01T00:00:00.000Z',
  exp: '2999-01-01T00:00:00.000Z',
  nonce: 'n',
}

test('owner is allowed and default is deny', () => {
  const policy = defaultPolicy()
  const owner = decide(policy, { actor: alice, action: 'fs.write', resource: 'file:src/x.ts' })
  assert.equal(owner.decision, 'allow')
  assert.equal(owner.ruleId, 'owner-all')

  const stranger = decide(policy, {
    actor: { principal: { ...agent.principal, id: 'usr_z' }, roles: [] },
    action: 'fs.write',
    resource: 'file:src/x.ts',
  })
  assert.equal(stranger.decision, 'deny')
  assert.equal(stranger.ruleId, null)
})

test('agent write needs a mandate and a lease', () => {
  const policy = defaultPolicy()
  const noMandate = decide(policy, { actor: agent, action: 'fs.write', resource: 'file:src/auth.ts' })
  assert.equal(noMandate.decision, 'allow')
  assert.equal(noMandate.obligations.requireMandate, true)
  assert.equal(noMandate.obligations.requireLease, true)
})

test('force push is ask, and deny wins over allow', () => {
  const policy = defaultPolicy()
  const ask = decide(policy, {
    actor: alice,
    action: 'git.push',
    resource: 'branch:main',
    fields: { request: { force: true } },
  })
  assert.equal(ask.decision, 'ask')
  assert.equal(ask.obligations.approvalRole, 'owner')

  const mixed = {
    version: 1,
    default: 'deny',
    rules: [
      { id: 'allow-all', effect: 'allow', principals: ['*'], actions: ['*'], resources: ['*'] },
      { id: 'deny-secret', effect: 'deny', principals: ['*'], actions: ['fs.read'], resources: ['file:secrets/*'] },
    ],
  }
  assert.equal(decide(mixed, { actor: agent, action: 'fs.read', resource: 'file:secrets/a' }).decision, 'deny')
  assert.equal(decide(mixed, { actor: agent, action: 'fs.read', resource: 'file:src/a' }).decision, 'allow')
})

test('conditions are evaluated deterministically', () => {
  const policy = {
    version: 1,
    default: 'deny',
    rules: [
      {
        id: 'work-hours',
        effect: 'allow',
        principals: ['*'],
        actions: ['fs.write'],
        resources: ['*'],
        conditions: { all: [{ field: 'time.hour', op: 'gte', value: 9 }, { field: 'time.hour', op: 'lt', value: 18 }] },
      },
    ],
  }
  assert.equal(decide(policy, { actor: agent, action: 'fs.write', resource: 'file:a', fields: { time: { hour: 10 } } }).decision, 'allow')
  assert.equal(decide(policy, { actor: agent, action: 'fs.write', resource: 'file:a', fields: { time: { hour: 22 } } }).decision, 'deny')
})

test('mandate scope is strict about paths, actions, branches and memory', () => {
  assert.equal(mandateAllows(mandate, 'fs.write', 'file:src/auth.ts').ok, true)
  assert.equal(mandateAllows(mandate, 'fs.write', 'file:src/other.ts').ok, false)
  assert.equal(mandateAllows(mandate, 'git.push', 'branch:tp/tsk_1').ok, false)
  assert.equal(mandateAllows(mandate, 'fs.read', 'branch:tp/tsk_1').ok, true)
  assert.equal(mandateAllows(mandate, 'memory.write', 'memory:team/auth/tokens').ok, false)
  assert.equal(
    mandateAllows(
      { ...mandate, scope: { ...mandate.scope, actions: [...mandate.scope.actions, 'memory.write'], memory: ['team/auth'] } },
      'memory.write',
      'memory:team/auth/tokens',
    ).ok,
    true,
  )
})

test('policy validation catches duplicates and empty rules', () => {
  const errors = validatePolicy({
    version: 1,
    default: 'deny',
    rules: [
      { id: 'a', effect: 'allow', principals: ['*'], actions: [], resources: ['*'] },
      { id: 'a', effect: 'deny', principals: ['*'], actions: ['*'], resources: ['*'] },
    ],
  })
  assert.ok(errors.some((error) => error.includes('duplicated')))
  assert.ok(errors.some((error) => error.includes('actions is empty')))
})
