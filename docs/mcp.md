# MCP integration

Teamplane exposes its control plane as a Model Context Protocol server. Any MCP-capable runtime can use it; DeepSeek Harness is the reference.

## Transports

| Transport | How | When |
|---|---|---|
| stdio | `teamplane mcp` | one local control plane per developer, or a quick trial |
| Streamable HTTP | `POST http://127.0.0.1:7317/mcp` | one shared control plane for a team, per-user tokens |

Protocol revision: `2026-07-28` (the server also answers older clients' `initialize`; tool calls are transport-independent).

## Configuration

The stdio server reads:

| Variable | Meaning |
|---|---|
| `TEAMPLANE_URL` | control-plane base URL (or `.teamplane/context.json`'s `server`) |
| `TEAMPLANE_TOKEN` | principal token |
| `TEAMPLANE_MANDATE` | optional mandate token (otherwise the worktree context's mandate) |

The HTTP endpoint uses the `Authorization: Bearer` header and an optional `X-Teamplane-Mandate` header on each request.

## Tools

| Tool | Arguments | Calls |
|---|---|---|
| `tp_whoami` | — | `GET /v1/me` |
| `tp_task_start` | `taskId`, `mandateId?` | `POST /v1/tasks/:id/start` |
| `tp_lease_acquire` | `key`, `mode?`, `task`, `ttlSeconds?` | `POST /v1/leases` |
| `tp_lease_release` | `leaseId` | `DELETE /v1/leases/:id` |
| `tp_memory_put` | `kind`, `topic`, `text`, `visibility?`, `namespace?` | `POST /v1/memory` |
| `tp_memory_search` | `query`, `kind?`, `limit?` | `GET /v1/memory/search` |
| `tp_approval_request` | `action`, `resource`, `ttlSeconds?` | `POST /v1/approvals` |
| `tp_events_poll` | `since?`, `types?` | `GET /v1/events` |
| `tp_submit` | `taskId`, `verify?`, `merge?` | `POST /v1/tasks/:id/submit` |
| `tp_policy_explain` | `action`, `resource` | `POST /v1/policy/explain` |

Results are JSON text content plus `structuredContent`. A denied action is a tool error (`isError: true`) whose text is the control plane's reason — not a protocol error. Protocol errors are reserved for unknown tools and malformed calls.

## Example session

```
→ {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28"}}
← {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2026-07-28","capabilities":{"tools":{}},"serverInfo":{"name":"teamplane","version":"0.5.0"}}}

→ {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tp_lease_acquire","arguments":{"key":"file:src/auth.ts","task":"tsk_123"}}}
← {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"id\":\"les_...\"}"}],"isError":false}}
```

## What MCP does and does not enforce

MCP is a **tool surface**, not a security boundary. The model can choose not to call `tp_lease_acquire`. Enforcement lives in:

1. the control plane (leases, mandates, submit gate) — always enforced for API calls;
2. the optional host guard (`dsh-plugin/`) — enforced for file-write tool calls;
3. branch protection on the remote — the last line.

Do not treat "the agent has the tool" as "the agent is constrained". See [threat-model.md](threat-model.md#T5).

## Testing

```bash
npm run mcp:smoke
```

The smoke test starts a control plane, spawns the stdio server, performs `initialize`, `tools/list`, `tools/call tp_whoami`, then does the same over Streamable HTTP.
