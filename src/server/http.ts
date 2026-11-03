import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AuthenticatedPrincipal, MandateClaims, Policy, Role } from '../core/types.js'
import { TeamplaneError, fail, fail as raise, nowIso, parseJson } from '../core/util.js'
import type { LoadedWorkspace } from '../core/config.js'
import { handleMcpHttp } from '../mcp/http.js'
import { rateLimiterFromEnv } from './ratelimit.js'

const WEB_ROOT = fileURLToPath(new URL('../../web/', import.meta.url))
const MAX_BODY = 1024 * 1024

export interface ServerOptions {
  port?: number
  host?: string
  quiet?: boolean
}

export interface RunningServer {
  server: Server
  url: string
  close: () => Promise<void>
}

interface RequestContext {
  actor: AuthenticatedPrincipal
  mandate?: MandateClaims
}

export async function startServer(workspace: LoadedWorkspace, options: ServerOptions = {}): Promise<RunningServer> {
  const host = options.host ?? workspace.config.host
  const port = options.port ?? workspace.config.port
  const clients = new Set<{ res: ServerResponse; types: string[] }>()
  const limiter = rateLimiterFromEnv()
  const sweep = setInterval(() => {
    try {
      workspace.service.expireLeases()
    } catch {
      /* sweeper is best-effort */
    }
  }, 5000)
  sweep.unref()

  const onEvent = (event: { type: string }) => {
    for (const client of clients) {
      if (client.types.length > 0 && !client.types.some((type) => event.type === type || event.type.startsWith(type.replace(/\*$/, '')))) continue
      writeSse(client.res, 'event', event, (event as { seq?: number }).seq)
    }
  }
  workspace.log.on('event', onEvent)

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => sendError(res, error))
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`)
    const path = url.pathname

    if (path === '/healthz') {
      sendJson(res, 200, { ok: true, name: workspace.config.name, at: nowIso() })
      return
    }
    if (path === '/mcp') {
      const token = bearer(req)
      const actor = workspace.service.authenticate(token)
      takeToken(limiter, actor.principal.id)
      const rawMandate = req.headers['x-teamplane-mandate'] as string | undefined
      workspace.service.resolveMandate(rawMandate, actor)
      const address = server.address()
      const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`
      await handleMcpHttp(req, res, { baseUrl, token: token!, mandate: rawMandate })
      return
    }
    if (path.startsWith('/v1/stream')) {
      const token = url.searchParams.get('token') ?? bearer(req)
      const actor = workspace.service.authenticate(token)
      void actor
      const types = (url.searchParams.get('types') ?? '').split(',').map((item) => item.trim()).filter(Boolean)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      const client = { res, types }
      const headerId = Number(req.headers['last-event-id'] ?? '')
      const querySince = Number(url.searchParams.get('since') ?? '')
      const since = Number.isFinite(headerId) && headerId > 0 ? headerId : Number.isFinite(querySince) && querySince > 0 ? querySince : 0
      writeSse(res, 'hello', { at: nowIso(), types, since })
      if (since > 0) {
        for (const event of workspace.service.eventsSince(since, types)) {
          writeSse(res, 'event', event, event.seq)
        }
      }
      clients.add(client)
      const keepAlive = setInterval(() => writeSse(res, 'ping', { at: nowIso() }), 15000)
      keepAlive.unref()
      req.on('close', () => {
        clearInterval(keepAlive)
        clients.delete(client)
      })
      return
    }
    if (!path.startsWith('/v1/')) {
      serveStatic(path, res)
      return
    }

    const ctx = contextFor(req)
    const body = await readJson(req)
    await route(path, req.method ?? 'GET', url, ctx, body, res)
  }

  async function route(
    path: string,
    method: string,
    url: URL,
    ctx: RequestContext,
    body: Record<string, unknown>,
    res: ServerResponse,
  ): Promise<void> {
    const service = workspace.service

    if (method === 'GET' && path === '/v1/me') {
      sendJson(res, 200, { principal: service.publicPrincipal(ctx.actor.principal), roles: ctx.actor.roles, mandate: ctx.mandate ?? null })
      return
    }

    if (method === 'POST' && path === '/v1/principals') {
      const created = service.createPrincipal(ctx.actor, {
        kind: (body.kind as never) ?? 'agent',
        display: String(body.display ?? ''),
        roles: (body.roles as Role[] | undefined) ?? ['agent'],
      })
      sendJson(res, 201, { principal: service.publicPrincipal(created.principal), token: created.token })
      return
    }
    if (method === 'GET' && path === '/v1/principals') {
      sendJson(res, 200, {
        principals: [...service.state.principals.values()].map((principal) => ({
          ...service.publicPrincipal(principal),
          roles: service.rolesOf(principal.id),
        })),
      })
      return
    }
    if (method === 'POST' && path === '/v1/roles/grant') {
      service.grantRole(ctx.actor, String(body.principalId ?? ''), body.role as Role)
      sendJson(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && path === '/v1/policy') {
      sendJson(res, 200, service.state.policy)
      return
    }
    if (method === 'PUT' && path === '/v1/policy') {
      const policy = body as unknown as Policy
      const saved = service.updatePolicy(ctx.actor, policy)
      sendJson(res, 200, saved)
      return
    }
    if (method === 'POST' && path === '/v1/policy/explain') {
      const result = service.authorize(
        ctx.actor,
        String(body.action ?? ''),
        String(body.resource ?? ''),
        (body.fields as Record<string, unknown> | undefined) ?? {},
        ctx.mandate,
        body.approvalId as string | undefined,
      )
      sendJson(res, 200, result)
      return
    }
    if (method === 'POST' && path === '/v1/authorize') {
      const result = service.authorize(
        ctx.actor,
        String(body.action ?? ''),
        String(body.resource ?? ''),
        (body.fields as Record<string, unknown> | undefined) ?? {},
        ctx.mandate,
        body.approvalId as string | undefined,
      )
      sendJson(res, 200, result)
      return
    }

    if (method === 'POST' && path === '/v1/mandates') {
      const issued = service.issueMandate(ctx.actor, {
        subject: String(body.subject ?? ''),
        task: String(body.task ?? ''),
        paths: asStringArray(body.paths),
        actions: body.actions ? asStringArray(body.actions) : undefined,
        branches: body.branches ? asStringArray(body.branches) : undefined,
        memory: body.memory ? asStringArray(body.memory) : undefined,
        ttlSeconds: asNumber(body.ttlSeconds),
        maxWrites: asNumber(body.maxWrites),
      })
      sendJson(res, 201, { mandate: issued.record, token: issued.token })
      return
    }
    const deriveMatch = /^\/v1\/mandates\/([^/]+)\/derive$/.exec(path)
    if (method === 'POST' && deriveMatch) {
      const issued = service.deriveMandate(ctx.actor, deriveMatch[1]!, {
        subject: body.subject ? String(body.subject) : undefined,
        paths: body.paths ? asStringArray(body.paths) : undefined,
        actions: body.actions ? asStringArray(body.actions) : undefined,
        branches: body.branches ? asStringArray(body.branches) : undefined,
        memory: body.memory ? asStringArray(body.memory) : undefined,
        ttlSeconds: asNumber(body.ttlSeconds),
        maxWrites: asNumber(body.maxWrites),
      })
      sendJson(res, 201, { mandate: issued.record, token: issued.token })
      return
    }
    const revokeMatch = /^\/v1\/mandates\/([^/]+)\/revoke$/.exec(path)
    if (method === 'POST' && revokeMatch) {
      service.revokeMandate(ctx.actor, revokeMatch[1]!, String(body.reason ?? ''))
      sendJson(res, 200, { ok: true })
      return
    }
    if (method === 'GET' && path === '/v1/mandates') {
      sendJson(res, 200, { mandates: [...service.state.mandates.values()] })
      return
    }

    if (method === 'POST' && path === '/v1/tasks') {
      const task = service.createTask(ctx.actor, {
        title: String(body.title ?? ''),
        repoPath: body.repoPath ? String(body.repoPath) : undefined,
        baseBranch: body.baseBranch ? String(body.baseBranch) : undefined,
        assignee: body.assignee ? String(body.assignee) : null,
      })
      sendJson(res, 201, task)
      return
    }
    if (method === 'GET' && path === '/v1/tasks') {
      sendJson(res, 200, { tasks: [...service.state.tasks.values()] })
      return
    }
    const startMatch = /^\/v1\/tasks\/([^/]+)\/start$/.exec(path)
    if (method === 'POST' && startMatch) {
      const task = service.startTask(ctx.actor, startMatch[1]!, body.mandateId ? String(body.mandateId) : undefined)
      sendJson(res, 200, task)
      return
    }
    const launchMatch = /^\/v1\/tasks\/([^/]+)\/launched$/.exec(path)
    if (method === 'POST' && launchMatch) {
      const launch = service.recordLaunch(ctx.actor, launchMatch[1]!, {
        command: String(body.command ?? ''),
        pid: asNumber(body.pid) ?? null,
      })
      sendJson(res, 201, launch)
      return
    }
    const submitMatch = /^\/v1\/tasks\/([^/]+)\/submit$/.exec(path)
    if (method === 'POST' && submitMatch) {
      const result = service.submit(
        ctx.actor,
        submitMatch[1]!,
        {
          verify: asStringArray(body.verify ?? []),
          merge: Boolean(body.merge),
          requireLease: body.requireLease === undefined ? true : Boolean(body.requireLease),
          timeoutMs: asNumber(body.timeoutMs),
        },
        ctx.mandate,
      )
      sendJson(res, 200, result)
      return
    }

    if (method === 'POST' && path === '/v1/leases') {
      const lease = service.acquireLease(ctx.actor, {
        key: String(body.key ?? ''),
        mode: (body.mode as never) ?? 'exclusive',
        task: String(body.task ?? ''),
        ttlSeconds: asNumber(body.ttlSeconds),
        mandate: ctx.mandate,
      })
      sendJson(res, 201, lease)
      return
    }
    if (method === 'GET' && path === '/v1/leases') {
      sendJson(res, 200, { leases: [...service.state.leases.values()] })
      return
    }
    const renewMatch = /^\/v1\/leases\/([^/]+)\/renew$/.exec(path)
    if (method === 'POST' && renewMatch) {
      sendJson(res, 200, service.renewLease(ctx.actor, renewMatch[1]!, asNumber(body.ttlSeconds) ?? 900, ctx.mandate))
      return
    }
    const deleteMatch = /^\/v1\/leases\/([^/]+)$/.exec(path)
    if (method === 'DELETE' && deleteMatch) {
      service.releaseLease(ctx.actor, deleteMatch[1]!, 'released', ctx.mandate)
      sendJson(res, 200, { ok: true })
      return
    }

    if (method === 'POST' && path === '/v1/memory') {
      const fragment = service.writeMemory(
        ctx.actor,
        {
          kind: body.kind as never,
          topic: String(body.topic ?? ''),
          text: String(body.text ?? ''),
          visibility: body.visibility as never,
          namespace: String(body.namespace ?? 'team'),
          provenance: body.provenance as never,
          supersedes: body.supersedes ? String(body.supersedes) : null,
        },
        ctx.mandate,
      )
      sendJson(res, 201, fragment)
      return
    }
    if (method === 'GET' && path === '/v1/memory/search') {
      const results = service.searchMemory(ctx.actor, url.searchParams.get('q') ?? '', {
        kind: (url.searchParams.get('kind') as never) ?? undefined,
        limit: Number(url.searchParams.get('limit') ?? 20),
      })
      sendJson(res, 200, { results })
      return
    }
    if (method === 'GET' && path === '/v1/memory/conflicts') {
      sendJson(res, 200, { conflicts: service.memoryConflicts() })
      return
    }

    if (method === 'POST' && path === '/v1/approvals') {
      const approval = service.requestApproval(ctx.actor, {
        action: String(body.action ?? ''),
        resource: String(body.resource ?? ''),
        mandateId: ctx.mandate?.id ?? (body.mandateId ? String(body.mandateId) : null),
        ttlSeconds: asNumber(body.ttlSeconds),
        requiredRole: body.requiredRole as Role | undefined,
      })
      sendJson(res, 201, approval)
      return
    }
    if (method === 'GET' && path === '/v1/approvals') {
      sendJson(res, 200, { approvals: [...service.state.approvals.values()] })
      return
    }
    const approveMatch = /^\/v1\/approvals\/([^/]+)\/resolve$/.exec(path)
    if (method === 'POST' && approveMatch) {
      const approval = service.resolveApproval(ctx.actor, approveMatch[1]!, Boolean(body.approve), String(body.reason ?? ''))
      sendJson(res, 200, approval)
      return
    }
    const consumeMatch = /^\/v1\/approvals\/([^/]+)\/consume$/.exec(path)
    if (method === 'POST' && consumeMatch) {
      service.consumeApproval(
        ctx.actor,
        consumeMatch[1]!,
        String(body.action ?? ''),
        String(body.resource ?? ''),
        ctx.mandate?.id ?? null,
      )
      sendJson(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && path === '/v1/events') {
      const since = Number(url.searchParams.get('since') ?? 0)
      const types = (url.searchParams.get('types') ?? '').split(',').map((item) => item.trim()).filter(Boolean)
      sendJson(res, 200, { events: service.eventsSince(since, types) })
      return
    }
    if (method === 'GET' && path === '/v1/audit/verify') {
      sendJson(res, 200, service.audit())
      return
    }
    if (method === 'GET' && path === '/v1/state') {
      sendJson(res, 200, {
        name: workspace.config.name,
        policyVersion: service.state.policy.version,
        principals: service.state.principals.size,
        tasks: [...service.state.tasks.values()],
        launches: [...service.state.launches.values()].slice(-20),
        leases: [...service.state.leases.values()].filter((lease) => lease.endedAt === null),
        approvals: [...service.state.approvals.values()].filter((approval) => approval.status === 'pending'),
        events: service.state.lastSeq,
      })
      return
    }

    raise('not_found', `No route for ${method} ${path}`, 404)
  }

  function contextFor(req: IncomingMessage): RequestContext {
    const token = bearer(req)
    const actor = workspace.service.authenticate(token)
    takeToken(limiter, actor.principal.id)
    const mandate = workspace.service.resolveMandate(req.headers['x-teamplane-mandate'] as string | undefined, actor)
    return { actor, mandate }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actualPort}`
  if (!options.quiet) {
    process.stderr.write(`teamplane: listening on ${url}\n`)
  }

  return {
    server,
    url,
    close: async () => {
      clearInterval(sweep)
      workspace.log.off('event', onEvent)
      for (const client of clients) client.res.end()
      clients.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

function takeToken(limiter: ReturnType<typeof rateLimiterFromEnv>, key: string): void {
  const result = limiter.take(key)
  if (!result.ok) {
    fail('rate_limited', `Rate limit exceeded; retry in ${Math.ceil(result.retryAfterMs / 1000)}s.`, 429, {
      retryAfterMs: result.retryAfterMs,
      remaining: result.remaining,
    })
  }
}

function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
  return undefined
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item))
}

function asNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.method === 'GET' || req.method === 'DELETE') return {}
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY) fail('body_too_large', 'Request body exceeds 1 MiB.', 413)
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  return parseJson<Record<string, unknown>>(text, 'request body')
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.end()
    return
  }
  if (error instanceof TeamplaneError) {
    if (error.code === 'rate_limited') {
      const retryAfter = Number((error.details as { retryAfterMs?: number } | null)?.retryAfterMs ?? 1000)
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfter / 1000))))
    }
    sendJson(res, error.status, { error: { code: error.code, message: error.message, details: error.details ?? null } })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  sendJson(res, 500, { error: { code: 'internal_error', message, details: null } })
}

function writeSse(res: ServerResponse, event: string, data: unknown, id?: number): void {
  const prefix = id === undefined ? '' : `id: ${id}\n`
  res.write(`${prefix}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function serveStatic(path: string, res: ServerResponse): void {
  const relative = path === '/' ? 'index.html' : path.replace(/^\/+/, '')
  const target = normalize(join(WEB_ROOT, relative))
  if (!target.startsWith(normalize(WEB_ROOT))) {
    sendJson(res, 403, { error: { code: 'forbidden', message: 'Path traversal is not allowed.' } })
    return
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    sendJson(res, 404, { error: { code: 'not_found', message: `No static file ${path}` } })
    return
  }
  const type = contentType(extname(target))
  const content = readFileSync(target)
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': content.length,
    'Cache-Control': 'no-cache',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  res.end(content)
}

function contentType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    default:
      return 'application/octet-stream'
  }
}
