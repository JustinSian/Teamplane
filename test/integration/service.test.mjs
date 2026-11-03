import test from 'node:test'
import assert from 'node:assert/strict'
import { TeamplaneError } from '../../dist/core/util.js'
import { commitFile, makeWorkspace } from '../helpers.mjs'

test('multi-principal lifecycle: mandates, leases, memory, approvals and submit', async (t) => {
  const { root, repo, init, workspace } = makeWorkspace()
  const { service, log } = workspace
  t.after(() => log.close())

  const alice = service.authenticate(init.token)
  const bob = service.createPrincipal(alice, { kind: 'agent', display: 'bob', roles: ['maintainer'] })
  const carol = service.createPrincipal(alice, { kind: 'agent', display: 'carol', roles: ['agent'] })
  const bobActor = service.authenticate(bob.token)
  const carolActor = service.authenticate(carol.token)

  const task = service.createTask(alice, { title: 'auth rotation', repoPath: repo, baseBranch: 'main' })
  const bobMandate = service.issueMandate(alice, {
    subject: bob.principal.id,
    task: task.id,
    paths: ['src/auth.ts'],
    branches: ['main', task.branch],
    memory: ['team'],
    actions: ['fs.read', 'fs.write', 'lease.acquire', 'memory.read', 'memory.write', 'task.submit', 'git.push'],
    ttlSeconds: 600,
  })
  const carolMandate = service.issueMandate(alice, {
    subject: carol.principal.id,
    task: task.id,
    paths: ['docs'],
    ttlSeconds: 600,
  })

  service.startTask(alice, task.id, bobMandate.record.id)
  const started = service.state.tasks.get(task.id)
  assert.equal(started.status, 'active')
  assert.ok(started.worktree)

  const lease = service.acquireLease(bobActor, {
    key: 'file:src/auth.ts',
    task: task.id,
    mandate: bobMandate.record.claims,
  })
  assert.equal(lease.fencing, 1)

  const aliceActor = service.authenticate(init.token)
  assert.throws(
    () => service.acquireLease(aliceActor, { key: 'file:src/auth.ts', task: task.id }),
    (error) => error instanceof TeamplaneError && error.status === 409,
  )

  const carolDecision = service.authorize(carolActor, 'fs.write', 'file:src/auth.ts', {}, carolMandate.record.claims)
  assert.equal(carolDecision.decision, 'deny')
  assert.match(carolDecision.reason, /outside the mandate/)

  const teamMemory = service.writeMemory(aliceActor, {
    kind: 'decision',
    topic: 'rotation',
    text: 'Rotate on every use.',
    visibility: 'team',
    namespace: 'team',
  })
  assert.ok(teamMemory.id)
  service.writeMemory(aliceActor, {
    kind: 'convention',
    topic: 'review',
    text: 'Second reviewer required.',
    visibility: 'role:maintainer',
    namespace: 'team',
  })
  assert.ok(service.searchMemory(bobActor, 'rotation').length >= 1)
  assert.ok(!service.searchMemory(carolActor, 'review').some((item) => item.visibility === 'role:maintainer'))
  assert.throws(
    () => service.writeMemory(aliceActor, { kind: 'decision', topic: 'leak', text: 'AKIAABCDEFGHIJKLMNOP', namespace: 'team' }),
    /secret/,
  )

  const ask = service.authorize(bobActor, 'git.push', 'branch:main', { request: { force: true } }, bobMandate.record.claims)
  assert.equal(ask.decision, 'ask')
  const approval = service.requestApproval(bobActor, {
    action: 'git.push',
    resource: 'branch:main',
    mandateId: bobMandate.record.id,
  })
  service.resolveApproval(aliceActor, approval.id, true, 'ok')
  const allowed = service.authorize(bobActor, 'git.push', 'branch:main', { request: { force: true } }, bobMandate.record.claims, approval.id)
  assert.equal(allowed.decision, 'allow')
  service.consumeApproval(bobActor, approval.id, 'git.push', 'branch:main', bobMandate.record.claims.id)
  const replay = service.authorize(bobActor, 'git.push', 'branch:main', { request: { force: true } }, bobMandate.record.claims, approval.id)
  assert.equal(replay.decision, 'ask')

  commitFile(started.worktree, 'src/auth.ts', 'export function rotateToken(token) {\n  return token + ":rotated"\n}\n')
  const submitted = service.submit(bobActor, task.id, { verify: ['node -e "process.exit(0)"'] }, bobMandate.record.claims)
  assert.equal(submitted.ok, true)
  assert.deepEqual(submitted.changedFiles, ['src/auth.ts'])

  commitFile(started.worktree, 'src/auth.ts', 'export function rotateToken(token) {\n  return token + ":rotated-twice"\n}\n', 'again')
  const broken = service.submit(bobActor, task.id, { verify: ['node -e "process.exit(1)"'] }, bobMandate.record.claims)
  assert.equal(broken.ok, false)
  assert.match(broken.reason, /Verification/)

  const audit = service.audit()
  assert.equal(audit.ok, true)
  assert.ok(audit.events > 10)

  assert.throws(() => service.resolveMandate(bobMandate.token, carolActor), /belongs to/)
  assert.ok(service.resolveMandate(bobMandate.token, bobActor))
  assert.ok(root)
})
