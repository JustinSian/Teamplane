import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject, loadWorkspace } from '../core/config.js'
import { ApiClient, ApiError } from '../client/api.js'
import { startServer } from '../server/http.js'

interface StepResult {
  name: string
  ok: boolean
  detail: string
  ms: number
}

export interface DemoOptions {
  ci?: boolean
  keep?: boolean
}

export async function runDemo(options: DemoOptions = {}): Promise<number> {
  const started = Date.now()
  const root = mkdtempSync(join(tmpdir(), 'teamplane-demo-'))
  const repo = join(root, 'repo')
  const steps: StepResult[] = []
  let failures = 0

  const step = async (name: string, fn: () => Promise<string> | string): Promise<void> => {
    const begin = Date.now()
    try {
      const detail = await fn()
      steps.push({ name, ok: true, detail, ms: Date.now() - begin })
    } catch (error) {
      failures += 1
      steps.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error), ms: Date.now() - begin })
    }
  }

  const expect: (condition: unknown, message: string) => asserts condition = (condition, message) => {
    if (!condition) throw new Error(message)
  }

  let running: Awaited<ReturnType<typeof startServer>> | null = null
  let workspace: ReturnType<typeof loadWorkspace> | null = null

  try {
    mkdirSync(repo, { recursive: true })
    seedRepo(repo)

    const init = initProject({ root: repo, name: 'acme', owner: 'alice', port: 0 })
    workspace = loadWorkspace(repo)
    running = await startServer(workspace, { port: 0, quiet: true })
    workspace.service.options.publicUrl = running.url

    const baseUrl = running.url
    const alice = new ApiClient({ baseUrl, token: init.token })
    const aliceId = init.principal.id

    let bobId = ''
    let carolId = ''
    let bobToken = ''
    let carolToken = ''

    await step('initialize control plane', () => `owner alice (${aliceId})`)

    await step('create two teammates', async () => {
      const bob = await alice.createPrincipal({ kind: 'agent', display: 'bob', roles: ['maintainer'] })
      const carol = await alice.createPrincipal({ kind: 'agent', display: 'carol', roles: ['agent'] })
      bobId = bob.principal.id
      carolId = carol.principal.id
      bobToken = bob.token
      carolToken = carol.token
      return `bob=${bobId} carol=${carolId}`
    })

    const taskA = (await alice.createTask({ title: 'Refactor auth token rotation', repoPath: repo, baseBranch: 'main' })).id as string
    const taskB = (await alice.createTask({ title: 'Add auth tests', repoPath: repo, baseBranch: 'main', assignee: bobId })).id as string
    const taskC = (await alice.createTask({ title: 'Document the auth flow', repoPath: repo, baseBranch: 'main', assignee: carolId })).id as string
    await step('create three tasks', () => `${taskA}, ${taskB}, ${taskC}`)

    const issuedA = await alice.issueMandate({
      subject: aliceId,
      task: taskA,
      paths: ['src/auth.ts'],
      memory: ['team'],
      ttlSeconds: 3600,
    })
    const issuedB = await alice.issueMandate({
      subject: bobId,
      task: taskB,
      paths: ['tests/auth', 'src/auth.ts'],
      branches: ['main'],
      memory: ['team'],
      actions: ['fs.read', 'fs.write', 'lease.acquire', 'memory.read', 'memory.write', 'task.submit', 'git.push'],
      ttlSeconds: 3600,
    })
    const issuedC = await alice.issueMandate({
      subject: carolId,
      task: taskC,
      paths: ['docs'],
      memory: ['team'],
      ttlSeconds: 3600,
    })
    const mandateA = issuedA.token
    const mandateB = issuedB.token
    const mandateC = issuedC.token
    await step('issue signed mandates', () => `A=${issuedA.mandate.id} B=${issuedB.mandate.id} C=${issuedC.mandate.id}`)

    const aliceM = new ApiClient({ baseUrl, token: init.token, mandate: mandateA })
    const bobM = new ApiClient({ baseUrl, token: bobToken, mandate: mandateB })
    const carolM = new ApiClient({ baseUrl, token: carolToken, mandate: mandateC })

    await step('start isolated worktrees', async () => {
      await alice.startTask(taskA, issuedA.mandate.id)
      await alice.startTask(taskB, issuedB.mandate.id)
      await alice.startTask(taskC, issuedC.mandate.id)
      return 'three git worktrees, three signed .teamplane contexts'
    })

    let leaseA = ''
    await step('alice leases src/auth.ts', async () => {
      const lease = await aliceM.acquireLease({ key: 'file:src/auth.ts', task: taskA, ttlSeconds: 600 })
      leaseA = lease.id as string
      return `${lease.key as string} fencing=${lease.fencing as number}`
    })

    await step('bob is blocked from the same file', async () => {
      try {
        await bobM.acquireLease({ key: 'file:src/auth.ts', task: taskB, ttlSeconds: 600 })
        throw new Error('expected a lease conflict')
      } catch (error) {
        expect(error instanceof ApiError, `expected ApiError, got ${String(error)}`)
        expect(error.status === 409, `expected 409, got ${error.status}`)
        return `409 ${error.code}: ${error.message}`
      }
    })

    let leaseB = ''
    await step('bob leases the tests directory instead', async () => {
      const lease = await bobM.acquireLease({ key: 'dir:tests/auth', task: taskB, ttlSeconds: 600 })
      leaseB = lease.id as string
      return `${lease.key as string} fencing=${lease.fencing as number}`
    })

    await step('carol cannot write outside her mandate', async () => {
      const decision = (await carolM.authorize('fs.write', 'file:src/auth.ts')) as { decision: string; reason: string }
      expect(decision.decision === 'deny', `expected deny, got ${decision.decision}`)
      return `${decision.decision}: ${decision.reason}`
    })

    await step('team memory is readable, role memory is not', async () => {
      await aliceM.writeMemory({
        kind: 'decision',
        topic: 'token-rotation',
        text: 'Refresh tokens rotate on every use; reuse revokes the whole family.',
        visibility: 'team',
        namespace: 'team',
      })
      await aliceM.writeMemory({
        kind: 'convention',
        topic: 'auth-review',
        text: 'Auth changes need a second reviewer from maintainers.',
        visibility: 'role:maintainer',
        namespace: 'team',
      })
      const bobResults = await bobM.searchMemory('token rotation')
      const carolResults = await carolM.searchMemory('token rotation')
      expect(bobResults.results.length >= 1, 'bob should read the team decision')
      expect(!carolResults.results.some((item) => item.visibility === 'role:maintainer'), 'carol must not read maintainer memory')
      return `bob=${bobResults.results.length} fragments, carol=${carolResults.results.length} (no role:maintainer)`
    })

    await step('force push requires an owner approval, exactly once', async () => {
      const before = (await bobM.authorize('git.push', 'branch:main', { request: { force: true } })) as { decision: string }
      expect(before.decision === 'ask', `expected ask, got ${before.decision}`)
      const approval = await bobM.requestApproval({ action: 'git.push', resource: 'branch:main' })
      const approvalId = approval.id as string
      await alice.resolveApproval(approvalId, true, 'one-off force push for a rebase')
      const after = (await bobM.authorize('git.push', 'branch:main', { request: { force: true } }, approvalId)) as { decision: string }
      expect(after.decision === 'allow', `expected allow after approval, got ${after.decision}`)
      await bobM.post(`/v1/approvals/${approvalId}/consume`, { action: 'git.push', resource: 'branch:main' })
      const replay = (await bobM.authorize('git.push', 'branch:main', { request: { force: true } }, approvalId)) as { decision: string }
      expect(replay.decision === 'ask', `expected ask on replay, got ${replay.decision}`)
      return `ask -> approved -> allow -> replay ${replay.decision}`
    })

    await step('alice submits through the merge gate', async () => {
      const worktree = join(root, '.teamplane-worktrees', taskA)
      writeFileSync(join(worktree, 'src', 'auth.ts'), 'export function rotateToken(token: string): string {\n  return `${token}:rotated`\n}\n')
      gitCommit(worktree, 'refactor auth rotation')
      const result = (await aliceM.submit(taskA, { verify: ['node -e "process.exit(0)"'], merge: true })) as { ok: boolean; merged: boolean; changedFiles: string[] }
      expect(result.ok && result.merged, `submit failed: ${JSON.stringify(result)}`)
      return `merged ${result.changedFiles.join(', ')}`
    })

    await step('failed verification stops a merge', async () => {
      const worktree = join(root, '.teamplane-worktrees', taskB)
      mkdirSync(join(worktree, 'tests', 'auth'), { recursive: true })
      writeFileSync(join(worktree, 'tests', 'auth', 'rotation.test.ts'), 'test("rotation", () => {})\n')
      gitCommit(worktree, 'add auth tests')
      const result = (await bobM.submit(taskB, { verify: ['node -e "process.exit(1)"'] })) as { ok: boolean; reason: string }
      expect(!result.ok, 'expected verification failure')
      return result.reason
    })

    await step('verification passes and the work is accepted', async () => {
      const result = (await bobM.submit(taskB, { verify: ['node -e "process.exit(0)"'] })) as { ok: boolean; reason: string }
      expect(result.ok, `expected success, got ${result.reason}`)
      return result.reason
    })

    await step('audit chain verifies', async () => {
      const audit = await alice.audit()
      expect(audit.ok, `audit failed: ${JSON.stringify(audit)}`)
      return `${audit.events} events, hash chain intact`
    })

    await step('release leases', async () => {
      await aliceM.releaseLease(leaseA)
      await bobM.releaseLease(leaseB)
      return 'leases released cleanly'
    })

    await running.close()
    workspace.log.close()
    running = null
    workspace = null

    const report = renderReport(steps, failures, Date.now() - started)
    const outDir = join(process.cwd(), 'demo', 'out')
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'report.md'), report)
    writeFileSync(join(outDir, 'report.json'), JSON.stringify({ steps, failures, durationMs: Date.now() - started }, null, 2))
    process.stdout.write(`${report}\n`)
    if (!options.keep) rmSync(root, { recursive: true, force: true })
    return failures === 0 ? 0 : 1
  } catch (error) {
    process.stderr.write(`demo failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    if (running) await running.close().catch(() => undefined)
    if (workspace) workspace.log.close()
    if (!options.keep) rmSync(root, { recursive: true, force: true })
    return 1
  }
}

function seedRepo(repo: string): void {
  mkdirSync(join(repo, 'src'), { recursive: true })
  mkdirSync(join(repo, 'tests'), { recursive: true })
  mkdirSync(join(repo, 'docs'), { recursive: true })
  writeFileSync(join(repo, 'src', 'auth.ts'), 'export function rotate(token: string): string {\n  return token\n}\n')
  writeFileSync(join(repo, 'src', 'api.ts'), 'export function handler(): string {\n  return "ok"\n}\n')
  writeFileSync(join(repo, 'tests', 'auth.test.ts'), 'test("placeholder", () => {})\n')
  writeFileSync(join(repo, 'docs', 'README.md'), '# Acme\n')
  writeFileSync(join(repo, '.gitignore'), '.teamplane/\n.teamplane-worktrees/\nnode_modules/\n')
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.name', 'Teamplane Demo'])
  git(repo, ['config', 'user.email', 'demo@teamplane.dev'])
  git(repo, ['add', '.'])
  git(repo, ['commit', '-m', 'seed repo'])
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
}

function gitCommit(cwd: string, message: string): void {
  git(cwd, ['config', 'user.name', 'Teamplane Demo'])
  git(cwd, ['config', 'user.email', 'demo@teamplane.dev'])
  git(cwd, ['add', '.'])
  git(cwd, ['commit', '-m', message])
}

function renderReport(steps: StepResult[], failures: number, durationMs: number): string {
  const rows = steps
    .map(
      (step) =>
        `| ${step.ok ? 'PASS' : 'FAIL'} | ${step.name} | ${step.ms} ms | ${step.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`,
    )
    .join('\n')
  const passed = steps.filter((step) => step.ok).length
  return `# Teamplane demo report

- Result: **${failures === 0 ? 'PASS' : 'FAIL'}**
- Steps: ${passed}/${steps.length} passed
- Duration: ${(durationMs / 1000).toFixed(1)} s
- Generated: ${new Date().toISOString()}

| Status | Step | Time | Detail |
|---|---|---|---|
${rows}

## What this demonstrates

1. **Multi-principal mandates** — alice, bob and carol each hold a signed, task-scoped mandate; carol cannot write \`src/auth.ts\`.
2. **Deterministic gating** — the force-push decision is \`ask\`, becomes \`allow\` only with a one-shot owner approval, and returns to \`ask\` after consumption. No model is consulted.
3. **Structured events, not transcripts** — lease conflicts, approvals and submit results are events; no session transcript is stored or shared.
`
}
