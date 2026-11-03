# Changelog

## 0.2.1 — 2026-11-03

### Added

- **Dispatch**: `teamplane task launch <task-id> -- dsh` starts a runtime inside the task worktree with `TEAMPLANE_URL`, `TEAMPLANE_TASK` and the mandate from `.teamplane/context.json`; records a `task.launched` event with the command and pid. `--detach` for background workers. `TEAMPLANE_URL` now works without a local workspace, so the CLI can drive a remote control plane.
- **SSE resume**: event frames carry `id: <seq>`; reconnecting clients send `Last-Event-ID` (or `?since=`) and the server replays the gap before resuming live delivery.
- `POST /v1/tasks/:id/launched` and launch records in `/v1/state`.

### Changed

- Version 0.2.1; tests remain 24/24.

## 0.2.0 — 2026-11-03

The product surface release. Everything in 0.1.0 still holds; this adds the path from "clone" to "a team I can act on".

### Added

- **`teamplane playground`**: seeds a realistic team (4 tasks, 3 principals, 2 live leases, 3 memory fragments, 1 pending approval, a real denial) and serves the console on one command. `--open` launches the browser, `--keep` preserves the temp workspace.
- **Console write actions**: approve/reject pending approvals, create tasks, token-in-URL onboarding, snapshot mode for screenshots.
- **Dispatch**: `teamplane task launch <id> -- dsh` starts a runtime in the task worktree with `TEAMPLANE_URL`/`TEAMPLANE_MANDATE`, records a `task.launched` event and the pid; `--detach` for background runs.
- **SSE resume**: the stream sends `id: <seq>` and replays from `Last-Event-ID` or `?since=`.
- **GitHub Action** (`action.yml`): fail-closed audit-chain verification for CI.
- **Landing page** (`site/`) and **Pages workflow**; social preview and real console screenshots.
- **Release workflow**: tests, demo, MCP smoke, npm pack, git bundle, GitHub Release on tags.
- **Product docs**: `STATUS.md` (readiness + evidence + not-evaluated), `PRODUCT.md` (personas, journeys, metrics), `ROADMAP.md`, `docs/why.md`, `docs/comparison.md`.
- **Examples**: DSH MCP patch, strict policy, GitHub Actions verification.
- **Screenshot tooling** (`scripts/screenshot.mjs`) using the DevTools protocol, no browser dependency in the package.

### Fixed

- The console gate stayed visible over the app because author CSS overrode the `hidden` attribute. Real screenshot testing caught it; `[hidden] { display: none !important; }` fixes it.
- Force-push is no longer in the DSH guard's default deny list: the guard is synchronous and cannot consult an approval. It is configurable via `guard.json`.

### Changed

- Version bumped to 0.2.0; status badges and docs point at the new release.
- Test count 23 → 24 (playground integration).

## 0.1.0 — 2026-11-03

First public, research-grade release.

### Added

- **Identity & authority**: principals (user/agent/service), roles, one-time tokens stored as SHA-256, Ed25519 mandates with decidable attenuation and offline verification.
- **Deterministic policy**: JSON rules, `deny > ask > allow > default deny`, conditions, obligations, `policy explain`.
- **Coordination**: tasks, typed leases (`file:`, `dir:`, `branch:`, `memory:`) with containment, TTL, renewal, fencing tokens and conflict details.
- **Memory**: curated fragments with `kind`, `topic`, visibility, provenance, secret rejection, ACL-filtered search and `memory.conflict` events.
- **Approvals**: single-use, action-hash-bound, expiring, self-approval denied.
- **Merge gate**: changed-file lease coverage, `git merge-tree --write-tree`, verification commands, optional `--no-ff` merge.
- **Audit**: append-only JSONL event log, hash chain, replay verification, snapshots.
- **Interfaces**: CLI, HTTP + SSE, web console, MCP over stdio and Streamable HTTP (10 tools), `dsh print-config`.
- **DSH guard** (experimental): synchronous `ctx.tools.guard` enforcing mandate paths, worktree boundary, protected `.teamplane/` and denied shell commands.
- **Demo**: reproducible three-principal scenario with a pass/fail report.
- **Docs**: architecture, threat model, design notes, policy, API, MCP, DSH, roadmap.

### Known limitations

- Single process, single writer, O(n) replay at startup.
- One parent per derived mandate (no DAG).
- No rate limiting.
- Host-level enforcement requires the guard plugin; the merge gate is the authoritative control.
- No GitHub App; local or shared bare repositories only.
