import { spawnSync } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  Approval,
  AuthenticatedPrincipal,
  AuthorizeResult,
  Launch,
  Lease,
  LeaseMode,
  MandateClaims,
  MandateRecord,
  MandateScope,
  MemoryFragment,
  MemoryKind,
  Obligations,
  Policy,
  Principal,
  PrincipalKind,
  Role,
  Task,
  Visibility,
} from '../core/types.js'
import { MEMORY_KINDS, PRINCIPAL_KINDS, ROLES } from '../core/types.js'
import type { JsonValue } from '../core/util.js'
import {
  addSeconds,
  canonicalJson,
  fail,
  hashObject,
  id,
  isExpired,
  normalizePath,
  nowIso,
  parseDuration,
  randomToken,
  sha256,
  unique,
  withinPath,
} from '../core/util.js'
import { decide, mandateAllows, validatePolicy } from '../policy/engine.js'
import type { KeyMaterial } from './mandate.js'
import { deriveClaims, signMandate, verifyMandate } from './mandate.js'
import type { EventLog } from '../store/eventlog.js'
import { activeLeases } from '../store/eventlog.js'

export interface ServiceOptions {
  repoPath?: string
  publicUrl?: string
  now?: () => string
}

export interface CreatePrincipalInput {
  kind: PrincipalKind
  display: string
  roles?: Role[]
}

export interface IssueMandateInput {
  subject: string
  task: string
  paths: string[]
  actions?: string[]
  branches?: string[]
  memory?: string[]
  ttlSeconds?: number
  maxWrites?: number
}

export interface SubmitInput {
  verify?: string[]
  merge?: boolean
  requireLease?: boolean
  timeoutMs?: number
}

export interface SubmitResult {
  ok: boolean
  taskId: string
  changedFiles: string[]
  conflicts: string[]
  verify: Array<{ command: string; ok: boolean; code: number | null; output: string }>
  merged: boolean
  reason: string
}

export interface MemoryInput {
  kind: MemoryKind
  topic: string
  text: string
  visibility?: Visibility
  namespace: string
  provenance?: { task?: string | null; files?: string[]; events?: string[]; source?: string }
  supersedes?: string | null
}

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'aws_access_key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'github_token', regex: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'openai_key', regex: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'private_key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'bearer_token', regex: /Bearer\s+[A-Za-z0-9._-]{20,}/ },
  { name: 'password_assignment', regex: /(?:password|passwd|secret)\s*[:=]\s*['"][^'"]{8,}['"]/i },
]

export class TeamplaneService {
  readonly log: EventLog
  readonly keys: KeyMaterial
  readonly options: ServiceOptions

  constructor(log: EventLog, keys: KeyMaterial, options: ServiceOptions = {}) {
    this.log = log
    this.keys = keys
    this.options = options
  }

  get state() {
    return this.log.state
  }

  now(): string {
    return this.options.now?.() ?? nowIso()
  }

  // ---------------------------------------------------------------- identity

  authenticate(token: string | undefined): AuthenticatedPrincipal {
    if (!token) fail('missing_token', 'Authorization: Bearer <principal token> is required.', 401)
    const hash = Buffer.from(sha256(token), 'hex')
    for (const principal of this.state.principals.values()) {
      const stored = Buffer.from(principal.tokenHash, 'hex')
      if (stored.length === hash.length && timingSafeEqual(stored, hash)) {
        if (principal.disabled) fail('principal_disabled', `Principal ${principal.id} is disabled.`, 403)
        return { principal, roles: this.rolesOf(principal.id) }
      }
    }
    fail('invalid_token', 'Unknown principal token.', 401)
  }

  rolesOf(principalId: string): Role[] {
    return [...(this.state.roles.get(principalId) ?? [])]
  }

  publicPrincipal(principal: Principal): Omit<Principal, 'tokenHash'> {
    const { tokenHash: _tokenHash, ...rest } = principal
    return rest
  }

  createPrincipal(actor: AuthenticatedPrincipal, input: CreatePrincipalInput): { principal: Principal; token: string } {
    this.authorizeOrThrow(actor, 'principal.create', 'principal:*')
    if (!PRINCIPAL_KINDS.includes(input.kind)) fail('invalid_principal_kind', `Unknown principal kind ${input.kind}`, 422)
    if (!input.display || input.display.trim() === '') fail('invalid_display', 'display is required', 422)
    const roles = input.roles ?? ['agent']
    for (const role of roles) {
      if (!ROLES.includes(role)) fail('invalid_role', `Unknown role ${role}`, 422)
      if (role === 'owner' && !actor.roles.includes('owner')) fail('forbidden', 'Only an owner can create another owner.', 403)
    }
    const token = randomToken('tp')
    const principal: Principal = {
      id: id('usr'),
      kind: input.kind,
      display: input.display,
      tokenHash: sha256(token),
      createdAt: this.now(),
      disabled: false,
    }
    this.log.append('principal.created', actor.principal.id, principal as unknown as JsonValue)
    for (const role of unique(roles)) {
      this.log.append('role.granted', actor.principal.id, { principalId: principal.id, role, at: this.now() })
    }
    return { principal, token }
  }

  disablePrincipal(actor: AuthenticatedPrincipal, principalId: string, reason = ''): void {
    this.authorizeOrThrow(actor, 'principal.disable', 'principal:*')
    const principal = this.state.principals.get(principalId)
    if (!principal) fail('principal_not_found', `No principal ${principalId}`, 404)
    if (principal.id === actor.principal.id) fail('self_disable', 'You cannot disable your own principal.', 409)
    if (principal.disabled) return
    this.log.append('principal.disabled', actor.principal.id, { principalId, at: this.now(), reason })
  }

  grantRole(actor: AuthenticatedPrincipal, principalId: string, role: Role): void {
    this.authorizeOrThrow(actor, 'role.grant', 'policy')
    if (!ROLES.includes(role)) fail('invalid_role', `Unknown role ${role}`, 422)
    if (!this.state.principals.has(principalId)) fail('principal_not_found', `No principal ${principalId}`, 404)
    if (role === 'owner' && !actor.roles.includes('owner')) fail('forbidden', 'Only an owner can grant owner.', 403)
    if (this.rolesOf(principalId).includes(role)) return
    this.log.append('role.granted', actor.principal.id, { principalId, role, at: this.now() })
  }

  // ------------------------------------------------------------------ policy

  updatePolicy(actor: AuthenticatedPrincipal, policy: Policy): Policy {
    this.authorizeOrThrow(actor, 'policy.write', 'policy')
    const errors = validatePolicy(policy)
    if (errors.length > 0) fail('invalid_policy', errors.join('; '), 422, errors)
    const next: Policy = {
      ...policy,
      version: this.state.policy.version + 1,
      updatedAt: this.now(),
      updatedBy: actor.principal.id,
    }
    this.log.append('policy.updated', actor.principal.id, next as unknown as JsonValue)
    return next
  }

  // ----------------------------------------------------------------- mandate

  issueMandate(actor: AuthenticatedPrincipal, input: IssueMandateInput): { record: MandateRecord; token: string } {
    const task = this.state.tasks.get(input.task)
    if (!task) fail('task_not_found', `No task ${input.task}`, 404)
    this.authorizeOrThrow(actor, 'mandate.issue', `task:${task.id}`)
    if (!this.state.principals.has(input.subject)) fail('principal_not_found', `No principal ${input.subject}`, 404)

    const paths = unique(input.paths.map(normalizePath))
    if (paths.length === 0 || paths.some((path) => path === '')) {
      fail('invalid_mandate_path', 'Mandate paths must name files or directories; "." and "/" are not allowed.', 422)
    }
    const ttl = Math.max(60, Math.min(input.ttlSeconds ?? 3600, 7 * 86400))
    const issuedAt = this.now()
    const claims: MandateClaims = {
      v: 1,
      id: id('mnd'),
      issuer: actor.principal.id,
      subject: input.subject,
      task: task.id,
      scope: {
        paths,
        actions: unique(input.actions ?? ['fs.read', 'fs.write', 'lease.acquire', 'memory.read', 'memory.write', 'task.submit', 'git.push']),
        branches: unique(input.branches ?? [task.branch, task.baseBranch]),
        memory: unique(input.memory ?? ['team']),
      },
      limits: { maxWrites: input.maxWrites ?? 1000, expiresAt: addSeconds(issuedAt, ttl) },
      policyVersion: this.state.policy.version,
      iat: issuedAt,
      exp: addSeconds(issuedAt, ttl),
      nonce: sha256(`${issuedAt}:${task.id}:${input.subject}`).slice(0, 24),
    }
    if (claims.scope.paths.length === 0) fail('invalid_mandate', 'A mandate needs at least one path.', 422)
    const token = signMandate(claims, this.keys)
    const record: MandateRecord = {
      id: claims.id,
      claims,
      token,
      parentId: null,
      createdAt: issuedAt,
      revokedAt: null,
    }
    this.log.append('mandate.issued', actor.principal.id, record as unknown as JsonValue)
    return { record, token }
  }

  deriveMandate(
    actor: AuthenticatedPrincipal,
    parentId: string,
    options: { subject?: string; paths?: string[]; actions?: string[]; branches?: string[]; memory?: string[]; ttlSeconds?: number; maxWrites?: number },
  ): { record: MandateRecord; token: string } {
    const parent = this.state.mandates.get(parentId)
    if (!parent) fail('mandate_not_found', `No mandate ${parentId}`, 404)
    if (parent.revokedAt) fail('mandate_revoked', `Mandate ${parentId} is revoked.`, 403)
    this.authorizeOrThrow(actor, 'mandate.issue', `task:${parent.claims.task}`)
    if (parent.claims.exp <= this.now()) fail('mandate_expired', `Mandate ${parentId} has expired.`, 403)
    const claims = deriveClaims(parent.claims, options, this.now())
    const token = signMandate(claims, this.keys)
    const record: MandateRecord = {
      id: claims.id,
      claims,
      token,
      parentId,
      createdAt: this.now(),
      revokedAt: null,
    }
    this.log.append('mandate.issued', actor.principal.id, record as unknown as JsonValue)
    return { record, token }
  }

  revokeMandate(actor: AuthenticatedPrincipal, mandateId: string, reason = ''): void {
    const mandate = this.state.mandates.get(mandateId)
    if (!mandate) fail('mandate_not_found', `No mandate ${mandateId}`, 404)
    if (mandate.revokedAt) return
    this.authorizeOrThrow(actor, 'mandate.revoke', `task:${mandate.claims.task}`)
    this.log.append('mandate.revoked', actor.principal.id, { id: mandateId, at: this.now(), reason })
  }

  resolveMandate(token: string | undefined, actor: AuthenticatedPrincipal): MandateClaims | undefined {
    if (!token) return undefined
    const claims = verifyMandate(token, this.keys.publicKeyPem, this.now())
    const record = this.state.mandates.get(claims.id)
    if (!record) fail('mandate_unknown', `Mandate ${claims.id} was not issued by this control plane.`, 403)
    if (record.revokedAt) fail('mandate_revoked', `Mandate ${claims.id} is revoked.`, 403)
    if (claims.subject !== actor.principal.id) {
      fail('mandate_subject_mismatch', `Mandate ${claims.id} belongs to ${claims.subject}, not ${actor.principal.id}.`, 403)
    }
    return claims
  }

  // -------------------------------------------------------------------- task

  createTask(
    actor: AuthenticatedPrincipal,
    input: { title: string; repoPath?: string; baseBranch?: string; assignee?: string | null; verify?: string[] },
  ): Task {
    this.authorizeOrThrow(actor, 'task.create', 'task:*')
    if (!input.title || input.title.trim() === '') fail('invalid_title', 'title is required', 422)
    const repoPath = input.repoPath ?? this.options.repoPath
    if (!repoPath) fail('repo_required', 'A repository path is required (--repo).', 422)
    const verify = this.normalizeVerify(input.verify ?? [])
    const taskId = id('tsk')
    const task: Task = {
      id: taskId,
      title: input.title,
      requester: actor.principal.id,
      assignee: input.assignee ?? null,
      repoPath,
      baseBranch: input.baseBranch ?? 'main',
      branch: `tp/${taskId}`,
      worktree: null,
      mandateId: null,
      verify,
      status: 'open',
      createdAt: this.now(),
      updatedAt: this.now(),
    }
    this.log.append('task.created', actor.principal.id, task as unknown as JsonValue)
    return task
  }

  setTaskVerify(actor: AuthenticatedPrincipal, taskId: string, verify: string[]): Task {
    const task = this.state.tasks.get(taskId)
    if (!task) fail('task_not_found', `No task ${taskId}`, 404)
    this.authorizeOrThrow(actor, 'task.verify', `task:${taskId}`)
    const commands = this.normalizeVerify(verify)
    this.log.append('task.verify', actor.principal.id, { taskId, verify: commands, at: this.now() })
    return this.state.tasks.get(taskId)!
  }

  private normalizeVerify(commands: string[]): string[] {
    if (commands.length > 10) fail('too_many_verify_commands', 'At most 10 verification commands are allowed.', 422)
    return commands.map((command) => {
      const trimmed = String(command).trim()
      if (trimmed === '') fail('invalid_verify_command', 'Verification commands must not be empty.', 422)
      if (trimmed.length > 500) fail('invalid_verify_command', 'A verification command must be 500 characters or fewer.', 422)
      return trimmed
    })
  }

  startTask(actor: AuthenticatedPrincipal, taskId: string, mandateId?: string): Task {
    const task = this.state.tasks.get(taskId)
    if (!task) fail('task_not_found', `No task ${taskId}`, 404)
    this.authorizeOrThrow(actor, 'task.start', `task:${taskId}`)
    if (!existsSync(task.repoPath)) fail('repo_not_found', `Repository ${task.repoPath} does not exist.`, 422)

    const worktree = join(dirname(task.repoPath), '.teamplane-worktrees', task.id)
    mkdirSync(dirname(worktree), { recursive: true })
    if (!existsSync(worktree)) {
      const branchExists = this.git(task.repoPath, ['rev-parse', '--verify', '--quiet', task.branch]).code === 0
      const args = branchExists
        ? ['worktree', 'add', worktree, task.branch]
        : ['worktree', 'add', '-b', task.branch, worktree, task.baseBranch]
      const result = this.git(task.repoPath, args)
      if (result.code !== 0) fail('worktree_failed', `git ${args.join(' ')} failed: ${result.stderr.trim()}`, 500)
    }

    const record = mandateId ? this.state.mandates.get(mandateId) : undefined
    const context = {
      version: 1,
      server: this.options.publicUrl ?? null,
      taskId: task.id,
      branch: task.branch,
      baseBranch: task.baseBranch,
      mandateId: record?.id ?? null,
      mandate: record?.token ?? null,
      paths: record?.claims.scope.paths ?? [],
      actions: record?.claims.scope.actions ?? [],
      branches: record?.claims.scope.branches ?? [],
      generatedAt: this.now(),
    }
    mkdirSync(join(worktree, '.teamplane'), { recursive: true })
    writeFileSync(join(worktree, '.teamplane', 'context.json'), `${canonicalJson(context)}\n`)

    this.log.append('task.started', actor.principal.id, {
      taskId,
      worktree,
      branch: task.branch,
      at: this.now(),
      mandateId: record?.id ?? null,
    })
    return this.state.tasks.get(taskId) ?? task
  }

  recordLaunch(actor: AuthenticatedPrincipal, taskId: string, input: { command: string; pid?: number | null }): Launch {
    const task = this.state.tasks.get(taskId)
    if (!task) fail('task_not_found', `No task ${taskId}`, 404)
    this.authorizeOrThrow(actor, 'task.launch', `task:${taskId}`)
    if (!task.worktree) fail('task_not_started', `Task ${taskId} has no worktree; run "task start" first.`, 409)
    if (!input.command || input.command.trim() === '') fail('invalid_command', 'command is required', 422)
    const launch: Launch = {
      id: id('lnc'),
      task: taskId,
      command: input.command.slice(0, 500),
      pid: input.pid ?? null,
      actor: actor.principal.id,
      startedAt: this.now(),
    }
    this.log.append('task.launched', actor.principal.id, launch as unknown as JsonValue)
    return launch
  }

  launchesFor(taskId: string): Launch[] {
    return [...this.state.launches.values()].filter((launch) => launch.task === taskId)
  }

  // ------------------------------------------------------------------- lease

  acquireLease(
    actor: AuthenticatedPrincipal,
    input: { key: string; mode?: LeaseMode; task: string; ttlSeconds?: number; mandate?: MandateClaims },
  ): Lease {
    const key = this.normalizeLeaseKey(input.key)
    this.authorizeOrThrow(actor, 'lease.acquire', key, {}, input.mandate)
    const task = this.state.tasks.get(input.task)
    if (!task) fail('task_not_found', `No task ${input.task}`, 404)
    const mode = input.mode ?? 'exclusive'
    const now = this.now()
    const conflicts = activeLeases(this.state, now).filter((lease) => leasesConflict(lease, key, mode))
    if (conflicts.length > 0) {
      this.log.append('lease.denied', actor.principal.id, {
        key,
        mode,
        task: input.task,
        holders: conflicts.map((lease) => ({ id: lease.id, holder: lease.holder, expiresAt: lease.expiresAt })),
        at: now,
      })
      fail(
        'lease_conflict',
        `Resource ${key} is held by ${conflicts[0]!.holder} until ${conflicts[0]!.expiresAt}.`,
        409,
        conflicts.map((lease) => ({ id: lease.id, holder: lease.holder, expiresAt: lease.expiresAt, mode: lease.mode })),
      )
    }
    const ttl = Math.max(30, Math.min(input.ttlSeconds ?? 900, 7200))
    const fencing = (this.state.fencing.get(key) ?? 0) + 1
    const lease: Lease = {
      id: id('les'),
      key,
      mode,
      holder: input.mandate?.id ?? actor.principal.id,
      task: input.task,
      fencing,
      acquiredAt: now,
      renewedAt: now,
      expiresAt: addSeconds(now, ttl),
      endedAt: null,
      endedReason: null,
    }
    this.log.append('lease.acquired', actor.principal.id, lease as unknown as JsonValue)
    return lease
  }

  renewLease(actor: AuthenticatedPrincipal, leaseId: string, ttlSeconds = 900, mandate?: MandateClaims): Lease {
    const lease = this.state.leases.get(leaseId)
    if (!lease) fail('lease_not_found', `No lease ${leaseId}`, 404)
    if (lease.endedAt) fail('lease_ended', `Lease ${leaseId} already ended.`, 409)
    if (!this.holdsLease(actor, lease, mandate)) {
      fail('forbidden', 'Only the holder may renew this lease.', 403)
    }
    const now = this.now()
    if (lease.expiresAt <= now) fail('lease_expired', `Lease ${leaseId} has expired.`, 410)
    const ttl = Math.max(30, Math.min(ttlSeconds, 7200))
    this.log.append('lease.renewed', actor.principal.id, { id: leaseId, renewedAt: now, expiresAt: addSeconds(now, ttl) })
    return this.state.leases.get(leaseId)!
  }

  releaseLease(actor: AuthenticatedPrincipal, leaseId: string, reason = 'released', mandate?: MandateClaims): void {
    const lease = this.state.leases.get(leaseId)
    if (!lease) fail('lease_not_found', `No lease ${leaseId}`, 404)
    if (lease.endedAt) return
    if (!this.holdsLease(actor, lease, mandate)) {
      fail('forbidden', 'Only the holder may release this lease.', 403)
    }
    this.log.append('lease.released', actor.principal.id, { id: leaseId, at: this.now(), reason: 'released' })
  }

  expireLeases(): Lease[] {
    const now = this.now()
    const expired: Lease[] = []
    for (const lease of this.state.leases.values()) {
      if (lease.endedAt === null && lease.expiresAt <= now) {
        this.log.append('lease.expired', 'system', { id: lease.id, at: now, reason: 'expired' })
        expired.push(lease)
      }
    }
    return expired
  }

  // ------------------------------------------------------------------ memory

  writeMemory(actor: AuthenticatedPrincipal, input: MemoryInput, mandate?: MandateClaims): MemoryFragment {
    if (!MEMORY_KINDS.includes(input.kind)) fail('invalid_memory_kind', `Unknown memory kind ${input.kind}`, 422)
    if (!input.topic || input.topic.trim() === '') fail('invalid_topic', 'topic is required', 422)
    if (!input.text || input.text.trim() === '') fail('invalid_text', 'text is required', 422)
    if (Buffer.byteLength(input.text, 'utf8') > 4096) fail('memory_too_large', 'Memory text exceeds 4096 bytes.', 422)
    const namespace = input.namespace || 'team'
    this.authorizeOrThrow(actor, 'memory.write', `memory:${namespace}`, {}, mandate)

    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(input.text)) {
        fail('secret_detected', `Memory text looks like it contains a secret (${pattern.name}); redact it first.`, 422)
      }
    }

    const visibility = input.visibility ?? 'team'
    this.assertVisibility(visibility)
    const fragment: MemoryFragment = {
      id: id('mem'),
      owner: actor.principal.id,
      kind: input.kind,
      topic: input.topic.trim(),
      text: input.text.trim(),
      visibility,
      provenance: {
        task: input.provenance?.task ?? mandate?.task ?? null,
        files: (input.provenance?.files ?? []).map(normalizePath),
        events: input.provenance?.events ?? [],
        source: input.provenance?.source ?? 'api',
      },
      createdAt: this.now(),
      supersedes: input.supersedes ?? null,
    }
    this.log.append('memory.written', actor.principal.id, fragment as unknown as JsonValue)

    for (const existing of this.state.memory.values()) {
      if (existing.id === fragment.id) continue
      if (existing.topic !== fragment.topic) continue
      if (existing.text === fragment.text) continue
      if (existing.supersedes === fragment.id || fragment.supersedes === existing.id) continue
      this.log.append('memory.conflict', actor.principal.id, {
        topic: fragment.topic,
        left: existing.id,
        right: fragment.id,
        at: this.now(),
      })
    }
    return fragment
  }

  searchMemory(
    actor: AuthenticatedPrincipal,
    query: string,
    options: { namespace?: string; kind?: MemoryKind; limit?: number } = {},
  ): Array<MemoryFragment & { score: number; why: string }> {
    const terms = tokenize(query)
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100))
    const now = Date.now()
    const results: Array<MemoryFragment & { score: number; why: string }> = []
    for (const fragment of this.state.memory.values()) {
      if (!this.canRead(actor, fragment)) continue
      if (options.kind && fragment.kind !== options.kind) continue
      if (options.namespace && !withinPath(options.namespace, fragment.provenance.source)) {
        // namespace filtering is best-effort for v0.1; provenance.source carries it
      }
      const haystack = `${fragment.topic} ${fragment.text}`.toLowerCase()
      const hits = terms.filter((term) => haystack.includes(term))
      if (terms.length > 0 && hits.length === 0) continue
      const ageDays = (now - new Date(fragment.createdAt).getTime()) / 86_400_000
      const recency = 1 / (1 + Math.max(0, ageDays) / 30)
      const score = terms.length === 0 ? recency : (hits.length / terms.length) * 0.85 + recency * 0.15
      results.push({
        ...fragment,
        score: Number(score.toFixed(4)),
        why: terms.length === 0 ? 'recent' : `matched ${hits.join(', ')}`,
      })
    }
    results.sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt))
    return results.slice(0, limit)
  }

  canRead(actor: AuthenticatedPrincipal, fragment: MemoryFragment): boolean {
    if (fragment.owner === actor.principal.id) return true
    if (fragment.visibility === 'team') return true
    if (fragment.visibility === 'private') return false
    if (fragment.visibility.startsWith('role:')) {
      return actor.roles.includes(fragment.visibility.slice('role:'.length) as Role)
    }
    return false
  }

  memoryConflicts(): Array<{ topic: string; left: string; right: string; at: string }> {
    const out: Array<{ topic: string; left: string; right: string; at: string }> = []
    for (const event of this.log.events()) {
      if (event.type !== 'memory.conflict') continue
      const data = event.data as { topic: string; left: string; right: string; at: string }
      out.push(data)
    }
    return out
  }

  private assertVisibility(visibility: string): asserts visibility is Visibility {
    if (visibility === 'private' || visibility === 'team') return
    if (visibility.startsWith('role:')) {
      const role = visibility.slice('role:'.length)
      if (!ROLES.includes(role as Role)) fail('invalid_visibility', `Unknown role in visibility: ${role}`, 422)
      return
    }
    fail('invalid_visibility', `Unknown visibility ${visibility}`, 422)
  }

  // ---------------------------------------------------------------- approval

  requestApproval(
    actor: AuthenticatedPrincipal,
    input: { action: string; resource: string; mandateId?: string | null; ttlSeconds?: number; fields?: Record<string, unknown> },
  ): Approval {
    const now = this.now()
    const decision = decide(this.state.policy, {
      actor,
      action: input.action,
      resource: input.resource,
      fields: input.fields ?? {},
    })
    if (decision.decision !== 'ask') {
      fail('approval_not_required', `Policy does not require approval for ${input.action} on ${input.resource}.`, 422, {
        decision: decision.decision,
        ruleId: decision.ruleId,
      })
    }
    const requiredRole = decision.obligations.approvalRole ?? 'owner'
    if (!ROLES.includes(requiredRole)) fail('invalid_role', `Unknown role ${requiredRole}`, 422)
    const approval: Approval = {
      id: id('apr'),
      action: input.action,
      resource: input.resource,
      actionHash: approvalHash(input.action, input.resource, input.mandateId ?? null),
      requestedBy: actor.principal.id,
      requiredRole,
      mandateId: input.mandateId ?? null,
      status: 'pending',
      createdAt: now,
      expiresAt: addSeconds(now, Math.max(60, Math.min(input.ttlSeconds ?? 1800, 86400))),
      resolvedBy: null,
      resolvedAt: null,
      reason: null,
    }
    this.log.append('approval.requested', actor.principal.id, approval as unknown as JsonValue)
    return approval
  }

  resolveApproval(actor: AuthenticatedPrincipal, approvalId: string, approve: boolean, reason = ''): Approval {
    const approval = this.state.approvals.get(approvalId)
    if (!approval) fail('approval_not_found', `No approval ${approvalId}`, 404)
    if (approval.status !== 'pending') fail('approval_not_pending', `Approval ${approvalId} is ${approval.status}.`, 409)
    if (isExpired(approval.expiresAt, this.now())) {
      this.log.append('approval.resolved', 'system', { id: approvalId, status: 'expired', resolvedBy: 'system', resolvedAt: this.now(), reason: 'expired' })
      fail('approval_expired', `Approval ${approvalId} has expired.`, 410)
    }
    if (!actor.roles.includes(approval.requiredRole) && !actor.roles.includes('owner')) {
      fail('forbidden', `Approval ${approvalId} requires role ${approval.requiredRole}.`, 403)
    }
    if (approval.requestedBy === actor.principal.id) {
      fail('self_approval', 'A requester cannot approve their own action.', 403)
    }
    this.log.append('approval.resolved', actor.principal.id, {
      id: approvalId,
      status: approve ? 'approved' : 'rejected',
      resolvedBy: actor.principal.id,
      resolvedAt: this.now(),
      reason: reason || null,
    })
    return this.state.approvals.get(approvalId)!
  }

  private approvalValid(approvalId: string | undefined, action: string, resource: string, mandateId: string | null): Approval | null {
    if (!approvalId) return null
    const approval = this.state.approvals.get(approvalId)
    if (!approval) return null
    if (approval.status !== 'approved') return null
    if (isExpired(approval.expiresAt, this.now())) return null
    if (approval.actionHash !== approvalHash(action, resource, mandateId)) return null
    if ((approval.mandateId ?? null) !== mandateId) return null
    return approval
  }

  private useApproval(
    actor: AuthenticatedPrincipal,
    approval: Approval,
    action: string,
    resource: string,
    mandateId: string | null,
    consume: boolean,
  ): string {
    if (consume) this.consumeApproval(actor, approval.id, action, resource, mandateId)
    return approval.resolvedBy ?? 'an approver'
  }

  consumeApproval(actor: AuthenticatedPrincipal, approvalId: string, action: string, resource: string, mandateId: string | null): void {
    const approval = this.approvalValid(approvalId, action, resource, mandateId)
    if (!approval) fail('approval_invalid', 'Approval is missing, expired or bound to a different action.', 403)
    this.log.append('approval.consumed', actor.principal.id, { id: approvalId, at: this.now() })
  }

  // -------------------------------------------------------------- authorize

  authorize(
    actor: AuthenticatedPrincipal,
    action: string,
    resource: string,
    fields: Record<string, unknown> = {},
    mandate?: MandateClaims,
    approvalId?: string,
    consumeApproval = false,
  ): AuthorizeResult {
    const decision = decide(this.state.policy, { actor, action, resource, fields })
    const obligations: Obligations = decision.obligations
    let result: AuthorizeResult = {
      decision: decision.decision,
      ruleId: decision.ruleId,
      reason: decision.reason,
      policyVersion: decision.policyVersion,
      obligations,
      mandateOk: true,
    }

    if (decision.decision === 'allow') {
      if (obligations.requireMandate && !mandate) {
        return { ...result, decision: 'deny', reason: 'This action requires a signed mandate (X-Teamplane-Mandate).', mandateOk: false }
      }
      if (mandate) {
        const check = mandateAllows(mandate, action, resource)
        if (!check.ok) return { ...result, decision: 'deny', reason: check.reason, mandateOk: false }
      }
      if (obligations.requireLease && action === 'fs.write') {
        if (!mandate) return { ...result, decision: 'deny', reason: 'Writing requires a mandate so a lease can be checked.', mandateOk: false }
        if (!this.hasLeaseFor(mandate, resource)) {
          return { ...result, decision: 'deny', reason: `No active lease covers ${resource} for mandate ${mandate.id}.`, mandateOk: true }
        }
      }
      if (obligations.requireApproval) {
        const approval = this.approvalValid(approvalId, action, resource, mandate?.id ?? null)
        if (!approval) {
          return { ...result, decision: 'ask', reason: 'This action requires a human approval (approvalId).' }
        }
        const approver = this.useApproval(actor, approval, action, resource, mandate?.id ?? null, consumeApproval)
        result = { ...result, reason: `Approved by ${approver}.` }
      }
    }

    if (decision.decision === 'ask') {
      const approval = this.approvalValid(approvalId, action, resource, mandate?.id ?? null)
      if (approval) {
        if (obligations.requireMandate && !mandate) {
          return { ...result, decision: 'deny', reason: 'This action requires a signed mandate (X-Teamplane-Mandate).', mandateOk: false }
        }
        if (mandate) {
          const check = mandateAllows(mandate, action, resource)
          if (!check.ok) return { ...result, decision: 'deny', reason: check.reason, mandateOk: false }
        }
        const approver = this.useApproval(actor, approval, action, resource, mandate?.id ?? null, consumeApproval)
        result = { ...result, decision: 'allow', reason: `Approved by ${approver}.` }
      }
    }

    if (result.decision === 'deny' && !action.endsWith('.read')) {
      this.log.append('decision.denied', actor.principal.id, {
        action,
        resource,
        ruleId: result.ruleId,
        reason: result.reason,
        mandateId: mandate?.id ?? null,
        at: this.now(),
      })
    }
    return result
  }

  authorizeOrThrow(
    actor: AuthenticatedPrincipal,
    action: string,
    resource: string,
    fields: Record<string, unknown> = {},
    mandate?: MandateClaims,
    approvalId?: string,
  ): AuthorizeResult {
    const result = this.authorize(actor, action, resource, fields, mandate, approvalId, true)
    if (result.decision !== 'allow') {
      fail(result.decision === 'ask' ? 'approval_required' : 'forbidden', result.reason, result.decision === 'ask' ? 428 : 403, {
        ruleId: result.ruleId,
        policyVersion: result.policyVersion,
        obligations: result.obligations as unknown as JsonValue,
      })
    }
    return result
  }

  private hasLeaseFor(mandate: MandateClaims, resource: string): boolean {
    const path = resource.startsWith('file:') ? normalizePath(resource.slice('file:'.length)) : null
    if (path === null) return true
    return activeLeases(this.state, this.now()).some((lease) => {
      if (lease.holder !== mandate.id) return false
      if (lease.key === `file:${path}`) return true
      if (lease.key.startsWith('dir:')) {
        return withinPath(lease.key.slice('dir:'.length), path)
      }
      return false
    })
  }

  // ------------------------------------------------------------------ submit

  private eventResult(result: SubmitResult): SubmitResult {
    return {
      ...result,
      verify: result.verify.map(({ command, ok, code }) => ({ command, ok, code, output: '' })),
    }
  }

  submit(actor: AuthenticatedPrincipal, taskId: string, input: SubmitInput, mandate?: MandateClaims): SubmitResult {
    const task = this.state.tasks.get(taskId)
    if (!task) fail('task_not_found', `No task ${taskId}`, 404)
    this.authorizeOrThrow(actor, 'task.submit', `task:${taskId}`, {}, mandate)
    if (task.status === 'merged') fail('task_already_merged', `Task ${taskId} is already merged.`, 409)

    const changed = this.changedFiles(task)
    const requireLease = input.requireLease ?? true
    const uncovered: string[] = []
    if (requireLease) {
      for (const file of changed) {
        const covered = activeLeases(this.state, this.now()).some(
          (lease) => lease.task === task.id && (lease.key === `file:${file}` || (lease.key.startsWith('dir:') && withinPath(lease.key.slice(4), file))),
        )
        if (!covered) uncovered.push(file)
      }
    }
    if (uncovered.length > 0) {
      const result: SubmitResult = {
        ok: false,
        taskId,
        changedFiles: changed,
        conflicts: [],
        verify: [],
        merged: false,
        reason: `No active lease covers: ${uncovered.join(', ')}`,
      }
      this.log.append('submit.rejected', actor.principal.id, { ...this.eventResult(result), at: this.now() })
      return result
    }

    const mergeTree = this.git(task.repoPath, ['merge-tree', '--write-tree', '--name-only', task.baseBranch, task.branch])
    const conflicts = mergeTree.code === 0 ? [] : parseMergeTreeConflicts(mergeTree.stdout)
    if (conflicts.length > 0) {
      const result: SubmitResult = {
        ok: false,
        taskId,
        changedFiles: changed,
        conflicts,
        verify: [],
        merged: false,
        reason: `git merge-tree reports conflicts: ${conflicts.join(', ')}`,
      }
      this.log.append('submit.rejected', actor.principal.id, { ...this.eventResult(result), at: this.now() })
      return result
    }

    if (input.verify && input.verify.length > 0) {
      fail('verify_task_bound', 'Verification commands are bound to the task; set them at task creation or with task.verify.', 422)
    }
    const verify = task.verify ?? []
    const verifyResults: SubmitResult['verify'] = []
    for (const command of verify) {
      const run = spawnSync(command, {
        cwd: task.worktree ?? task.repoPath,
        shell: true,
        encoding: 'utf8',
        timeout: input.timeoutMs ?? 120_000,
      })
      verifyResults.push({
        command,
        ok: run.status === 0,
        code: run.status,
        output: `${run.stdout ?? ''}${run.stderr ?? ''}`.slice(-4000),
      })
      if (run.status !== 0) break
    }
    const verifyOk = verifyResults.every((entry) => entry.ok)
    if (!verifyOk) {
      const result: SubmitResult = {
        ok: false,
        taskId,
        changedFiles: changed,
        conflicts: [],
        verify: verifyResults,
        merged: false,
        reason: 'Verification command failed.',
      }
      this.log.append('submit.rejected', actor.principal.id, { ...this.eventResult(result), at: this.now() })
      return result
    }

    this.log.append('submit.verified', actor.principal.id, {
      taskId,
      changedFiles: changed,
      verify: verifyResults.map((entry) => ({ command: entry.command, ok: entry.ok, code: entry.code, output: '' })),
      at: this.now(),
    })

    let merged = false
    if (input.merge) {
      this.authorizeOrThrow(actor, 'git.push', `branch:${task.baseBranch}`, { request: { force: false } }, mandate)
      const merge = this.git(task.repoPath, ['merge', '--no-ff', task.branch, '-m', `teamplane: merge ${task.id}`])
      if (merge.code !== 0) {
        const result: SubmitResult = {
          ok: false,
          taskId,
          changedFiles: changed,
          conflicts: parseMergeTreeConflicts(merge.stderr),
          verify: verifyResults,
          merged: false,
          reason: `git merge failed: ${merge.stderr.trim()}`,
        }
        this.log.append('submit.rejected', actor.principal.id, { ...this.eventResult(result), at: this.now() })
        return result
      }
      merged = true
      this.log.append('submit.merged', actor.principal.id, { taskId, branch: task.branch, at: this.now() })
      this.log.append('task.status', actor.principal.id, { taskId, status: 'merged', at: this.now() })
    } else {
      this.log.append('task.status', actor.principal.id, { taskId, status: 'submitted', at: this.now() })
    }

    return {
      ok: true,
      taskId,
      changedFiles: changed,
      conflicts: [],
      verify: verifyResults,
      merged,
      reason: merged ? 'Merged into the base branch.' : 'Verified; ready to merge.',
    }
  }

  private changedFiles(task: Task): string[] {
    const diff = this.git(task.repoPath, ['diff', '--name-only', `${task.baseBranch}...${task.branch}`])
    if (diff.code !== 0) return []
    return diff.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map(normalizePath)
  }

  // ------------------------------------------------------------------ events

  eventsSince(since = 0, types?: string[]): ReturnType<EventLog['events']> {
    const events = this.log.events().filter((event) => event.seq > since)
    if (!types || types.length === 0) return events
    return events.filter((event) => types.some((pattern) => event.type === pattern || event.type.startsWith(pattern.replace(/\*$/, ''))))
  }

  audit() {
    return this.log.verify()
  }

  // ------------------------------------------------------------------ helpers

  private holdsLease(actor: AuthenticatedPrincipal, lease: Lease, mandate?: MandateClaims): boolean {
    if (actor.roles.includes('owner')) return true
    if (lease.holder === actor.principal.id) return true
    if (mandate && lease.holder === mandate.id) return true
    return false
  }

  private normalizeLeaseKey(key: string): string {
    const match = /^(file|dir|branch|memory):(.+)$/.exec(key)
    if (!match) fail('invalid_lease_key', 'Lease keys look like file:src/auth.ts, dir:src, branch:main or memory:team.', 422)
    const kind = match[1]!
    const value = kind === 'file' || kind === 'dir' ? normalizePath(match[2]!) : match[2]!
    if (value === '' || value.includes('..')) fail('invalid_lease_key', `Invalid lease key: ${key}`, 422)
    return `${kind}:${value}`
  }

  private git(cwd: string, args: string[]): { code: number; stdout: string; stderr: string } {
    const run = spawnSync('git', args, { cwd, encoding: 'utf8' })
    return { code: run.status ?? 1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' }
  }
}

export function approvalHash(action: string, resource: string, mandateId: string | null): string {
  return hashObject({ action, resource, mandateId })
}

export function leasesConflict(lease: Lease, key: string, mode: LeaseMode): boolean {
  if (lease.endedAt !== null) return false
  if (lease.key === key) {
    if (mode === 'shared' && lease.mode === 'shared') return false
    return true
  }
  const [leaseKind, leaseValue] = splitKey(lease.key)
  const [newKind, newValue] = splitKey(key)
  if (leaseKind === 'dir' && newKind === 'file' && withinPath(leaseValue, newValue)) {
    if (mode === 'shared' && lease.mode === 'shared') return false
    return true
  }
  if (leaseKind === 'file' && newKind === 'dir' && withinPath(newValue, leaseValue)) {
    if (mode === 'shared' && lease.mode === 'shared') return false
    return true
  }
  return false
}

function splitKey(key: string): [string, string] {
  const index = key.indexOf(':')
  return [key.slice(0, index), key.slice(index + 1)]
}

function parseMergeTreeConflicts(output: string): string[] {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const paths = lines.filter((line) => !/^[0-9a-f]{40,64}$/.test(line) && !line.startsWith('Auto-merging') && !line.includes('CONFLICT'))
  return unique(paths.length > 0 ? paths : lines.filter((line) => line.includes('CONFLICT')))
}

function tokenize(query: string): string[] {
  return unique(
    query
      .toLowerCase()
      .split(/[^a-z0-9_\u4e00-\u9fff]+/u)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2),
  )
}
