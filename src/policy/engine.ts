import type {
  AuthenticatedPrincipal,
  Condition,
  ConditionLeaf,
  MandateClaims,
  Obligations,
  Policy,
  PolicyDecision,
  Role,
} from '../core/types.js'
import { matchPattern, normalizePath, TeamplaneError, withinPath } from '../core/util.js'

export interface PolicyRequest {
  actor: AuthenticatedPrincipal
  action: string
  resource: string
  fields?: Record<string, unknown>
}

export function defaultPolicy(): Policy {
  return {
    version: 1,
    default: 'deny',
    rules: [
      {
        id: 'owner-all',
        description: 'Owners may do anything.',
        effect: 'allow',
        principals: ['role:owner'],
        actions: ['*'],
        resources: ['*'],
      },
      {
        id: 'agent-read',
        description: 'Agents may read inside a signed mandate scope.',
        effect: 'allow',
        principals: ['role:agent', 'role:maintainer'],
        actions: ['fs.read', 'memory.read'],
        resources: ['*'],
        obligations: { requireMandate: true },
      },
      {
        id: 'agent-write',
        description: 'Agents may write only inside a mandate and while holding a lease.',
        effect: 'allow',
        principals: ['role:agent', 'role:maintainer'],
        actions: ['fs.write'],
        resources: ['*'],
        obligations: { requireMandate: true, requireLease: true },
      },
      {
        id: 'agent-coordinate',
        description: 'Agents may acquire leases and submit work only inside a mandate.',
        effect: 'allow',
        principals: ['role:agent', 'role:maintainer'],
        actions: ['lease.acquire', 'memory.write', 'task.submit'],
        resources: ['*'],
        obligations: { requireMandate: true },
      },
      {
        id: 'maintainer-issue',
        description: 'Maintainers may create tasks and issue mandates for them.',
        effect: 'allow',
        principals: ['role:maintainer'],
        actions: ['task.create', 'task.start', 'task.launch', 'mandate.issue'],
        resources: ['*'],
      },
      {
        id: 'viewer-read',
        description: 'Viewers may read team memory but change nothing.',
        effect: 'allow',
        principals: ['role:viewer'],
        actions: ['memory.read', 'fs.read'],
        resources: ['*'],
      },
      {
        id: 'force-push-ask',
        description: 'Rewriting main requires an owner approval.',
        effect: 'ask',
        principals: ['*'],
        actions: ['git.push'],
        resources: ['branch:main'],
        conditions: { all: [{ field: 'request.force', op: 'eq', value: true }] },
        obligations: { requireApproval: true, approvalRole: 'owner', ttlSeconds: 1800 },
      },
      {
        id: 'policy-owner',
        description: 'Only owners change policy, roles or revoke mandates.',
        effect: 'allow',
        principals: ['role:owner'],
        actions: ['policy.write', 'role.grant', 'mandate.revoke'],
        resources: ['policy'],
      },
    ],
  }
}

export function principalMatches(pattern: string, actor: AuthenticatedPrincipal): boolean {
  if (pattern === '*') return true
  if (pattern === actor.principal.id) return true
  if (pattern === `kind:${actor.principal.kind}`) return true
  if (pattern.startsWith('role:')) {
    return actor.roles.includes(pattern.slice('role:'.length) as Role)
  }
  if (pattern.startsWith('user:')) return actor.principal.id === pattern.slice('user:'.length)
  return false
}

export function actionMatches(pattern: string, action: string): boolean {
  return matchPattern(pattern, action)
}

export function resourceMatches(pattern: string, resource: string, mandate?: MandateClaims): boolean {
  if (pattern === '*') return true
  if (pattern === 'scope:mandate') {
    if (!mandate) return false
    return mandateAllows(mandate, 'fs.read', resource).ok || mandateAllows(mandate, 'fs.write', resource).ok
  }
  return matchPattern(pattern, resource)
}

function resolveField(fields: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = fields
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function compare(leaf: ConditionLeaf, fields: Record<string, unknown>): boolean {
  const actual = resolveField(fields, leaf.field)
  const expected = leaf.value
  switch (leaf.op) {
    case 'exists':
      return actual !== undefined && actual !== null
    case 'eq':
      return JSON.stringify(actual) === JSON.stringify(expected)
    case 'ne':
      return JSON.stringify(actual) !== JSON.stringify(expected)
    case 'in':
      return Array.isArray(expected) && expected.some((item) => JSON.stringify(item) === JSON.stringify(actual))
    case 'not_in':
      return Array.isArray(expected) && !expected.some((item) => JSON.stringify(item) === JSON.stringify(actual))
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected
    case 'matches':
      return typeof actual === 'string' && typeof expected === 'string' && matchPattern(expected, actual)
    default:
      return false
  }
}

export function conditionsMatch(condition: Condition | undefined, fields: Record<string, unknown>): boolean {
  if (!condition) return true
  const all = condition.all ?? []
  const any = condition.any ?? []
  const allOk = all.every((leaf) => compare(leaf, fields))
  const anyOk = any.length === 0 ? true : any.some((leaf) => compare(leaf, fields))
  return allOk && anyOk
}

export function decide(policy: Policy, request: PolicyRequest): PolicyDecision {
  const fields = {
    ...(request.fields ?? {}),
    actor: {
      id: request.actor.principal.id,
      kind: request.actor.principal.kind,
      roles: request.actor.roles,
    },
    request: {
      action: request.action,
      resource: request.resource,
      ...((request.fields?.request as Record<string, unknown> | undefined) ?? {}),
    },
  }

  const matched: string[] = []
  let allow: { id: string; obligations: Obligations } | null = null
  let ask: { id: string; obligations: Obligations } | null = null
  let deny: { id: string; obligations: Obligations } | null = null

  for (const rule of policy.rules) {
    if (!rule.principals.some((pattern) => principalMatches(pattern, request.actor))) continue
    if (!rule.actions.some((pattern) => actionMatches(pattern, request.action))) continue
    if (!rule.resources.some((pattern) => resourceMatches(pattern, request.resource))) continue
    if (!conditionsMatch(rule.conditions, fields)) continue
    matched.push(rule.id)
    const entry = { id: rule.id, obligations: rule.obligations ?? {} }
    if (rule.effect === 'deny' && !deny) deny = entry
    if (rule.effect === 'ask' && !ask) ask = entry
    if (rule.effect === 'allow' && !allow) allow = entry
  }

  const pick = deny ?? ask ?? allow
  if (pick) {
    const decision = deny ? 'deny' : ask ? 'ask' : 'allow'
    return {
      decision,
      ruleId: pick.id,
      reason: reasonFor(decision, pick.id),
      obligations: pick.obligations,
      policyVersion: policy.version,
      matchedRules: matched,
    }
  }

  return {
    decision: policy.default,
    ruleId: null,
    reason:
      policy.default === 'allow'
        ? 'No rule matched; the policy default allows this action.'
        : 'No rule matched; the policy default denies this action.',
    obligations: {},
    policyVersion: policy.version,
    matchedRules: matched,
  }
}

function reasonFor(decision: 'allow' | 'deny' | 'ask', ruleId: string): string {
  if (decision === 'deny') return `Denied by rule ${ruleId}.`
  if (decision === 'ask') return `Rule ${ruleId} requires a human approval before this action.`
  return `Allowed by rule ${ruleId}.`
}

export interface MandateCheck {
  ok: boolean
  reason: string
}

export function mandateAllows(claims: MandateClaims, action: string, resource: string): MandateCheck {
  if (claims.scope.actions.includes('*') || claims.scope.actions.includes(action)) {
    // action is allowed; keep checking the resource below
  } else {
    return { ok: false, reason: `Action ${action} is outside the mandate scope.` }
  }

  const [kind, ...rest] = resource.split(':')
  const value = rest.join(':')

  if (kind === 'file' || kind === 'dir') {
    const path = normalizePath(value)
    const inside = claims.scope.paths.some((prefix) => withinPath(prefix, path))
    if (!inside) return { ok: false, reason: `Path ${path} is outside the mandate paths.` }
    return { ok: true, reason: 'Within mandate scope.' }
  }

  if (kind === 'branch') {
    if (claims.scope.branches.includes(value)) return { ok: true, reason: 'Within mandate branches.' }
    return { ok: false, reason: `Branch ${value} is outside the mandate branches.` }
  }

  if (kind === 'memory') {
    const inside = claims.scope.memory.some((prefix) => withinPath(prefix, value))
    if (!inside) return { ok: false, reason: `Memory namespace ${value} is outside the mandate memory scope.` }
    return { ok: true, reason: 'Within mandate memory scope.' }
  }

  return { ok: true, reason: 'Resource is not scope-bound.' }
}

export function validatePolicy(policy: Policy): string[] {
  const errors: string[] = []
  if (!Number.isInteger(policy.version) || policy.version < 1) errors.push('policy.version must be a positive integer')
  if (policy.default !== 'deny' && policy.default !== 'allow') errors.push('policy.default must be "deny" or "allow"')
  const ids = new Set<string>()
  for (const [index, rule] of policy.rules.entries()) {
    const where = `rules[${index}]`
    if (!rule.id) errors.push(`${where}.id is required`)
    if (ids.has(rule.id)) errors.push(`${where}.id "${rule.id}" is duplicated`)
    ids.add(rule.id)
    if (!['allow', 'deny', 'ask'].includes(rule.effect)) errors.push(`${where}.effect is invalid`)
    if (!Array.isArray(rule.principals) || rule.principals.length === 0) errors.push(`${where}.principals is empty`)
    if (!Array.isArray(rule.actions) || rule.actions.length === 0) errors.push(`${where}.actions is empty`)
    if (!Array.isArray(rule.resources) || rule.resources.length === 0) errors.push(`${where}.resources is empty`)
    if (rule.obligations?.approvalRole && !['owner', 'maintainer', 'agent', 'viewer'].includes(rule.obligations.approvalRole)) {
      errors.push(`${where}.obligations.approvalRole is invalid`)
    }
  }
  return errors
}

export function assertValidPolicy(policy: Policy): void {
  const errors = validatePolicy(policy)
  if (errors.length > 0) throw new TeamplaneError('invalid_policy', errors.join('; '), 422, errors)
}
