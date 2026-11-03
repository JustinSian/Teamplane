# Changelog

## 0.6.2 — 2026-11-03

### Added

- The console now marks seeded playground data with a **demo data** badge and a short “Seeded demo” tip, so it cannot be mistaken for the user's repository.
- A **Connect** tab renders a copy-ready DSH MCP client row (`mcp-teamplane`) using the current console origin and the `tp_*` tool note.
- Event rows use human labels (`file locked`, `approval used`, `write allowed`, …) while keeping the raw event type in the row title.
- The first-run panel has a **Create starter task** button; it creates a task with a trivial task-bound verify command so the next-step banner advances without copy/paste.

## 0.6.1 — 2026-11-03

### Added

- A server-computed **next step** is returned by `GET /v1/state` and shown as a banner at the top of the Overview: add a teammate → create a task → issue a mandate and start → work and submit → verify the audit chain, with pending approvals taking priority. This turns an empty console into a guided one.
- `teamplane init` now prints the console URL (`Then open: http://…`) after the token and key paths.
- `teamplane serve --open` opens the console in the default browser (best-effort; the URL is still printed).

### Changed

- The console Overview renders the next-step banner with a one-click **Copy** for the suggested command.
- Tests 35.

## 0.5.4 — 2026-11-03

### Added

- The Overview now shows a first-run panel when a real workspace has no tasks, leases or approvals. It lists the `user add` → `task create` → `mandate issue` → `task start` sequence and has a **Copy commands** button. This is deliberately separate from the seeded `teamplane playground` demo.
- `teamplane init` prints the key directory alongside the owner token.

## 0.5.3 — 2026-11-03

### Fixed

- The rate limiter parsed an unset `TEAMPLANE_RATE_PER_SECOND` as `0`, so a fresh server had a 120-request burst and **never refilled**. The console would eventually show `rate_limited: retry in 60s` and stay there. Unset values now use the documented default (120 burst / 2 per second); explicit values, including `0`, still work.
- Added a regression test that depletes a small bucket, waits, and requires a refill.

## 0.5.2 — 2026-11-03

### Fixed

- A fresh console no longer shows an empty **Live Events** panel. New SSE connections replay the last 20 matching events when the caller does not send `Last-Event-ID` or `?since=`; reconnects still resume from the last event id.
- The streaming integration test now connects without `since` and asserts that the backlog is delivered.

## 0.5.1 — 2026-11-03

### Added

- `docs/deployment.md`: threat-model summary, loopback/TLS guidance, backup rules (workspace **and** keys), Windows ACL commands, container layout, upgrade path, incident checklist.
- Multi-stage `Dockerfile` and `docker-compose.yml`: non-root `node` user, loopback-only published port, keys in a named volume, `git` in the runtime image, healthcheck.
- `.dockerignore` keeps local state and worktrees out of the build context.

### Changed

- README deploy section and docs index link to the deployment guide.
- Version 0.5.1; no runtime behavior change.

## 0.5.0 — 2026-11-03

### Changed

- Memory vault fragments are sealed with AES-256-GCM. The key is derived from the Ed25519 signing key with HKDF; the event log still stores only metadata + `textHash`. Existing 0.4.x plaintext vault files are re-sealed on load.
- A missing key for an encrypted fragment fails closed with `memory_key_missing`; a corrupt tag fails with `memory_corrupt`.

## 0.4.2 — 2026-11-03

### Fixed

- `limits.maxWrites` is now enforced. Each successful `fs.write` authorisation appends `write.authorized` and increments a per-mandate counter that is replayed on restart; the next call returns `deny` with a write-limit reason. The limit counts authorisations, not raw filesystem writes.
- `maxWrites` must be a non-negative integer at issuance.

## 0.4.1 — 2026-11-03

### Fixed

- Upgrading from 0.3.x now migrates `memory.written` text from the event log into the vault; search still returns the content after restart.
- `task.start` re-validates `repoPath` and `baseBranch`, so a task created before the 0.4 root restriction cannot be used to escape it.
- Tests 33 → 34 (legacy memory migration).

## 0.4.0 — 2026-11-03

The storage and isolation follow-up to 0.3.0.

### Changed

- **Signing keys moved outside the workspace.** Default: `~/.teamplane/keys/<workspace-id>/root.key`; `TEAMPLANE_KEYS_DIR` overrides. Legacy `.teamplane/keys/` is still readable. *(breaking for tooling that assumed the old path)*
- **Memory text moved out of the event log.** `memory.written` stores metadata + `textHash`; the fragment lives in `.teamplane/memory/<id>.json` (0600) and is hydrated at startup. A restart test proves search still works. *(event-format change)*
- **One-time SSE tickets**: `POST /v1/stream-ticket` returns a 30 s, single-use ticket; the console uses it. `?token=` remains as a documented legacy fallback.
- **Repository roots**: `task.create` rejects `repoPath` outside the workspace or `TEAMPLANE_REPO_ROOTS`; `baseBranch` is validated.
- Tests 31 → 33.

### Known limits

- Memory files are plaintext at rest; host access still reads them.
- Keys are outside the repo but still readable by the control-plane host user.
- `maxWrites` remains advisory.

## 0.3.0 — 2026-11-03

Security release responding to an external review. **Breaking changes** are marked.

### Fixed (P0)

- **Approval role forgery**: `POST /v1/approvals` no longer accepts `requiredRole` or `mandateId` from the body. The role comes from the matching policy rule (`obligations.approvalRole`), and a request that policy does not mark `ask` is rejected. *(breaking)*
- **Approval replay**: an approval is consumed atomically in the authorising call; `/v1/authorize` consumes by default (`consume: false` opts out), and `/v1/policy/explain` never consumes. *(breaking)*
- **Request-body verify / RCE**: verification commands are bound to the task at creation (`POST /v1/tasks` with `verify`) or changed through `POST /v1/tasks/:id/verify` by an authorised principal. `submit` rejects body-supplied commands with `422 verify_task_bound`. *(breaking)*
- **Private memory leak via events**: `GET /v1/events` and SSE redact `memory.written` content when the caller cannot read the fragment; the log still stores the fragment, which is documented.
- **Forged snapshot**: snapshots are no longer loaded. Startup always replays the hash chain; a mutated snapshot cannot create principals or roles.

### Fixed (P1)

- `mandateAllows` fails closed for unknown resource kinds; `task:` resources must match `claims.task`.
- Merging into `task.baseBranch` now requires `git.push` authorisation on `branch:<base>`; default mandates include the base branch.
- Mandate paths that normalise to `.` or `/` are rejected instead of silently matching the whole repo.
- `GET /v1/mandates` no longer returns signed tokens.
- Unauthenticated requests are rate limited by IP before token validation.
- `POST /v1/principals/:id/disable` and `teamplane user disable` now exist.
- Token comparison uses `timingSafeEqual`; static-file containment uses `path.relative`; 500 responses no longer echo internal messages.
- `events()` is cached in memory, so the event log is no longer reparsed per request.

### Changed

- Tests 29 → 31; the suite now reproduces the approval-role forgery, body-supplied verify, private-memory event leak, forged snapshot, cross-task mandate and unauthenticated rate limiting.
- Version 0.3.0. The submit CLI no longer accepts `--verify`; use `task create --verify` or `task verify`.

## 0.2.9 — 2026-11-03

### Fixed

- The DSH MCP configuration no longer tells users to run `npx -y teamplane mcp`, which fails until the package is on npm. It now uses the locally linked `teamplane mcp` command in the README, docs, example patch and `teamplane dsh print-config`.
- `STATUS.md` no longer claims CI is unverified; `ci`, `pages`, `security` and `release` are green on the public repository.

### Changed

- Version 0.2.9; tests remain 29.

## 0.2.8 — 2026-11-03

### Added

- **Secret scanning in CI**: `.github/workflows/security.yml` runs a dependency-free scanner over tracked files and full git history. It reports file/line/pattern, never the matched value.
- **Local commands**: `npm run scan:secrets` and `npm run scan:secrets:history`.
- **Hardened .gitignore**: `.env*`, `*.key`, `*.pem`, `*.p12`, `*.pfx`, `.npmrc`, `.pypirc`, `secrets/`, `id_rsa*`, `token.json`, `credentials.json`.
- The console no longer prefills a local absolute repository path, and the tasks screenshot was regenerated without it.

### Changed

- Version 0.2.8; tests remain 29; `scan:secrets` and `scan:secrets:history` are clean.

## 0.2.7 — 2026-11-03

### Added

- **Mandates tab**: list signed mandates with subject, task, paths, expiry and a one-click revoke.
- **Start a task** from the console: choose a task and an active mandate, create/reuse its worktree.
- Screenshot of the mandates tab (`docs/assets/console-mandates.png`).

### Changed

- Version 0.2.7; tests remain 29.

## 0.2.6 — 2026-11-03

### Added

- **Segmented event log**: the active `events.jsonl` rotates into `archive/events-<firstSeq>.jsonl` every 10,000 events (or `TEAMPLANE_SEGMENT_EVENTS`). The hash chain continues across segments; replay, `audit verify` and `events()` read segments in order.
- Rotation/tamper test: 10 events across 3 segments, clean replay, and a mutated archived byte rejected.

### Changed

- Tests 28 → 29; version 0.2.6.

## 0.2.5 — 2026-11-03

### Added

- **Per-principal rate limiting**: a token bucket (120 burst, 2 req/s refill) guards `/v1/*` and `/mcp`; a `429` carries `Retry-After`. Configurable with `TEAMPLANE_RATE_BURST` and `TEAMPLANE_RATE_PER_SECOND`.
- Tests 25 → 28 (burst, refill, prune).

## 0.2.4 — 2026-11-03

### Added

- **Benchmark**: `npm run bench` measures a `file:` lease against `git merge-tree` across 30 trials per mode. Result: 100% conflict recall, 100% false positives on clean same-file edits — the honest cost of a decidable lock. Method and threats to validity in `bench/README.md`.
- The benchmark ships in the npm package and the README states the trade-off.

### Changed

- Version 0.2.4.

## 0.2.3 — 2026-11-03

### Added

- **Console administration**: issue a mandate (subject, task, paths, TTL) and apply a policy revision from the web console. Both use the same API and authorisation as the CLI.
- **Console deep links**: `?tab=tasks`, `?tab=policy`, `?tab=memory`, `?tab=audit` open a tab directly; useful for screenshots and bookmarks.
- Real screenshots for the tasks/mandate and policy tabs (`docs/assets/console-tasks.png`, `docs/assets/console-policy.png`).

### Fixed

- The policy editor text was unreadable (inherited textarea colour); it now uses the theme text colour.
- The worktree column shows the task directory name instead of a truncated absolute path.

## 0.2.2 — 2026-11-03

### Verified

- The DSH guard now runs inside the **real** `@deepseek-ai/dsh-tools` `ToolRuntime` pipeline (`test/integration/dsh-runtime.test.mjs`): a write inside the mandate succeeds, a write outside it returns a tool error after the extensible pre-execute gate.
- `@deepseek-ai/dsh-tools@0.2.1-rc.5` and `@deepseek-ai/cordis@4.0.5` are pinned dev dependencies, so CI exercises the compatibility claim on every run.

### Changed

- Tests 24 → 25; version 0.2.2.

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
