import type { Policy, Principal, Role } from '../core/types.js'
import { fail } from '../core/util.js'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export interface ApiClientOptions {
  baseUrl: string
  token: string
  mandate?: string
}

export class ApiClient {
  readonly baseUrl: string
  readonly token: string
  readonly mandate: string | undefined

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.token = options.token
    this.mandate = options.mandate
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      'content-type': 'application/json',
    }
    if (this.mandate) headers['x-teamplane-mandate'] = this.mandate
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let payload: unknown = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = { raw: text }
    }
    if (!response.ok) {
      const error = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error
      throw new ApiError(response.status, error?.code ?? 'http_error', error?.message ?? text, error?.details ?? null)
    }
    return payload as T
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body ?? {})
  }

  put<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body)
  }

  del<T = unknown>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }

  me(): Promise<{ principal: Principal; roles: Role[]; mandate: unknown }> {
    return this.get('/v1/me')
  }

  createPrincipal(input: { kind: string; display: string; roles?: Role[] }): Promise<{ principal: Principal; token: string }> {
    return this.post('/v1/principals', input)
  }

  grantRole(principalId: string, role: Role): Promise<{ ok: true }> {
    return this.post('/v1/roles/grant', { principalId, role })
  }

  policy(): Promise<Policy> {
    return this.get('/v1/policy')
  }

  updatePolicy(policy: Policy): Promise<Policy> {
    return this.put('/v1/policy', policy)
  }

  explain(action: string, resource: string, fields: Record<string, unknown> = {}): Promise<unknown> {
    return this.post('/v1/policy/explain', { action, resource, fields })
  }

  authorize(action: string, resource: string, fields: Record<string, unknown> = {}, approvalId?: string): Promise<unknown> {
    return this.post('/v1/authorize', { action, resource, fields, approvalId })
  }

  issueMandate(input: Record<string, unknown>): Promise<{ mandate: { id: string } & Record<string, unknown>; token: string }> {
    return this.post('/v1/mandates', input)
  }

  deriveMandate(id: string, input: Record<string, unknown>): Promise<{ mandate: { id: string } & Record<string, unknown>; token: string }> {
    return this.post(`/v1/mandates/${encodeURIComponent(id)}/derive`, input)
  }

  revokeMandate(id: string, reason = ''): Promise<{ ok: true }> {
    return this.post(`/v1/mandates/${encodeURIComponent(id)}/revoke`, { reason })
  }

  mandates(): Promise<{ mandates: unknown[] }> {
    return this.get('/v1/mandates')
  }

  createTask(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.post('/v1/tasks', input)
  }

  tasks(): Promise<{ tasks: Array<Record<string, unknown>> }> {
    return this.get('/v1/tasks')
  }

  setTaskVerify(id: string, verify: string[]): Promise<Record<string, unknown>> {
    return this.post(`/v1/tasks/${encodeURIComponent(id)}/verify`, { verify })
  }

  startTask(id: string, mandateId?: string): Promise<Record<string, unknown>> {
    return this.post(`/v1/tasks/${encodeURIComponent(id)}/start`, { mandateId })
  }

  submit(id: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.post(`/v1/tasks/${encodeURIComponent(id)}/submit`, input)
  }

  acquireLease(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.post('/v1/leases', input)
  }

  renewLease(id: string, ttlSeconds?: number): Promise<Record<string, unknown>> {
    return this.post(`/v1/leases/${encodeURIComponent(id)}/renew`, { ttlSeconds })
  }

  releaseLease(id: string): Promise<{ ok: true }> {
    return this.del(`/v1/leases/${encodeURIComponent(id)}`)
  }

  leases(): Promise<{ leases: Array<Record<string, unknown>> }> {
    return this.get('/v1/leases')
  }

  writeMemory(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.post('/v1/memory', input)
  }

  searchMemory(query: string, kind?: string): Promise<{ results: Array<Record<string, unknown>> }> {
    const params = new URLSearchParams({ q: query })
    if (kind) params.set('kind', kind)
    return this.get(`/v1/memory/search?${params.toString()}`)
  }

  memoryConflicts(): Promise<{ conflicts: Array<Record<string, unknown>> }> {
    return this.get('/v1/memory/conflicts')
  }

  requestApproval(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.post('/v1/approvals', input)
  }

  resolveApproval(id: string, approve: boolean, reason = ''): Promise<Record<string, unknown>> {
    return this.post(`/v1/approvals/${encodeURIComponent(id)}/resolve`, { approve, reason })
  }

  approvals(): Promise<{ approvals: Array<Record<string, unknown>> }> {
    return this.get('/v1/approvals')
  }

  events(since = 0, types?: string): Promise<{ events: Array<Record<string, unknown>> }> {
    const params = new URLSearchParams({ since: String(since) })
    if (types) params.set('types', types)
    return this.get(`/v1/events?${params.toString()}`)
  }

  audit(): Promise<{ ok: boolean; events: number; brokenAt: number | null; reason: string | null }> {
    return this.get('/v1/audit/verify')
  }

  state(): Promise<Record<string, unknown>> {
    return this.get('/v1/state')
  }
}

export function requireToken(token: string | undefined): string {
  if (!token) {
    fail('missing_token', 'Set TEAMPLANE_TOKEN to a principal token (printed once by "teamplane init" or "teamplane user add").', 401)
  }
  return token
}
