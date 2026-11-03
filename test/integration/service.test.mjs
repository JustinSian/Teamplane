import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { TeamplaneError } from '../../dist/core/util.js'
import { commitFile, git, makeWorkspace } from '../helpers.mjs'

const NL = String.fromCharCode(10)
const rotated = ['export function rotateToken(token) {', '  return token + ":rotated"', '}'].join(NL)
const stale = ['export function rotateToken(token) {', '  return token + ":stale"', '}'].join(NL)

test('multi-principal lifecycle: mandates, leases, memory, approvals and submit', async (t) => {
  const { root, repo, init, workspace } = makeWorkspace()
  const { service, log } = workspace
  t.after(() => log.close())

  const baseCommit = git(repo, ['rev-parse', 'HEAD']).trim()
  const alice = service.authenticate(init.token)
  const bob = service.createPrincipal(alice, { kind: 'agent', display: 'bob', roles: ['maintainer'] })
  const carol = service.createPrincipal(alice, { kind: 'agent', display: 'carol', roles: ['agent'] })
  const bobActor = service.authenticate(bob.token)
  const carolActor = service.authenticate(carol.token)

  assert.throws(
    () => service.createTask(alice, { title: 'outside', repoPath: join(root, 'outside'), baseBranch: 'main' }),
    (error) => error instanceof TeamplaneError && error.status === 403,
  )
  const task = service.createTask(alice, { title: 'auth rotation', repoPath: repo, baseBranch: 'main', verify: ['node -e "process.exit(1)"'] })
  const bobMandate = service.issueMandate(alice, {
    subject: bob.principal.id,
    task: task.id,
    paths: ['src/auth.ts'],
    branches: ['main', task.branch],
    memory: ['team'],
    actions: ['fs.read', 'fs.write', 'lease.acquire', 'memory.read', 'memory.write', 'task.submit', 'git.push'],
    ttlSeconds: 600,
  })
  assert.throws(
    () => service.issueMandate(alice, { subject: bob.principal.id, task: task.id, paths: ['/'] }),
    (error) => error instanceof TeamplaneError && error.status === 422,
  )
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

  const launch = service.recordLaunch(alice, task.id, { command: 'dsh', pid: 4242 })
  assert.equal(launch.task, task.id)
  assert.equal(service.launchesFor(task.id).length, 1)
  assert.throws(
    () => service.recordLaunch(carolActor, task.id, { command: 'dsh' }),
    (error) => error instanceof TeamplaneError && error.status === 403,
  )

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

  const limitedMandate = service.issueMandate(alice, {
    subject: carol.principal.id,
    task: task.id,
    paths: ['docs'],
    maxWrites: 1,
    ttlSeconds: 600,
  })
  service.acquireLease(carolActor, { key: 'file:docs/x.md', task: task.id, mandate: limitedMandate.record.claims })
  const firstWrite = service.authorize(carolActor, 'fs.write', 'file:docs/x.md', {}, limitedMandate.record.claims)
  assert.equal(firstWrite.decision, 'allow')
  const secondWrite = service.authorize(carolActor, 'fs.write', 'file:docs/x.md', {}, limitedMandate.record.claims)
  assert.equal(secondWrite.decision, 'deny')
  assert.match(secondWrite.reason, /write limit/)

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
    fields: { request: { force: true } },
  })
  service.resolveApproval(aliceActor, approval.id, true, 'ok')
  const allowed = service.authorize(bobActor, 'git.push', 'branch:main', { request: { force: true } }, bobMandate.record.claims, approval.id, true)
  assert.equal(allowed.decision, 'allow')
  const replay = service.authorize(bobActor, 'git.push', 'branch:main', { request: { force: true } }, bobMandate.record.claims, approval.id)
  assert.equal(replay.decision, 'ask')

  // The requester cannot choose the approver role; the policy rule decides.
  const forged = service.requestApproval(carolActor, {
    action: 'git.push',
    resource: 'branch:main',
    fields: { request: { force: true } },
    // @ts-expect-error the HTTP body used to accept this; it must now be ignored
    requiredRole: 'agent',
  })
  assert.equal(forged.requiredRole, 'owner')
  assert.throws(
    () => service.resolveApproval(bobActor, forged.id, true),
    (error) => error instanceof TeamplaneError && error.status === 403,
  )

  commitFile(started.worktree, 'src/auth.ts', rotated)

  const broken = service.submit(bobActor, task.id, {}, bobMandate.record.claims)
  assert.equal(broken.ok, false)
  assert.match(broken.reason, /Verification/)

  service.setTaskVerify(aliceActor, task.id, ['node -e "process.exit(0)"'])
  const accepted = service.submit(bobActor, task.id, {}, bobMandate.record.claims)
  assert.equal(accepted.ok, true)
  assert.equal(accepted.merged, false)
  assert.deepEqual(accepted.changedFiles, ['src/auth.ts'])

  const submitted = service.submit(bobActor, task.id, { merge: true }, bobMandate.record.claims)
  assert.equal(submitted.ok, true)
  assert.equal(submitted.merged, true)

  const audit = service.audit()
  assert.equal(audit.ok, true)
  assert.ok(audit.events > 10)

  assert.throws(() => service.resolveMandate(bobMandate.token, carolActor), /belongs to/)
  assert.ok(service.resolveMandate(bobMandate.token, bobActor))
  assert.ok(root)

  // A stale branch that edits the same lines is rejected by merge-tree, not by opinion.
  const staleTask = service.createTask(aliceActor, { title: 'stale auth branch', repoPath: repo, baseBranch: 'main' })
  const staleMandate = service.issueMandate(aliceActor, {
    subject: alice.principal.id,
    task: staleTask.id,
    paths: ['src/auth.ts'],
    branches: [staleTask.branch],
    ttlSeconds: 600,
  })
  assert.throws(
    () => service.submit(bobActor, staleTask.id, {}, bobMandate.record.claims),
    (error) => error instanceof TeamplaneError && error.status === 403,
  )
  const staleWorktree = join(root, '.teamplane-worktrees', staleTask.id)
  git(repo, ['worktree', 'add', '-b', staleTask.branch, staleWorktree, baseCommit])
  commitFile(staleWorktree, 'src/auth.ts', stale, 'stale edit')
  const conflicted = service.submit(aliceActor, staleTask.id, { requireLease: false }, staleMandate.record.claims)
  assert.equal(conflicted.ok, false)
  assert.ok(conflicted.conflicts.some((path) => path.includes('src/auth.ts')), JSON.stringify(conflicted))

  service.disablePrincipal(aliceActor, carol.principal.id)
  assert.throws(() => service.authenticate(carol.token), /disabled/)
})
