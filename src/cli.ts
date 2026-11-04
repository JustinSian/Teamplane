import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { Policy, Role } from './core/types.js'
import { findRoot, initProject, loadWorkspace, readConfig, readJoinConfig, readPolicyFile, writeJoinConfig, writePolicyFile } from './core/config.js'
import { ApiError, ApiClient, requireToken } from './client/api.js'
import { TeamplaneError, canonicalJson, parseDuration, parseJson } from './core/util.js'
import { validatePolicy } from './policy/engine.js'
import { verifyMandate } from './domain/mandate.js'
import { signCheckpoint, verifyCheckpoint, type AuditCheckpoint } from './domain/checkpoint.js'
import { runMcpStdio } from './mcp/stdio.js'
import { runDemo } from './demo/run.js'
import { seedPlayground } from './demo/seed.js'

const OPTIONS = {
  name: { type: 'string' },
  owner: { type: 'string' },
  dir: { type: 'string' },
  host: { type: 'string' },
  port: { type: 'string' },
  repo: { type: 'string' },
  base: { type: 'string' },
  title: { type: 'string' },
  subject: { type: 'string' },
  task: { type: 'string' },
  paths: { type: 'string', multiple: true },
  actions: { type: 'string', multiple: true },
  branches: { type: 'string', multiple: true },
  memory: { type: 'string', multiple: true },
  ttl: { type: 'string' },
  mode: { type: 'string' },
  key: { type: 'string' },
  kind: { type: 'string' },
  topic: { type: 'string' },
  text: { type: 'string' },
  visibility: { type: 'string' },
  namespace: { type: 'string' },
  query: { type: 'string' },
  action: { type: 'string' },
  resource: { type: 'string' },
  role: { type: 'string' },
  token: { type: 'string' },
  server: { type: 'string' },
  file: { type: 'string' },
  reason: { type: 'string' },
  since: { type: 'string' },
  types: { type: 'string' },
  limit: { type: 'string' },
  id: { type: 'string' },
  verify: { type: 'string', multiple: true },
  merge: { type: 'boolean' },
  json: { type: 'boolean' },
  force: { type: 'boolean' },
  quiet: { type: 'boolean' },
  ci: { type: 'boolean' },
  out: { type: 'string' },
  checkpoint: { type: 'string' },
  keep: { type: 'boolean' },
  open: { type: 'boolean' },
  detach: { type: 'boolean' },
} as const

interface Parsed {
  values: Record<string, string | boolean | string[] | undefined>
  positionals: string[]
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let parsed: Parsed
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: false }) as unknown as Parsed
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
  const [command, sub, ...rest] = parsed.positionals
  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(usage())
    return 0
  }

  try {
    switch (command) {
      case 'init':
        return cmdInit(parsed)
      case 'join':
        return cmdJoin(parsed)
      case 'serve':
        return await cmdServe(parsed)
      case 'user':
        return await cmdUser(parsed, sub)
      case 'role':
        return await cmdRole(parsed, sub)
      case 'policy':
        return await cmdPolicy(parsed, sub)
      case 'mandate':
        return await cmdMandate(parsed, sub)
      case 'task':
        return await cmdTask(parsed, sub)
      case 'lease':
        return await cmdLease(parsed, sub)
      case 'memory':
        return await cmdMemory(parsed, sub)
      case 'approve':
        return await cmdApprove(parsed, true)
      case 'reject':
        return await cmdApprove(parsed, false)
      case 'submit':
        return await cmdSubmit(parsed)
      case 'events':
        return await cmdEvents(parsed, sub)
      case 'audit':
        return cmdAudit(parsed, sub)
      case 'dsh':
        return cmdDsh(parsed, sub)
      case 'mcp':
        await runMcpStdio()
        return 0
      case 'demo':
        return await runDemo({ ci: Boolean(parsed.values.ci) })
      case 'playground':
        return await cmdPlayground(parsed)
      case 'doctor':
        return cmdDoctor(parsed)
      case 'version':
        process.stdout.write('teamplane 0.7.2\n')
        return 0
      default:
        process.stderr.write(`Unknown command: ${command}\n\n${usage()}`)
        return 2
    }
  } catch (error) {
    if (error instanceof ApiError) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`)
      if (error.details) process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`)
      return error.status === 409 ? 3 : 1
    }
    if (error instanceof TeamplaneError) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`)
      if (error.details) process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`)
      return 1
    }
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

function usage(): string {
  return `teamplane 0.7.2 — a deterministic control plane for multi-user agent teams

Usage: teamplane <command> [options]

  init      --name <team> --owner <name> [--dir .] [--port 7317]
  join      --server <url> [--name <team>]
  serve     [--port] [--host] [--quiet] [--open]
  user add  --name <display> [--kind user|agent|service] [--role agent]
  user disable --id <principal> [--reason ...]
  user list
  role grant --id <principal> --role <role>
  policy show | apply --file policy.json | lint --file policy.json | explain --action <a> --resource <r>
  mandate issue  --subject <id> --task <id> --paths <p> [--paths ...] [--ttl 1h]
  mandate derive --id <mandate> [--paths ...] [--ttl 30m]
  mandate verify --token <token>
  mandate revoke --id <mandate>
  mandate list
  task create --title <t> [--repo <path>] [--base main]
  task start  <taskId> [--id <mandateId>]
  task verify <taskId> --verify <command>
  task launch <taskId> [--detach] [-- <command...>]
  task list | task show <taskId>
  lease acquire --key file:src/x.ts --task <id> [--mode exclusive] [--ttl 15m]
  lease renew <leaseId> [--ttl 15m] | lease release <leaseId> | lease list
  memory put --kind decision --topic <t> --text <text> [--visibility team]
  memory search --query <q> [--kind decision]
  memory conflicts
  approve <approvalId> [--reason ...] | reject <approvalId>
  submit <taskId> [--merge]
  events tail [--since 0] [--types lease.,approval.]
  audit verify [--checkpoint <file>] | audit sign [--out <file>] | audit export
  dsh print-config
  mcp
  playground [--port 7317] [--open] [--keep]
  demo [--ci]
  doctor
  version

Environment: TEAMPLANE_URL, TEAMPLANE_TOKEN, TEAMPLANE_MANDATE
`
}

function value(parsed: Parsed, key: string): string | undefined {
  const raw = parsed.values[key]
  return typeof raw === 'string' ? raw : undefined
}

function values(parsed: Parsed, key: string): string[] {
  const raw = parsed.values[key]
  return Array.isArray(raw) ? raw : []
}

function flag(parsed: Parsed, key: string): boolean {
  return parsed.values[key] === true
}

function print(parsed: Parsed, valueToPrint: unknown, text?: string): void {
  if (flag(parsed, 'json')) {
    process.stdout.write(`${JSON.stringify(valueToPrint, null, 2)}\n`)
  } else {
    process.stdout.write(`${text ?? JSON.stringify(valueToPrint, null, 2)}\n`)
  }
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)))
  const line = (cells: string[]) => cells.map((cell, index) => (cell ?? '').padEnd(widths[index]!)).join('  ').trimEnd()
  return [line(headers), ...rows.map(line)].join('\n')
}

function cmdInit(parsed: Parsed): number {
  const dir = value(parsed, 'dir') ?? process.cwd()
  const result = initProject({
    root: dir,
    name: value(parsed, 'name') ?? 'team',
    owner: value(parsed, 'owner') ?? 'owner',
    host: value(parsed, 'host'),
    port: value(parsed, 'port') ? Number(value(parsed, 'port')) : undefined,
    force: flag(parsed, 'force'),
  })
  const consoleHost = result.config.host === '0.0.0.0' ? '127.0.0.1' : result.config.host
  process.stdout.write(
    `Initialized "${result.config.name}" in ${result.root}\n\n` +
      `Owner:  ${result.principal.display} (${result.principal.id})\n` +
      `Token:  ${result.token}\n` +
      `Keys:   ${result.config.keysDir ?? '(workspace)'}\n\n` +
      `This token is shown once. Export it before using the CLI:\n` +
      `  export TEAMPLANE_TOKEN="${result.token}"\n` +
      `Start the control plane with:\n` +
      `  teamplane serve\n` +
      `Then open:\n` +
      `  http://${consoleHost}:${result.config.port}/\n`,
  )
  return 0
}

function cmdJoin(parsed: Parsed): number {
  const root = findRoot()
  const server = value(parsed, 'server')
  if (!server) {
    process.stderr.write('error: --server <url> is required\n')
    return 2
  }
  writeJoinConfig(root, { version: 1, server, name: value(parsed, 'name') ?? readConfig(root).name, joinedAt: new Date().toISOString() })
  process.stdout.write(`Joined ${server}. Set TEAMPLANE_TOKEN to your principal token.\n`)
  return 0
}

async function cmdPlayground(parsed: Parsed): Promise<number> {
  const port = value(parsed, 'port') ? Number(value(parsed, 'port')) : 0
  const seed = await seedPlayground({ port, host: value(parsed, 'host') })
  const consoleUrl = `${seed.running.url}/?token=${encodeURIComponent(seed.tokens.alice)}`
  process.stdout.write(
    `Teamplane playground\n\n` +
      `Console: ${consoleUrl}\n` +
      `Owner:   alice (${seed.ids.alice})\n` +
      `Token:   ${seed.tokens.alice}\n\n` +
      `Three agents, three tasks, two live leases, one pending approval.\n` +
      `Press Ctrl+C to stop.\n`,
  )
  if (flag(parsed, 'open')) openBrowser(consoleUrl)
  await new Promise<void>((resolve) => {
    const stop = () => {
      seed.running.close().then(() => {
        seed.workspace.log.close()
        if (!flag(parsed, 'keep')) rmSync(seed.root, { recursive: true, force: true })
        resolve()
      })
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  return 0
}

function openBrowser(url: string): void {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { stdio: 'ignore', detached: true })
  child.unref()
}

async function cmdServe(parsed: Parsed): Promise<number> {
  const workspace = loadWorkspace(process.cwd())
  const { startServer } = await import('./server/http.js')
  const running = await startServer(workspace, {
    port: value(parsed, 'port') ? Number(value(parsed, 'port')) : undefined,
    host: value(parsed, 'host'),
    quiet: flag(parsed, 'quiet'),
  })
  if (!flag(parsed, 'quiet')) {
    process.stdout.write(`Teamplane "${workspace.config.name}" listening on ${running.url}\n`)
    process.stdout.write(`Console: ${running.url}/\n`)
    process.stdout.write(`MCP:     ${running.url}/mcp\n`)
  }
  await new Promise<void>((resolve) => {
    const stop = () => {
      running.close().then(() => resolve())
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  workspace.log.close()
  return 0
}

async function cmdUser(parsed: Parsed, sub: string | undefined): Promise<number> {
  const client = makeClient()
  if (sub === 'add') {
    const created = await client.createPrincipal({
      kind: value(parsed, 'kind') ?? 'agent',
      display: value(parsed, 'name') ?? 'agent',
      roles: [(value(parsed, 'role') as Role | undefined) ?? 'agent'],
    })
    print(
      parsed,
      created,
      `Created ${created.principal.display} (${created.principal.id})\nToken: ${created.token}\nThis token is shown once.`,
    )
    return 0
  }
  if (sub === 'disable') {
    const id = value(parsed, 'id') ?? parsed.positionals[2] ?? ''
    await client.post(`/v1/principals/${encodeURIComponent(id)}/disable`, { reason: value(parsed, 'reason') ?? '' })
    print(parsed, { ok: true }, `Disabled ${id}`)
    return 0
  }
  if (sub === 'list' || sub === undefined) {
    const payload = await client.get<{ principals: Array<Record<string, unknown>> }>('/v1/principals')
    print(
      parsed,
      payload.principals,
      table(
        ['ID', 'KIND', 'DISPLAY', 'ROLES'],
        payload.principals.map((principal) => [
          String(principal.id),
          String(principal.kind),
          String(principal.display),
          Array.isArray(principal.roles) ? principal.roles.join(',') : '',
        ]),
      ),
    )
    return 0
  }
  process.stderr.write(`Unknown user subcommand: ${sub}\n`)
  return 2
}

async function cmdRole(parsed: Parsed, sub: string | undefined): Promise<number> {
  if (sub !== 'grant') {
    process.stderr.write('Usage: teamplane role grant --id <principal> --role <role>\n')
    return 2
  }
  const client = makeClient()
  const result = await client.grantRole(value(parsed, 'id') ?? '', (value(parsed, 'role') ?? 'agent') as Role)
  print(parsed, result, `Granted ${value(parsed, 'role')} to ${value(parsed, 'id')}`)
  return 0
}

async function cmdPolicy(parsed: Parsed, sub: string | undefined): Promise<number> {
  const root = findRoot()
  if (sub === 'show' || sub === undefined) {
    const client = makeClient()
    print(parsed, await client.policy())
    return 0
  }
  if (sub === 'lint') {
    const file = value(parsed, 'file') ?? join(root, '.teamplane', 'policy.json')
    const policy = readPolicyFile(file) as Policy
    const errors = validatePolicy(policy)
    if (errors.length > 0) {
      process.stderr.write(`${errors.map((error) => `- ${error}`).join('\n')}\n`)
      return 1
    }
    process.stdout.write('policy is valid\n')
    return 0
  }
  if (sub === 'apply') {
    const file = value(parsed, 'file') ?? join(root, '.teamplane', 'policy.json')
    const policy = readPolicyFile(file)
    const client = makeClient()
    const saved = await client.updatePolicy(policy)
    writePolicyFile(root, saved)
    print(parsed, saved, `Applied policy version ${saved.version}`)
    return 0
  }
  if (sub === 'explain') {
    const client = makeClient()
    const result = await client.explain(value(parsed, 'action') ?? '', value(parsed, 'resource') ?? '')
    print(parsed, result)
    return 0
  }
  process.stderr.write(`Unknown policy subcommand: ${sub}\n`)
  return 2
}

async function cmdMandate(parsed: Parsed, sub: string | undefined): Promise<number> {
  const root = findRoot()
  if (sub === 'verify') {
    const token = value(parsed, 'token')
    if (!token) {
      process.stderr.write('error: --token is required\n')
      return 2
    }
    const workspace = loadWorkspace(root)
    const claims = verifyMandate(token, workspace.keys.publicKeyPem)
    print(parsed, claims)
    return 0
  }
  if (sub === 'list') {
    const client = makeClient()
    print(parsed, await client.mandates())
    return 0
  }
  const client = makeClient()
  if (sub === 'issue') {
    const issued = await client.issueMandate({
      subject: value(parsed, 'subject') ?? '',
      task: value(parsed, 'task') ?? '',
      paths: values(parsed, 'paths'),
      actions: values(parsed, 'actions').length ? values(parsed, 'actions') : undefined,
      branches: values(parsed, 'branches').length ? values(parsed, 'branches') : undefined,
      memory: values(parsed, 'memory').length ? values(parsed, 'memory') : undefined,
      ttlSeconds: value(parsed, 'ttl') ? parseDuration(value(parsed, 'ttl')!) : undefined,
    })
    print(parsed, issued, `Issued mandate ${(issued.mandate as { id: string }).id}\nToken: ${issued.token}`)
    return 0
  }
  if (sub === 'derive') {
    const issued = await client.deriveMandate(value(parsed, 'id') ?? '', {
      paths: values(parsed, 'paths').length ? values(parsed, 'paths') : undefined,
      actions: values(parsed, 'actions').length ? values(parsed, 'actions') : undefined,
      ttlSeconds: value(parsed, 'ttl') ? parseDuration(value(parsed, 'ttl')!) : undefined,
    })
    print(parsed, issued, `Derived mandate ${(issued.mandate as { id: string }).id}\nToken: ${issued.token}`)
    return 0
  }
  if (sub === 'revoke') {
    const result = await client.revokeMandate(value(parsed, 'id') ?? '', value(parsed, 'reason') ?? '')
    print(parsed, result, 'Revoked.')
    return 0
  }
  process.stderr.write(`Unknown mandate subcommand: ${sub}\n`)
  return 2
}

async function cmdTask(parsed: Parsed, sub: string | undefined): Promise<number> {
  const client = makeClient()
  if (sub === 'create') {
    const task = await client.createTask({
      title: value(parsed, 'title') ?? '',
      repoPath: value(parsed, 'repo'),
      baseBranch: value(parsed, 'base'),
      verify: values(parsed, 'verify'),
    })
    print(parsed, task, `Created task ${task.id as string}`)
    return 0
  }
  if (sub === 'verify') {
    const taskId = value(parsed, 'task') ?? parsed.positionals[2] ?? ''
    const task = await client.setTaskVerify(taskId, values(parsed, 'verify'))
    print(parsed, task, `Updated verification for ${taskId}`)
    return 0
  }
  if (sub === 'start') {
    const taskId = value(parsed, 'task') ?? parsed.positionals[2] ?? ''
    const task = await client.startTask(taskId, value(parsed, 'id'))
    if (flag(parsed, 'json')) {
      print(parsed, task)
    } else {
      process.stdout.write(
        `Started ${String(task.id)}\n` +
          `Worktree: ${String(task.worktree)}\n` +
          `Next: cd into the worktree, export TEAMPLANE_TOKEN, and run your agent there.\n` +
          `DSH: add the MCP row printed by "teamplane dsh print-config".\n`,
      )
    }
    return 0
  }
  if (sub === 'launch') {
    const taskId = value(parsed, 'task') ?? parsed.positionals[2] ?? ''
    const { tasks } = await client.tasks()
    const task = tasks.find((item) => item.id === taskId)
    if (!task) {
      process.stderr.write(`error: task ${taskId} not found\n`)
      return 1
    }
    if (!task.worktree) {
      process.stderr.write(`error: task ${taskId} has no worktree; run "teamplane task start ${taskId} --id <mandate>" first\n`)
      return 1
    }
    const worktree = String(task.worktree)
    const command = parsed.positionals.slice(3)
    const cmd = command[0] ?? 'dsh'
    const args = command.slice(1)
    const contextPath = join(worktree, '.teamplane', 'context.json')
    let mandate = process.env.TEAMPLANE_MANDATE
    if (!mandate && existsSync(contextPath)) {
      try {
        const context = JSON.parse(readFileSync(contextPath, 'utf8')) as { mandate?: string }
        mandate = context.mandate
      } catch {
        /* a missing context is reported by the guard, not here */
      }
    }
    const env: NodeJS.ProcessEnv = { ...process.env, TEAMPLANE_URL: client.baseUrl, TEAMPLANE_TASK: taskId }
    // Never forward the caller's principal token: the launched agent must use its
    // own token (from the DSH config / its environment), not the owner's.
    delete env.TEAMPLANE_TOKEN
    delete env.TEAMPLANE_MANDATE
    if (mandate) env.TEAMPLANE_MANDATE = mandate
    const detach = flag(parsed, 'detach')
    const child = spawn(cmd, args, { cwd: worktree, env, stdio: detach ? 'ignore' : 'inherit', detached: detach })
    const exited = detach
      ? null
      : new Promise<number>((resolve, reject) => {
          child.once('error', reject)
          child.once('exit', (code) => resolve(code ?? 1))
        })
    if (detach) {
      child.once('error', (error) => process.stderr.write(`launch error: ${error.message}\n`))
      child.unref()
      const launch = (await client.post(`/v1/tasks/${encodeURIComponent(taskId)}/launched`, {
        command: [cmd, ...args].join(' '),
        pid: child.pid ?? null,
      })) as { id: string }
      process.stdout.write(`Launched ${cmd} in ${worktree} (pid ${child.pid ?? '?'}, launch ${launch.id})\n`)
      return 0
    }
    const launch = (await client.post(`/v1/tasks/${encodeURIComponent(taskId)}/launched`, {
      command: [cmd, ...args].join(' '),
      pid: child.pid ?? null,
    })) as { id: string }
    process.stdout.write(`Launched ${cmd} in ${worktree} (launch ${launch.id})\n`)
    return exited ? await exited : 0
  }
  if (sub === 'list' || sub === undefined) {
    const { tasks } = await client.tasks()
    print(
      parsed,
      tasks,
      table(
        ['ID', 'STATUS', 'TITLE', 'MANDATE', 'WORKTREE'],
        tasks.map((task) => [
          String(task.id),
          String(task.status),
          String(task.title),
          String(task.mandateId ?? '-'),
          String(task.worktree ?? '-'),
        ]),
      ),
    )
    return 0
  }
  if (sub === 'show') {
    const taskId = value(parsed, 'task') ?? parsed.positionals[2] ?? ''
    const { tasks } = await client.tasks()
    print(parsed, tasks.find((task) => task.id === taskId) ?? null)
    return 0
  }
  process.stderr.write(`Unknown task subcommand: ${sub}\n`)
  return 2
}

async function cmdLease(parsed: Parsed, sub: string | undefined): Promise<number> {
  const client = makeClient()
  if (sub === 'acquire') {
    const lease = await client.acquireLease({
      key: value(parsed, 'key') ?? '',
      mode: value(parsed, 'mode') ?? 'exclusive',
      task: value(parsed, 'task') ?? '',
      ttlSeconds: value(parsed, 'ttl') ? parseDuration(value(parsed, 'ttl')!) : undefined,
    })
    print(parsed, lease, `Acquired ${lease.key as string} (fencing ${lease.fencing as number}) until ${lease.expiresAt as string}`)
    return 0
  }
  if (sub === 'renew') {
    const lease = await client.renewLease(value(parsed, 'id') ?? parsed.positionals[2] ?? '', value(parsed, 'ttl') ? parseDuration(value(parsed, 'ttl')!) : undefined)
    print(parsed, lease)
    return 0
  }
  if (sub === 'release') {
    const result = await client.releaseLease(value(parsed, 'id') ?? parsed.positionals[2] ?? '')
    print(parsed, result, 'Released.')
    return 0
  }
  if (sub === 'list' || sub === undefined) {
    const { leases } = await client.leases()
    print(
      parsed,
      leases,
      table(
        ['ID', 'KEY', 'MODE', 'HOLDER', 'FENCING', 'EXPIRES'],
        leases.map((lease) => [
          String(lease.id),
          String(lease.key),
          String(lease.mode),
          String(lease.holder),
          String(lease.fencing),
          String(lease.expiresAt),
        ]),
      ),
    )
    return 0
  }
  process.stderr.write(`Unknown lease subcommand: ${sub}\n`)
  return 2
}

async function cmdMemory(parsed: Parsed, sub: string | undefined): Promise<number> {
  const client = makeClient()
  if (sub === 'put') {
    const fragment = await client.writeMemory({
      kind: value(parsed, 'kind') ?? 'decision',
      topic: value(parsed, 'topic') ?? '',
      text: value(parsed, 'text') ?? '',
      visibility: value(parsed, 'visibility') ?? 'team',
      namespace: value(parsed, 'namespace') ?? 'team',
    })
    print(parsed, fragment, `Stored memory ${fragment.id as string}`)
    return 0
  }
  if (sub === 'search' || sub === undefined) {
    const { results } = await client.searchMemory(value(parsed, 'query') ?? '', value(parsed, 'kind'))
    print(
      parsed,
      results,
      table(
        ['SCORE', 'KIND', 'TOPIC', 'VISIBILITY', 'TEXT'],
        results.map((item) => [
          String(item.score),
          String(item.kind),
          String(item.topic),
          String(item.visibility),
          String(item.text).slice(0, 60),
        ]),
      ),
    )
    return 0
  }
  if (sub === 'conflicts') {
    print(parsed, await client.memoryConflicts())
    return 0
  }
  process.stderr.write(`Unknown memory subcommand: ${sub}\n`)
  return 2
}

async function cmdApprove(parsed: Parsed, approve: boolean): Promise<number> {
  const client = makeClient()
  const id = value(parsed, 'id') ?? parsed.positionals[1] ?? ''
  const approval = await client.resolveApproval(id, approve, value(parsed, 'reason') ?? '')
  print(parsed, approval, `${approve ? 'Approved' : 'Rejected'} ${id}`)
  return 0
}

async function cmdSubmit(parsed: Parsed): Promise<number> {
  const client = makeClient()
  const taskId = value(parsed, 'task') ?? parsed.positionals[1] ?? ''
  if (values(parsed, 'verify').length > 0) {
    process.stderr.write('error: verification commands are bound to the task; use "teamplane task verify <id> --verify ..."' + String.fromCharCode(10))
    return 2
  }
  const result = await client.submit(taskId, { merge: flag(parsed, 'merge') })
  print(parsed, result)
  return result.ok ? 0 : 1
}

async function cmdEvents(parsed: Parsed, sub: string | undefined): Promise<number> {
  const client = makeClient()
  if (sub === 'tail') {
    let since = Number(value(parsed, 'since') ?? 0)
    const types = value(parsed, 'types')
    for (;;) {
      const { events } = await client.events(since, types)
      for (const event of events) {
        process.stdout.write(`${JSON.stringify(event)}\n`)
        since = Math.max(since, Number(event.seq))
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  const { events } = await client.events(Number(value(parsed, 'since') ?? 0), value(parsed, 'types'))
  print(parsed, events)
  return 0
}

function cmdAudit(parsed: Parsed, sub: string | undefined): number {
  const workspace = loadWorkspace()
  const NL = String.fromCharCode(10)
  if (sub === 'export') {
    for (const event of workspace.log.events()) process.stdout.write(JSON.stringify(event) + NL)
    workspace.log.close()
    return 0
  }
  const result = workspace.service.audit()
  if (!result.ok) {
    workspace.log.close()
    process.stderr.write('audit FAILED at seq ' + result.brokenAt + ': ' + result.reason + NL)
    return 1
  }
  if (sub === 'sign') {
    const checkpoint = signCheckpoint(result.events, workspace.log.state.lastHash, workspace.keys)
    const out = value(parsed, 'out') ?? '.teamplane/checkpoint.json'
    writeFileSync(out, canonicalJson(checkpoint) + NL)
    workspace.log.close()
    process.stdout.write('checkpoint written to ' + out + ': seq ' + checkpoint.seq + ', hash ' + checkpoint.hash + NL)
    return 0
  }
  const checkpointPath = value(parsed, 'checkpoint')
  if (checkpointPath) {
    if (!existsSync(checkpointPath)) {
      workspace.log.close()
      process.stderr.write('checkpoint ' + checkpointPath + ' not found' + NL)
      return 2
    }
    const checkpoint = parseJson<AuditCheckpoint>(readFileSync(checkpointPath, 'utf8'), 'checkpoint')
    const sigOk = verifyCheckpoint(checkpoint, workspace.keys.publicKeyPem)
    const headOk = checkpoint.seq === result.events && checkpoint.hash === workspace.log.state.lastHash
    workspace.log.close()
    if (!sigOk) {
      process.stderr.write('checkpoint FAILED: signature does not verify' + NL)
      return 1
    }
    if (!headOk) {
      process.stderr.write('checkpoint FAILED: head mismatch (checkpoint seq ' + checkpoint.seq + ', log ' + result.events + ')' + NL)
      return 1
    }
    process.stdout.write('audit ok: ' + result.events + ' events, checkpoint signature valid' + NL)
    return 0
  }
  workspace.log.close()
  process.stdout.write('audit ok: ' + result.events + ' events, hash chain intact' + NL)
  return 0
}

function cmdDsh(parsed: Parsed, sub: string | undefined): number {
  if (sub !== 'print-config') {
    process.stderr.write('Usage: teamplane dsh print-config\n')
    return 2
  }
  let url = process.env.TEAMPLANE_URL ?? 'http://127.0.0.1:7317'
  try {
    const root = findRoot()
    const config = readConfig(root)
    const join = readJoinConfig(root)
    url = process.env.TEAMPLANE_URL ?? join?.server ?? `http://${config.host}:${config.port}`
  } catch {
    // "dsh print-config" is useful outside a workspace; fall back to the default URL.
  }
  const configYaml = `# Add this row to your DSH profile's cordis.patch.yml.
# The stdio server reads TEAMPLANE_URL / TEAMPLANE_TOKEN from the environment.
- id: mcp-teamplane
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: teamplane
    transport: stdio
    command: teamplane
    args: ['mcp']
    failOnStartupError: false
    env:
      TEAMPLANE_URL: ${url}
      TEAMPLANE_TOKEN: !!js process.env.TEAMPLANE_TOKEN

# Streamable HTTP alternative (one shared control plane, per-user tokens):
# - id: mcp-teamplane-http
#   name: '@deepseek-ai/dsh-mcp-client'
#   config:
#     serverName: teamplane
#     transport: streamable-http
#     url: ${url}/mcp
#     headers:
#       Authorization: !!js '\`Bearer \${process.env.TEAMPLANE_TOKEN}\`'
#       X-Teamplane-Mandate: !!js process.env.TEAMPLANE_MANDATE
`
  process.stdout.write(configYaml)
  return 0
}

function cmdDoctor(parsed: Parsed): number {
  const checks: Array<[string, boolean, string]> = []
  checks.push(['node >= 20.11', Number(process.versions.node.split('.')[0]) >= 20, process.versions.node])
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' })
  checks.push(['git available', git.status === 0, (git.stdout ?? '').trim()])
  let root = ''
  try {
    root = findRoot()
    checks.push(['workspace initialized', true, root])
  } catch {
    checks.push(['workspace initialized', false, 'run teamplane init'])
  }
  if (root) {
    try {
      const workspace = loadWorkspace(root)
      const audit = workspace.service.audit()
      workspace.log.close()
      checks.push(['event log verifies', audit.ok, `${audit.events} events`])
      checks.push(['TEAMPLANE_TOKEN set', Boolean(process.env.TEAMPLANE_TOKEN), process.env.TEAMPLANE_TOKEN ? 'set' : 'missing'])
    } catch (error) {
      checks.push(['workspace loadable', false, error instanceof Error ? error.message : String(error)])
    }
  }
  const width = Math.max(...checks.map(([name]) => name.length))
  for (const [name, ok, detail] of checks) {
    process.stdout.write(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(width)}  ${detail}\n`)
  }
  return checks.every(([, ok]) => ok) ? 0 : 1
}

function makeClient(): ApiClient {
  const token = requireToken(process.env.TEAMPLANE_TOKEN)
  if (process.env.TEAMPLANE_URL) {
    return new ApiClient({ baseUrl: process.env.TEAMPLANE_URL, token, mandate: process.env.TEAMPLANE_MANDATE })
  }
  const root = findRoot()
  const config = readConfig(root)
  const join = readJoinConfig(root)
  const baseUrl = join?.server ?? `http://${config.host}:${config.port}`
  return new ApiClient({ baseUrl, token, mandate: process.env.TEAMPLANE_MANDATE })
}


