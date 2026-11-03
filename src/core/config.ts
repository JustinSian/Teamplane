import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import type { Policy, Principal, Role } from './types.js'
import type { JsonValue } from './util.js'
import { canonicalJson, fail, nowIso, parseJson, randomToken, sha256 } from './util.js'
import { defaultPolicy } from '../policy/engine.js'
import { EventLog } from '../store/eventlog.js'
import { MemoryVault } from '../store/memory.js'
import { generateKeys, loadKeys, saveKeys } from '../domain/mandate.js'
import type { KeyMaterial } from '../domain/mandate.js'
import { TeamplaneService } from '../domain/service.js'

export interface TeamplaneConfig {
  version: 1
  name: string
  host: string
  port: number
  repoPath: string | null
  keysDir?: string
  createdAt: string
}

export interface JoinConfig {
  version: 1
  server: string
  name: string
  joinedAt: string
}

export function stateDir(root: string): string {
  return join(root, '.teamplane')
}

export function findRoot(start = process.cwd()): string {
  let current = resolve(start)
  for (;;) {
    if (existsSync(join(current, '.teamplane', 'config.json'))) return current
    const parent = dirname(current)
    if (parent === current) fail('not_initialized', 'No .teamplane/config.json found. Run "teamplane init" first.', 422)
    current = parent
  }
}

export function readConfig(root: string): TeamplaneConfig {
  const path = join(stateDir(root), 'config.json')
  if (!existsSync(path)) fail('not_initialized', `No config at ${path}. Run "teamplane init" first.`, 422)
  return parseJson<TeamplaneConfig>(readFileSync(path, 'utf8'), 'config.json')
}

export function writeConfig(root: string, config: TeamplaneConfig): void {
  mkdirSync(stateDir(root), { recursive: true })
  writeFileSync(join(stateDir(root), 'config.json'), `${canonicalJson(config)}\n`, { mode: 0o600 })
}

export function readJoinConfig(root: string): JoinConfig | null {
  const path = join(stateDir(root), 'join.json')
  if (!existsSync(path)) return null
  return parseJson<JoinConfig>(readFileSync(path, 'utf8'), 'join.json')
}

export function writeJoinConfig(root: string, config: JoinConfig): void {
  mkdirSync(stateDir(root), { recursive: true })
  writeFileSync(join(stateDir(root), 'join.json'), `${canonicalJson(config)}\n`, { mode: 0o600 })
}

export interface InitOptions {
  root: string
  name: string
  owner: string
  host?: string
  port?: number
  force?: boolean
  keysDir?: string
}

/** Signing keys live outside the workspace by default. */
export function defaultKeysDir(root: string): string {
  const id = sha256(resolve(root)).slice(0, 16)
  return join(homedir(), '.teamplane', 'keys', id)
}

export interface InitResult {
  root: string
  config: TeamplaneConfig
  principal: Principal
  token: string
  ownerRole: Role
}

export function initProject(options: InitOptions): InitResult {
  const root = resolve(options.root)
  const dir = stateDir(root)
  if (existsSync(join(dir, 'config.json')) && !options.force) {
    fail('already_initialized', `${root} is already a Teamplane workspace.`, 409)
  }
  mkdirSync(dir, { recursive: true })

  const keys = generateKeys()
  const keysDir = options.keysDir ?? process.env.TEAMPLANE_KEYS_DIR ?? defaultKeysDir(root)
  saveKeys(keysDir, keys)

  const config: TeamplaneConfig = {
    version: 1,
    name: options.name,
    host: options.host ?? '127.0.0.1',
    port: options.port ?? 7317,
    repoPath: root,
    keysDir,
    createdAt: nowIso(),
  }
  writeConfig(root, config)

  const policy = defaultPolicy()
  writeFileSync(join(dir, 'policy.json'), `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o644 })

  const log = EventLog.open(dir)
  try {
    log.append('policy.updated', 'system', policy as unknown as JsonValue)
    const token = randomToken('tp')
    const principal: Principal = {
      id: `usr_${sha256(`${root}:${options.owner}:${Date.now()}`).slice(0, 16)}`,
      kind: 'user',
      display: options.owner,
      tokenHash: sha256(token),
      createdAt: nowIso(),
      disabled: false,
    }
    log.append('principal.created', 'system', principal as unknown as JsonValue)
    log.append('role.granted', 'system', { principalId: principal.id, role: 'owner', at: nowIso() })
    log.writeSnapshot()
    return { root, config, principal, token, ownerRole: 'owner' }
  } finally {
    log.close()
  }
}

export interface LoadedWorkspace {
  root: string
  config: TeamplaneConfig
  keys: KeyMaterial
  log: EventLog
  service: TeamplaneService
}

export function loadWorkspace(rootOrCwd = process.cwd(), publicUrl?: string): LoadedWorkspace {
  const root = findRoot(rootOrCwd)
  const config = readConfig(root)
  const keys = loadKeys(config.keysDir ?? join(stateDir(root), 'keys'))
  const log = EventLog.open(stateDir(root))
  new MemoryVault(stateDir(root)).hydrate(log.state)
  const allowedRepoRoots = process.env.TEAMPLANE_REPO_ROOTS
    ? process.env.TEAMPLANE_REPO_ROOTS.split(delimiter).map((path) => path.trim()).filter(Boolean)
    : undefined
  const service = new TeamplaneService(log, keys, {
    repoPath: config.repoPath ?? root,
    publicUrl: publicUrl ?? `http://${config.host}:${config.port}`,
    allowedRepoRoots,
  })
  return { root, config, keys, log, service }
}

export function readPolicyFile(rootOrPath: string): Policy {
  const path = rootOrPath.endsWith('.json') ? rootOrPath : join(stateDir(rootOrPath), 'policy.json')
  if (!existsSync(path)) fail('policy_missing', `No policy file at ${path}`, 422)
  return parseJson<Policy>(readFileSync(path, 'utf8'), path)
}

export function writePolicyFile(root: string, policy: Policy): void {
  writeFileSync(join(stateDir(root), 'policy.json'), `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o644 })
}
