# Status

**Version:** 0.5.2 · **Date:** 2026-11-03 · **Maturity:** research preview

Teamplane is a working reference implementation of a multi-principal control plane for agent teams. It is not a finished product. This page is the honest matrix: what is shipped, what is partial, what is not built, and what has actually been measured.

## Readiness

| Area | Status | Notes |
|---|---|---|
| Multi-principal identity | **Shipped** | users/agents/services, roles, one-time tokens stored as SHA-256 |
| Signed mandates | **Shipped** | Ed25519, decidable attenuation, offline verification, revocation events |
| Deterministic policy | **Shipped** | JSON rules, deny > ask > allow, default deny, explain |
| Typed leases | **Shipped** | `file:`, `dir:`, `branch:`, `memory:`, fencing, TTL, renewal |
| Curated memory | **Shipped** | ACL projection, provenance, secret rejection, conflict events |
| Approvals | **Shipped** | role derived from the policy rule, one-shot, action-hash-bound, consumed atomically, self-approval denied |
| Merge gate | **Shipped** | lease coverage + `git merge-tree` + task-bound verification + base-branch authorisation + optional merge |
| Audit log | **Shipped** | append-only JSONL, SHA-256 chain, replay verification; snapshots are never trusted |
| CLI | **Shipped** | init, principals, mandates, tasks, leases, memory, approvals, submit, audit |
| HTTP + SSE | **Shipped** | REST + live events + static console |
| npm package | **Not published** | install from source (`npm install && npm run build && npm link`); the MCP row uses the local `teamplane` binary |
| Web console | **Shipped (core admin)** | views, approve/reject, create task, issue mandate, revoke mandate, start task, apply policy |
| MCP | **Shipped** | stdio + Streamable HTTP, 10 tools |
| DSH host guard | **Verified at the pipeline level** | runs inside the real `@deepseek-ai/dsh-tools` `ToolRuntime` pipeline; a denied write returns a tool error. Not yet exercised inside a full DSH session. |
| GitHub Action | **Shipped** | audit verification composite action |
| Playground | **Shipped** | one command seeds a team and serves the console |
| Dispatch | **Partial** | `task launch <id> -- dsh` spawns a runtime in the worktree and records a launch event; no session streaming or automatic assignment |
| GitHub App / PR integration | **Not built** | local or shared bare repositories only |
| Multi-node / HA | **Not built** | single process, single writer |
| Memory review workflow | **Not built** | anyone with `memory.write` can publish; conflicts are events, not approvals |
| Log rotation | **Shipped** | segments of 10,000 events under `.teamplane/archive/`, configurable with `TEAMPLANE_SEGMENT_EVENTS`; replay and audit span segments |
| Rate limiting | **Shipped** | per-principal **and per-IP** token bucket, 120 burst / 2 per second by default, `Retry-After` |
| TLS | **Not built** | bind to loopback or terminate TLS in front; Caddy example in `docs/deployment.md` |
| Container recipe | **Shipped** | multi-stage `Dockerfile`, `docker-compose.yml`, loopback port, keys volume |
| SSO / identity federation | **Not built** | external identities are provenance strings |
| `maxWrites` | **Enforced (authorisation)** | counts successful `fs.write` authorisations per mandate; raw writes outside the control plane are not observed |
| Key isolation | **Shipped (default)** | signing keys live in `~/.teamplane/keys/<workspace-id>/`, not the repo; host/container isolation is still the operator's job |
| Memory at rest | **Shipped** | text lives in `.teamplane/memory/<id>.json` (0600), sealed with AES-256-GCM from the signing key; the key holder can still decrypt |
| Repository roots | **Shipped** | `task.create` rejects paths outside the workspace or `TEAMPLANE_REPO_ROOTS` |
| SSE tickets | **Shipped** | `POST /v1/stream-ticket` issues a 30 s single-use ticket; `?token=` remains as legacy |

## Evidence

| Claim | Evidence |
|---|---|
| Coordination invariants hold | `npm test` — **34/34** passing |
| End-to-end behaviour | `npm run demo` — **16/16** steps, 2.7 s, report in `demo/out/` |
| MCP works on both transports | `npm run mcp:smoke` — 10 tools, stdio + HTTP |
| Package is installable | `npm pack` + install into a clean prefix; CLI runs |
| Event log is tamper-evident | unit test mutates one byte and expects a hash mismatch |
| One winner per contended lease | 50 concurrent requests: **1 × 201, 49 × 409** |
| Distinct resources do not block each other | 50 concurrent distinct keys: **50 × 201** |
| Decision latency | `/v1/authorize` **0.59 ms/call** on loopback (not a capacity claim) |
| Dispatch works | `task launch <id> -- node -e ...` runs in the worktree with `TEAMPLANE_TASK` and records a launch event |
| Action works | the composite action’s bash/node steps were run against a live control plane: `status=200 events=23 ok=true` |
| CI is green | `ci`, `pages`, `security` and `release` pass on `main` in the public repository |
| Guard works in the real DSH pipeline | `test/integration/dsh-runtime.test.mjs` mounts `@deepseek-ai/dsh-tools` `ToolRuntime`, registers the guard, and asserts a denied write returns a tool error |
| Lease trade-off is measured | `npm run bench`: 30/30 conflict recall, 30/30 false positives on clean same-file edits; the merge gate is 0/30 on those |
| Security regressions are tested | approval-role forgery, body-supplied verify, private-memory event leak, forged snapshot, cross-task mandate and unauthenticated rate limiting each have a test |
| Coverage | **81.2% lines / 71.4% branches / 79.5% functions** (Node experimental coverage) |

Reproduce:

```bash
npm run build && npm test
npm run demo
npm run mcp:smoke
teamplane playground --open
```

## Not evaluated

These are the gaps that separate "works on my machine" from "product":

- **No real agent loop.** The demo's three "agents" are API clients, not DSH/Claude/Cursor sessions. Dispatch was exercised with `node`, not with a live DSH/Claude/Cursor runtime.
- **No multi-machine test.** All measurements are one Node process over loopback.
- **No soak or chaos test.** No 24-hour run, no kill -9 recovery test beyond unit-level replay.
- **No adversarial security test.** Prompt injection, token theft, lease bypass and memory inference are analysed in the threat model, not red-teamed.
- **No independent benchmark.** The 47.3% disjoint-file conflict figure is cited from MERGEGYM, not reproduced here.
- **No user study.** Nobody outside the author has run a real team on it.

## What "product" requires next

1. **Activation** — `teamplane playground` and a 60-second path to a visible team. *(shipped in this preview)*
2. **Dispatch** — launch an agent in a worktree, or connect a remote daemon, and record its session.
3. **Guard in the loop** — install and verify the DSH guard in a real profile.
4. **Console completeness** — issue mandates, edit policy, start tasks from the UI.
5. **Operability** — log rotation, rate limits, TLS guidance, health page.
6. **Independent evidence** — a conflict-interception benchmark and one external team deployment.

See [ROADMAP.md](ROADMAP.md) and [PRODUCT.md](PRODUCT.md).

## How to read the claims

Every number above has a command or a test behind it. If a claim is not in this file or in `demo/out/report.md`, treat it as a design intention, not a measurement.
