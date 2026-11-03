# Changelog

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
