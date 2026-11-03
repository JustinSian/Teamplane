import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject, loadWorkspace, type LoadedWorkspace } from '../core/config.js'
import { startServer, type RunningServer } from '../server/http.js'
import { seedRepo } from './repo.js'

export interface PlaygroundSeed {
  root: string
  repo: string
  workspace: LoadedWorkspace
  running: RunningServer
  tokens: { alice: string; bob: string; carol: string }
  ids: { alice: string; bob: string; carol: string; tasks: string[]; mandates: string[] }
}

export interface PlaygroundOptions {
  port?: number
  host?: string
  root?: string
}

/**
 * Create a realistic, self-contained Teamplane workspace and serve it.
 * The caller owns the temp directory and the running server.
 */
export async function seedPlayground(options: PlaygroundOptions = {}): Promise<PlaygroundSeed> {
  const root = options.root ?? mkdtempSync(join(tmpdir(), 'teamplane-playground-'))
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  seedRepo(repo)

  const init = initProject({ root: repo, name: 'acme', owner: 'alice', port: options.port ?? 0, keysDir: join(root, 'keys') })
  const workspace = loadWorkspace(repo)
  const running = await startServer(workspace, { port: options.port ?? 0, host: options.host, quiet: true })
  workspace.service.options.publicUrl = running.url

  const service = workspace.service
  const alice = service.authenticate(init.token)
  const bob = service.createPrincipal(alice, { kind: 'agent', display: 'bob', roles: ['maintainer'] })
  const carol = service.createPrincipal(alice, { kind: 'agent', display: 'carol', roles: ['agent'] })

  const taskA = service.createTask(alice, { title: 'Refactor auth token rotation', repoPath: repo, baseBranch: 'main' })
  const taskB = service.createTask(alice, { title: 'Add auth rotation tests', repoPath: repo, baseBranch: 'main', assignee: bob.principal.id })
  const taskC = service.createTask(alice, { title: 'Document the auth flow', repoPath: repo, baseBranch: 'main', assignee: carol.principal.id })
  service.createTask(alice, { title: 'Migrate session cookies to SameSite=Strict', repoPath: repo, baseBranch: 'main' })

  const mandateA = service.issueMandate(alice, {
    subject: init.principal.id,
    task: taskA.id,
    paths: ['src/auth.ts'],
    memory: ['team'],
    ttlSeconds: 3600,
  })
  const mandateB = service.issueMandate(alice, {
    subject: bob.principal.id,
    task: taskB.id,
    paths: ['tests/auth', 'src/auth.ts'],
    branches: ['main'],
    memory: ['team'],
    actions: ['fs.read', 'fs.write', 'lease.acquire', 'memory.read', 'memory.write', 'task.submit', 'git.push'],
    ttlSeconds: 3600,
  })
  const mandateC = service.issueMandate(alice, {
    subject: carol.principal.id,
    task: taskC.id,
    paths: ['docs'],
    memory: ['team'],
    ttlSeconds: 3600,
  })

  service.startTask(alice, taskA.id, mandateA.record.id)
  service.startTask(alice, taskB.id, mandateB.record.id)
  service.startTask(alice, taskC.id, mandateC.record.id)

  service.acquireLease(alice, { key: 'file:src/auth.ts', task: taskA.id, mandate: mandateA.record.claims, ttlSeconds: 900 })
  service.acquireLease(service.authenticate(bob.token), {
    key: 'dir:tests/auth',
    task: taskB.id,
    mandate: mandateB.record.claims,
    ttlSeconds: 900,
  })

  service.writeMemory(alice, {
    kind: 'decision',
    topic: 'token-rotation',
    text: 'Refresh tokens rotate on every use; reuse revokes the whole family.',
    visibility: 'team',
    namespace: 'team',
  })
  service.writeMemory(alice, {
    kind: 'convention',
    topic: 'auth-review',
    text: 'Auth changes need a second reviewer from maintainers.',
    visibility: 'role:maintainer',
    namespace: 'team',
  })
  service.writeMemory(alice, {
    kind: 'pitfall',
    topic: 'clock-skew',
    text: 'The staging host runs 40s behind; always compare token expiry server-side.',
    visibility: 'team',
    namespace: 'team',
  })

  // A real denial in the feed: carol tries to write outside her mandate.
  service.authorize(service.authenticate(carol.token), 'fs.write', 'file:src/auth.ts', {}, mandateC.record.claims)

  // A pending approval for the console to act on.
  service.requestApproval(service.authenticate(bob.token), {
    action: 'git.push',
    resource: 'branch:main',
    mandateId: mandateB.record.id,
    ttlSeconds: 1800,
    fields: { request: { force: true } },
  })

  return {
    root,
    repo,
    workspace,
    running,
    tokens: { alice: init.token, bob: bob.token, carol: carol.token },
    ids: {
      alice: init.principal.id,
      bob: bob.principal.id,
      carol: carol.principal.id,
      tasks: [taskA.id, taskB.id, taskC.id],
      mandates: [mandateA.record.id, mandateB.record.id, mandateC.record.id],
    },
  }
}
