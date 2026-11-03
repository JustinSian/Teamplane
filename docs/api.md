# HTTP API

Base URL: `http://127.0.0.1:7317` (configurable). All endpoints are JSON.

## Authentication

```
Authorization: Bearer tp_...
X-Teamplane-Mandate: <signed token>   # for work actions
```

Principal tokens are printed once by `init` / `user add`, stored only as SHA-256. The mandate is required by any rule whose obligations include `requireMandate`.

## Errors

```json
{ "error": { "code": "lease_conflict", "message": "Resource file:src/auth.ts is held by mnd_... until ...", "details": [...] } }
```

| Status | Meaning |
|---|---|
| 401 | missing or unknown token |
| 403 | policy/mandate denial, signature failure, subject mismatch |
| 404 | unknown id/route |
| 409 | lease conflict, approval not pending, already merged |
| 410 | lease/approval expired |
| 422 | validation error (policy, memory, body) |
| 428 | approval required (`ask`) |
| 413 | body over 1 MiB |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | liveness (no auth) |
| GET | `/v1/me` | current principal, roles, mandate claims |
| POST | `/v1/principals` | create user/agent/service |
| GET | `/v1/principals` | list principals with roles |
| POST | `/v1/roles/grant` | grant a role (owner only) |
| GET | `/v1/policy` | current policy |
| PUT | `/v1/policy` | replace policy (version increments) |
| POST | `/v1/policy/explain` | explain a decision, no side effects |
| POST | `/v1/authorize` | check-only decision (records denials) |
| POST | `/v1/mandates` | issue a mandate |
| POST | `/v1/mandates/:id/derive` | attenuate a mandate |
| POST | `/v1/mandates/:id/revoke` | revoke (owner) |
| GET | `/v1/mandates` | list mandates |
| POST | `/v1/tasks` | create a task |
| GET | `/v1/tasks` | list tasks |
| POST | `/v1/tasks/:id/start` | create worktree + context |
| POST | `/v1/tasks/:id/submit` | leases + merge-tree + verify + merge |
| POST | `/v1/leases` | acquire |
| GET | `/v1/leases` | list |
| POST | `/v1/leases/:id/renew` | renew (holder) |
| DELETE | `/v1/leases/:id` | release (holder/owner) |
| POST | `/v1/memory` | write a curated fragment |
| GET | `/v1/memory/search?q=` | ACL-filtered search |
| GET | `/v1/memory/conflicts` | recorded contradictions |
| POST | `/v1/approvals` | request approval |
| GET | `/v1/approvals` | list |
| POST | `/v1/approvals/:id/resolve` | approve/reject |
| POST | `/v1/approvals/:id/consume` | mark an approval used |
| GET | `/v1/events?since=&types=` | structured events |
| GET | `/v1/stream?token=&types=` | SSE stream |
| GET | `/v1/audit/verify` | hash-chain verification |
| GET | `/v1/state` | console summary |
| POST | `/mcp` | MCP over Streamable HTTP |

## Examples

### Issue a mandate

```bash
curl -s http://127.0.0.1:7317/v1/mandates \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "subject": "usr_bob",
    "task": "tsk_123",
    "paths": ["src/auth.ts"],
    "actions": ["fs.read", "fs.write", "lease.acquire", "task.submit"],
    "branches": ["tp/tsk_123"],
    "memory": ["team/auth"],
    "ttlSeconds": 3600
  }'
```

Response: `{ "mandate": {...}, "token": "eyJ2Ijox..." }`. The token is shown once per issue call (the server stores the signed record, not a secret).

### Acquire a lease

```bash
curl -s http://127.0.0.1:7317/v1/leases \
  -H "authorization: Bearer $BOB_TOKEN" \
  -H "x-teamplane-mandate: $BOB_MANDATE" \
  -H 'content-type: application/json' \
  -d '{"key":"file:src/auth.ts","mode":"exclusive","task":"tsk_123","ttlSeconds":900}'
```

Conflict:

```json
{
  "error": {
    "code": "lease_conflict",
    "message": "Resource file:src/auth.ts is held by mnd_... until 2026-11-03T04:42:36.645Z.",
    "details": [{ "id": "les_...", "holder": "mnd_...", "expiresAt": "...", "mode": "exclusive" }]
  }
}
```

### Authorize a write

```bash
curl -s http://127.0.0.1:7317/v1/authorize \
  -H "authorization: Bearer $CAROL_TOKEN" \
  -H "x-teamplane-mandate: $CAROL_MANDATE" \
  -H 'content-type: application/json' \
  -d '{"action":"fs.write","resource":"file:src/auth.ts"}'
```

```json
{ "decision": "deny", "ruleId": "agent-write", "reason": "Path src/auth.ts is outside the mandate paths.", ... }
```

### Submit

```bash
curl -s http://127.0.0.1:7317/v1/tasks/tsk_123/submit \
  -H "authorization: Bearer $BOB_TOKEN" \
  -H "x-teamplane-mandate: $BOB_MANDATE" \
  -H 'content-type: application/json' \
  -d '{"verify":["npm test"],"merge":true}'
```

```json
{
  "ok": true,
  "taskId": "tsk_123",
  "changedFiles": ["src/auth.ts"],
  "conflicts": [],
  "verify": [{ "command": "npm test", "ok": true, "code": 0, "output": "..." }],
  "merged": true,
  "reason": "Merged into the base branch."
}
```

`ok: false` is a normal gate outcome (HTTP 200); inspect `conflicts`, `verify` and `reason`.

### Stream events

```bash
curl -N "http://127.0.0.1:7317/v1/stream?token=$TOKEN&types=lease.,approval.,submit."
```

```
event: hello
data: {"at":"...","types":["lease.","approval.","submit."]}

event: event
data: {"seq":42,"type":"lease.denied",...}
```

## Idempotency and concurrency

- Appends are serialised by the single-writer event log.
- Leases are the concurrency primitive; there is no transaction spanning two leases. Acquire in a deterministic order to avoid livelock.
- `submit` is not idempotent by key in v0.1; a repeated submit re-runs the gate and re-records events. Use task status to avoid duplicates.
