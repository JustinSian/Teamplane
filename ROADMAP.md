# Roadmap

From "working reference implementation" to "team product people star and use". Each phase has an exit criterion, not a date-only promise.

## v0.1 — the reference implementation (shipped)

- Multi-principal identity, Ed25519 mandates, deterministic policy, typed leases.
- Curated memory with ACLs, provenance, secret rejection, conflict events.
- One-shot approvals, merge gate, hash-chained event log.
- CLI, HTTP + SSE, console, MCP (stdio + HTTP), DSH guard (experimental).
- Playground seed, executable demo, 24 tests, GitHub Action, Pages site.

**Exit:** `npm test`, `npm run demo`, `npm run mcp:smoke` pass; a stranger can run the playground in under three minutes.

## v0.2 — the product surface (next, 2–4 weeks)

**Goal:** a team can onboard without the author in the room.

- [ ] **Dispatch**: `task start --launch dsh` starts the runtime in the worktree, records the session id, streams its events; generic `--exec` for other runtimes.
- [ ] **Guard in the loop**: install `dsh-teamplane-guard` in a real profile; record an intercepted write as an event; document the exact steps.
- [ ] **Console completeness**: issue mandate, edit policy, start task, resolve approvals with a comment; keyboard-free onboarding.
- [ ] **Operability**: log rotation and segmentation, per-principal rate limits, `/healthz` detail page, TLS reverse-proxy guide.
- [ ] **SSE resume** with `Last-Event-ID`; polling fallback.
- [ ] **npm publish** + `npx teamplane playground`; signed release artifacts.
- [ ] **CI green on the public repo**; Pages deployed; social preview set.

**Exit:** a new team creates a workspace, invites two members, starts two agents and merges a change without editing a config file by hand.

## v0.3 — team truth (4–8 weeks)

- [ ] **GitHub App**: PRs as channels, review comments as triggers, the merge gate as a required check.
- [ ] **Memory review**: `memory.pending` → approver → shared; conflict resolution UI.
- [ ] **Policy simulator**: replay a policy change over historical events and list flipped decisions.
- [ ] **Benchmark**: reproduce the disjoint-file conflict rate on a synthetic concurrent-agent corpus; publish method + numbers, including negative results.
- [ ] **Mandate DAG** with revocation cascade; per-edge constraints.
- [ ] **External deployment**: one team, four weeks, a written report.

**Exit:** an outside team runs it for a month and publishes what broke.

## v1.0 — the stability contract

- Frozen event schema + migrations.
- Security review, threat model signed off, no open high findings.
- Multi-node projection (SQLite/Postgres) behind the same event log.
- Documented backup/restore and key rotation.
- Two independent deployments.

## Star milestones (distribution, not features)

1. **Launch post**: the thesis + the 30-second console screenshot + the playground command.
2. **Show HN / r/ExperiencedDevs / Lobsters**: "We replaced the supervisor agent with signed mandates."
3. **DeepSeek Harness community**: the guard + MCP config as a first-class integration.
4. **A benchmark post**: "47% of agent conflicts happen in files nobody edited — here is what we measured."
5. **A failure post**: what broke when a real team used it. Trust compounds faster than features.

## Non-goals

- A model, a chat UI, or a general agent runtime.
- Multi-tenant SaaS billing in the OSS core.
- Semantic code review (the gate runs checks; it does not have taste).
- An omniscient supervisor. That is the thing this project exists to replace.
