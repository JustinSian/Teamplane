import { EventEmitter } from 'node:events'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Approval,
  EventRecord,
  EventType,
  Lease,
  MandateRecord,
  MemoryFragment,
  Policy,
  Principal,
  Role,
  State,
  Task,
} from '../core/types.js'
import type { JsonValue } from '../core/util.js'
import { canonicalJson, fail, hashObject, id, nowIso, parseJson, sha256 } from '../core/util.js'
import { defaultPolicy } from '../policy/engine.js'

const GENESIS = '0'.repeat(64)
const SNAPSHOT_EVERY = 250

export function emptyState(): State {
  return {
    principals: new Map(),
    roles: new Map(),
    policy: defaultPolicy(),
    mandates: new Map(),
    tasks: new Map(),
    leases: new Map(),
    memory: new Map(),
    approvals: new Map(),
    fencing: new Map(),
    lastSeq: 0,
    lastHash: GENESIS,
  }
}

export class EventLog extends EventEmitter {
  readonly dir: string
  readonly file: string
  readonly snapshotFile: string
  state: State
  private snapshotWriteInFlight = false

  private constructor(dir: string) {
    super()
    this.dir = dir
    this.file = join(dir, 'events.jsonl')
    this.snapshotFile = join(dir, 'snapshot.json')
    this.state = emptyState()
  }

  static open(dir: string): EventLog {
    mkdirSync(dir, { recursive: true })
    const log = new EventLog(dir)
    log.loadSnapshot()
    log.replay()
    return log
  }

  private loadSnapshot(): void {
    if (!existsSync(this.snapshotFile)) return
    try {
      const snapshot = parseJson<SerializedSnapshot>(readFileSync(this.snapshotFile, 'utf8'), 'snapshot')
      if (snapshot.version !== 1) return
      this.state = deserializeState(snapshot.state)
      this.state.lastSeq = snapshot.seq
      this.state.lastHash = snapshot.hash
    } catch {
      this.state = emptyState()
    }
  }

  private replay(): void {
    if (!existsSync(this.file)) return
    const text = readFileSync(this.file, 'utf8')
    if (text.length === 0) return
    let expectedSeq = this.state.lastSeq + 1
    let previous = this.state.lastHash
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      let event: EventRecord
      try {
        event = parseJson<EventRecord>(line, 'event log')
      } catch {
        fail('corrupt_event_log', `Event log at ${this.file} contains a malformed line.`, 500)
      }
      if (event.seq <= this.state.lastSeq) continue
      const check = verifyEvent(event, previous, expectedSeq)
      if (!check.ok) fail('corrupt_event_log', check.reason ?? 'event log verification failed', 500)
      applyEvent(this.state, event)
      previous = event.hash
      expectedSeq += 1
    }
  }

  append(type: EventType, actor: string, data: JsonValue): EventRecord {
    const seq = this.state.lastSeq + 1
    const at = nowIso()
    const core = { seq, id: id('evt'), at, type, actor, data, prevHash: this.state.lastHash }
    const hash = hashObject(core)
    const event: EventRecord = { ...core, hash }
    appendFileSync(this.file, `${canonicalJson(event)}\n`, { mode: 0o600 })
    applyEvent(this.state, event)
    this.emit('event', event)
    if (seq % SNAPSHOT_EVERY === 0) this.writeSnapshot()
    return event
  }

  writeSnapshot(): void {
    if (this.snapshotWriteInFlight) return
    this.snapshotWriteInFlight = true
    try {
      const snapshot: SerializedSnapshot = {
        version: 1,
        seq: this.state.lastSeq,
        hash: this.state.lastHash,
        state: serializeState(this.state),
      }
      const tmp = `${this.snapshotFile}.tmp`
      writeFileSync(tmp, canonicalJson(snapshot), { mode: 0o600 })
      renameSync(tmp, this.snapshotFile)
    } finally {
      this.snapshotWriteInFlight = false
    }
  }

  events(): EventRecord[] {
    if (!existsSync(this.file)) return []
    return readFileSync(this.file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => parseJson<EventRecord>(line, 'event log'))
  }

  verify(): { ok: boolean; events: number; brokenAt: number | null; reason: string | null } {
    const events = this.events()
    let previous = GENESIS
    let expected = 1
    for (const event of events) {
      const check = verifyEvent(event, previous, expected)
      if (!check.ok) return { ok: false, events: events.length, brokenAt: event.seq, reason: check.reason }
      previous = event.hash
      expected += 1
    }
    return { ok: true, events: events.length, brokenAt: null, reason: null }
  }

  close(): void {
    this.writeSnapshot()
  }
}

export function verifyEvent(event: EventRecord, previous: string, expectedSeq: number): { ok: boolean; reason: string | null } {
  if (event.seq !== expectedSeq) {
    return { ok: false, reason: `Expected seq ${expectedSeq}, found ${event.seq}` }
  }
  if (event.prevHash !== previous) {
    return { ok: false, reason: `prevHash mismatch at seq ${event.seq}` }
  }
  const core = {
    seq: event.seq,
    id: event.id,
    at: event.at,
    type: event.type,
    actor: event.actor,
    data: event.data,
    prevHash: event.prevHash,
  }
  if (hashObject(core) !== event.hash) {
    return { ok: false, reason: `hash mismatch at seq ${event.seq}` }
  }
  return { ok: true, reason: null }
}

export function applyEvent(state: State, event: EventRecord): void {
  const data = event.data as unknown
  switch (event.type) {
    case 'principal.created': {
      const principal = data as Principal
      state.principals.set(principal.id, principal)
      if (!state.roles.has(principal.id)) state.roles.set(principal.id, [])
      break
    }
    case 'role.granted': {
      const payload = data as { principalId: string; role: Role }
      const current = state.roles.get(payload.principalId) ?? []
      if (!current.includes(payload.role)) state.roles.set(payload.principalId, [...current, payload.role])
      break
    }
    case 'policy.updated': {
      state.policy = data as Policy
      break
    }
    case 'mandate.issued': {
      const mandate = data as MandateRecord
      state.mandates.set(mandate.id, mandate)
      break
    }
    case 'mandate.revoked': {
      const payload = data as { id: string; at: string }
      const mandate = state.mandates.get(payload.id)
      if (mandate) state.mandates.set(payload.id, { ...mandate, revokedAt: payload.at })
      break
    }
    case 'task.created': {
      const task = data as Task
      state.tasks.set(task.id, task)
      break
    }
    case 'task.started': {
      const payload = data as { taskId: string; worktree: string; branch: string; at: string; mandateId?: string | null }
      const task = state.tasks.get(payload.taskId)
      if (task) {
        state.tasks.set(task.id, {
          ...task,
          worktree: payload.worktree,
          branch: payload.branch,
          mandateId: payload.mandateId ?? task.mandateId,
          status: 'active',
          updatedAt: payload.at,
        })
      }
      break
    }
    case 'task.status': {
      const payload = data as { taskId: string; status: Task['status']; at: string; mandateId?: string | null }
      const task = state.tasks.get(payload.taskId)
      if (task) {
        state.tasks.set(task.id, {
          ...task,
          status: payload.status,
          mandateId: payload.mandateId ?? task.mandateId,
          updatedAt: payload.at,
        })
      }
      break
    }
    case 'lease.acquired': {
      const lease = data as Lease
      state.leases.set(lease.id, lease)
      const current = state.fencing.get(lease.key) ?? 0
      if (lease.fencing > current) state.fencing.set(lease.key, lease.fencing)
      break
    }
    case 'lease.renewed': {
      const payload = data as { id: string; renewedAt: string; expiresAt: string }
      const lease = state.leases.get(payload.id)
      if (lease) state.leases.set(lease.id, { ...lease, renewedAt: payload.renewedAt, expiresAt: payload.expiresAt })
      break
    }
    case 'lease.released':
    case 'lease.expired': {
      const payload = data as { id: string; at: string; reason: 'released' | 'expired' }
      const lease = state.leases.get(payload.id)
      if (lease) state.leases.set(lease.id, { ...lease, endedAt: payload.at, endedReason: payload.reason })
      break
    }
    case 'memory.written': {
      const fragment = data as MemoryFragment
      state.memory.set(fragment.id, fragment)
      break
    }
    case 'approval.requested': {
      const approval = data as Approval
      state.approvals.set(approval.id, approval)
      break
    }
    case 'approval.resolved': {
      const payload = data as {
        id: string
        status: Approval['status']
        resolvedBy: string
        resolvedAt: string
        reason: string | null
      }
      const approval = state.approvals.get(payload.id)
      if (approval) {
        state.approvals.set(approval.id, {
          ...approval,
          status: payload.status,
          resolvedBy: payload.resolvedBy,
          resolvedAt: payload.resolvedAt,
          reason: payload.reason,
        })
      }
      break
    }
    case 'approval.consumed': {
      const payload = data as { id: string }
      const approval = state.approvals.get(payload.id)
      if (approval) state.approvals.set(approval.id, { ...approval, status: 'consumed' })
      break
    }
    default:
      break
  }
  state.lastSeq = event.seq
  state.lastHash = event.hash
}

interface SerializedSnapshot {
  version: 1
  seq: number
  hash: string
  state: SerializedState
}

interface SerializedState {
  principals: Principal[]
  roles: Array<[string, Role[]]>
  policy: Policy
  mandates: MandateRecord[]
  tasks: Task[]
  leases: Lease[]
  memory: MemoryFragment[]
  approvals: Approval[]
  fencing: Array<[string, number]>
}

function serializeState(state: State): SerializedState {
  return {
    principals: [...state.principals.values()],
    roles: [...state.roles.entries()],
    policy: state.policy,
    mandates: [...state.mandates.values()],
    tasks: [...state.tasks.values()],
    leases: [...state.leases.values()],
    memory: [...state.memory.values()],
    approvals: [...state.approvals.values()],
    fencing: [...state.fencing.entries()],
  }
}

function deserializeState(state: SerializedState): State {
  return {
    principals: new Map(state.principals.map((item) => [item.id, item])),
    roles: new Map(state.roles),
    policy: state.policy,
    mandates: new Map(state.mandates.map((item) => [item.id, item])),
    tasks: new Map(state.tasks.map((item) => [item.id, item])),
    leases: new Map(state.leases.map((item) => [item.id, item])),
    memory: new Map(state.memory.map((item) => [item.id, item])),
    approvals: new Map(state.approvals.map((item) => [item.id, item])),
    fencing: new Map(state.fencing),
    lastSeq: 0,
    lastHash: GENESIS,
  }
}

export function activeLeases(state: State, now = nowIso()): Lease[] {
  return [...state.leases.values()].filter((lease) => lease.endedAt === null && lease.expiresAt > now)
}

export function tokenHash(token: string): string {
  return sha256(token)
}
