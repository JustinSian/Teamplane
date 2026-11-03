import type { JsonValue } from './util.js'

export const ROLES = ['owner', 'maintainer', 'agent', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export const PRINCIPAL_KINDS = ['user', 'agent', 'service'] as const
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number]

export interface Principal {
  id: string
  kind: PrincipalKind
  display: string
  tokenHash: string
  createdAt: string
  disabled: boolean
}

export type Effect = 'allow' | 'deny' | 'ask'

export type CompareOp = 'eq' | 'ne' | 'in' | 'not_in' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'matches'

export interface ConditionLeaf {
  field: string
  op: CompareOp
  value?: JsonValue
}

export interface Condition {
  all?: ConditionLeaf[]
  any?: ConditionLeaf[]
}

export interface Obligations {
  requireMandate?: boolean
  requireLease?: boolean
  requireApproval?: boolean
  approvalRole?: Role
  ttlSeconds?: number
  maxBytes?: number
}

export interface PolicyRule {
  id: string
  effect: Effect
  principals: string[]
  actions: string[]
  resources: string[]
  conditions?: Condition
  obligations?: Obligations
  description?: string
}

export interface Policy {
  version: number
  default: 'deny' | 'allow'
  rules: PolicyRule[]
  updatedAt?: string
  updatedBy?: string
}

export interface PolicyDecision {
  decision: Effect
  ruleId: string | null
  reason: string
  obligations: Obligations
  policyVersion: number
  matchedRules: string[]
}

export interface MandateScope {
  /** Path prefixes, e.g. `src/auth` or `docs`. */
  paths: string[]
  /** Action names, e.g. `fs.read`, `fs.write`, `task.submit`. */
  actions: string[]
  /** Exact branch names, e.g. `main`, `tp/tsk_123`. */
  branches: string[]
  /** Memory namespaces, e.g. `team/auth`. */
  memory: string[]
}

export interface MandateClaims {
  v: 1
  id: string
  issuer: string
  subject: string
  task: string
  scope: MandateScope
  limits: {
    maxWrites: number
    expiresAt: string
  }
  policyVersion: number
  iat: string
  exp: string
  nonce: string
}

export interface MandateRecord {
  id: string
  claims: MandateClaims
  token: string
  parentId: string | null
  createdAt: string
  revokedAt: string | null
}

export type TaskStatus = 'open' | 'active' | 'submitted' | 'merged' | 'closed'

export interface Task {
  id: string
  title: string
  requester: string
  assignee: string | null
  repoPath: string
  baseBranch: string
  branch: string
  worktree: string | null
  mandateId: string | null
  status: TaskStatus
  createdAt: string
  updatedAt: string
}

export type LeaseMode = 'exclusive' | 'shared'

export interface Lease {
  id: string
  key: string
  mode: LeaseMode
  holder: string
  task: string
  fencing: number
  acquiredAt: string
  renewedAt: string
  expiresAt: string
  endedAt: string | null
  endedReason: 'released' | 'expired' | null
}

export type Visibility = 'private' | 'team' | `role:${Role}`

export const MEMORY_KINDS = ['decision', 'convention', 'pitfall', 'spec', 'handoff'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

export interface MemoryFragment {
  id: string
  owner: string
  kind: MemoryKind
  topic: string
  text: string
  visibility: Visibility
  provenance: {
    task: string | null
    files: string[]
    events: string[]
    source: string
  }
  createdAt: string
  supersedes: string | null
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'consumed'

export interface Approval {
  id: string
  action: string
  resource: string
  actionHash: string
  requestedBy: string
  requiredRole: Role
  mandateId: string | null
  status: ApprovalStatus
  createdAt: string
  expiresAt: string
  resolvedBy: string | null
  resolvedAt: string | null
  reason: string | null
}

export type EventType =
  | 'principal.created'
  | 'role.granted'
  | 'policy.updated'
  | 'mandate.issued'
  | 'mandate.revoked'
  | 'task.created'
  | 'task.started'
  | 'task.status'
  | 'lease.acquired'
  | 'lease.denied'
  | 'lease.renewed'
  | 'lease.released'
  | 'lease.expired'
  | 'memory.written'
  | 'memory.conflict'
  | 'approval.requested'
  | 'approval.resolved'
  | 'approval.consumed'
  | 'decision.denied'
  | 'submit.verified'
  | 'submit.rejected'
  | 'submit.merged'

export interface EventRecord {
  seq: number
  id: string
  at: string
  type: EventType
  actor: string
  data: JsonValue
  prevHash: string
  hash: string
}

export interface State {
  principals: Map<string, Principal>
  roles: Map<string, Role[]>
  policy: Policy
  mandates: Map<string, MandateRecord>
  tasks: Map<string, Task>
  leases: Map<string, Lease>
  memory: Map<string, MemoryFragment>
  approvals: Map<string, Approval>
  fencing: Map<string, number>
  lastSeq: number
  lastHash: string
}

export interface AuthenticatedPrincipal {
  principal: Principal
  roles: Role[]
}

export interface RequestContext {
  actor: AuthenticatedPrincipal
  mandate?: MandateClaims
  now: string
}

export interface AuthorizeInput {
  action: string
  resource: string
  fields?: Record<string, JsonValue>
  requireMandate?: boolean
}

export interface AuthorizeResult {
  decision: Effect
  ruleId: string | null
  reason: string
  policyVersion: number
  obligations: Obligations
  mandateOk: boolean
}
