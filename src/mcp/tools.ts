export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  call: (api: McpApi, args: Record<string, unknown>) => Promise<unknown>
}

export interface McpApi {
  get: (path: string) => Promise<unknown>
  post: (path: string, body?: Record<string, unknown>) => Promise<unknown>
  del: (path: string) => Promise<unknown>
}

function str(args: Record<string, unknown>, key: string, required = true): string {
  const value = args[key]
  if (value === undefined || value === null) {
    if (required) throw new Error(`Missing argument: ${key}`)
    return ''
  }
  return String(value)
}

export const TOOLS: McpToolDefinition[] = [
  {
    name: 'tp_whoami',
    description: 'Return the authenticated principal, roles and the mandate attached to this session.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    call: (api) => api.get('/v1/me'),
  },
  {
    name: 'tp_task_start',
    description: 'Create (or reuse) the isolated git worktree for a task and write its .teamplane context. Returns the worktree path.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task id, e.g. tsk_...' },
        mandateId: { type: 'string', description: 'Optional mandate id to attach to the worktree context.' },
      },
      required: ['taskId'],
    },
    call: (api, args) => api.post(`/v1/tasks/${encodeURIComponent(str(args, 'taskId'))}/start`, { mandateId: args.mandateId }),
  },
  {
    name: 'tp_lease_acquire',
    description: 'Acquire an exclusive or shared lease on file:, dir:, branch: or memory: before touching a resource.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Lease key, e.g. file:src/auth.ts, dir:src, branch:main, memory:team/auth' },
        mode: { type: 'string', enum: ['exclusive', 'shared'] },
        task: { type: 'string', description: 'Task id that owns this lease.' },
        ttlSeconds: { type: 'number', description: 'Lease TTL in seconds (default 900, max 7200).' },
      },
      required: ['key', 'task'],
    },
    call: (api, args) =>
      api.post('/v1/leases', { key: args.key, mode: args.mode ?? 'exclusive', task: args.task, ttlSeconds: args.ttlSeconds }),
  },
  {
    name: 'tp_lease_release',
    description: 'Release a lease you hold.',
    inputSchema: {
      type: 'object',
      properties: { leaseId: { type: 'string' } },
      required: ['leaseId'],
    },
    call: (api, args) => api.del(`/v1/leases/${encodeURIComponent(str(args, 'leaseId'))}`),
  },
  {
    name: 'tp_memory_put',
    description: 'Store a curated memory fragment (decision, convention, pitfall, spec or handoff). Raw transcripts are not accepted.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['decision', 'convention', 'pitfall', 'spec', 'handoff'] },
        topic: { type: 'string' },
        text: { type: 'string', description: 'At most 4096 bytes. Must not contain secrets.' },
        visibility: { type: 'string', description: 'private | team | role:<role>' },
        namespace: { type: 'string', description: 'Memory namespace, default "team".' },
      },
      required: ['kind', 'topic', 'text'],
    },
    call: (api, args) =>
      api.post('/v1/memory', {
        kind: args.kind,
        topic: args.topic,
        text: args.text,
        visibility: args.visibility ?? 'team',
        namespace: args.namespace ?? 'team',
        provenance: { source: 'mcp' },
      }),
  },
  {
    name: 'tp_memory_search',
    description: 'Search team memory. Results are filtered by the caller permissions before they leave the server.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        kind: { type: 'string', enum: ['decision', 'convention', 'pitfall', 'spec', 'handoff'] },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
    call: (api, args) => {
      const query = new URLSearchParams({ q: str(args, 'query') })
      if (args.kind) query.set('kind', String(args.kind))
      if (args.limit) query.set('limit', String(args.limit))
      return api.get(`/v1/memory/search?${query.toString()}`)
    },
  },
  {
    name: 'tp_approval_request',
    description: 'Ask a human approver (owner by default) for permission for one specific action and resource.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'e.g. git.push' },
        resource: { type: 'string', description: 'e.g. branch:main' },
        ttlSeconds: { type: 'number' },
        fields: { type: 'object', description: 'Policy fields, e.g. {"request":{"force":true}}' },
      },
      required: ['action', 'resource'],
    },
    call: (api, args) => api.post('/v1/approvals', { action: args.action, resource: args.resource, ttlSeconds: args.ttlSeconds, fields: args.fields ?? {} }),
  },
  {
    name: 'tp_events_poll',
    description: 'Poll structured events (lease, approval, submit, memory) after a sequence number. This is a subscription, not a transcript.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'number' },
        types: { type: 'string', description: 'Comma separated event types or prefixes, e.g. lease.,approval.' },
      },
    },
    call: (api, args) => {
      const query = new URLSearchParams({ since: String(args.since ?? 0) })
      if (args.types) query.set('types', String(args.types))
      return api.get(`/v1/events?${query.toString()}`)
    },
  },
  {
    name: 'tp_submit',
    description: 'Submit a task: check leases, run git merge-tree, execute verification commands and optionally merge.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        merge: { type: 'boolean' },
      },
      required: ['taskId'],
    },
    call: (api, args) => api.post(`/v1/tasks/${encodeURIComponent(str(args, 'taskId'))}/submit`, { merge: Boolean(args.merge) }),
  },
  {
    name: 'tp_policy_explain',
    description: 'Explain a deterministic policy decision without performing the action.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        resource: { type: 'string' },
      },
      required: ['action', 'resource'],
    },
    call: (api, args) => api.post('/v1/policy/explain', { action: args.action, resource: args.resource }),
  },
]

export function findTool(name: string): McpToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name)
}
