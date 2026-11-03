# Roadmap

v0.1 is deliberately narrow: one process, one writer, one repository per task, CLI + HTTP + MCP. The domain model is the part intended to last.

## v0.2 — operability

- **Log rotation and segmentation.** Replay is O(n); segmented logs with periodic signed heads make it O(recent).
- **Rate limiting and request quotas** per principal.
- **Memory review workflow.** `memory.pending` → approver → `memory.written`, for teams that want four-eyes on shared conclusions.
- **Mandate DAG.** Multiple parents, revocation cascade (DelegateGuard-style), per-edge constraints.
- **Structured audit export** (OpenTelemetry logs) and a signed daily head hash.
- **SSE resume** with `Last-Event-ID` (currently `since` query only).

## v0.3 — team scale

- **Pluggable projections.** SQLite/Postgres behind the same event log; the JSONL store stays the reference implementation.
- **HTTP MCP sessions** with per-session auth and cancellation.
- **Remote execution daemons.** `task start --remote` dispatches to a worker machine; BYOM in the Super-agent sense, with the same mandate.
- **GitHub App adapter.** PRs as `Channel`s, review comments as `Trigger`s, branch protection as the outer gate. The merge gate becomes a required check.
- **Policy simulator.** Replay a policy change over historical events and show which decisions would flip.

## v1.0 — the stability contract

- Frozen event schema with migrations.
- Documented threat model with an external review.
- Benchmarks: conflict interception rate on a synthetic concurrent-agent corpus; approval latency; memory retrieval precision under ACLs.
- At least one deployment outside the authors' machines.

## Explicitly out of scope

- Model hosting or inference.
- A general-purpose agent runtime.
- Multi-tenant SaaS billing.
- Semantic code review. The gate runs checks; it does not have opinions about architecture.
- An omniscient supervisor. The whole point is that there isn't one.

## How to influence it

Open an issue with the scenario, not the feature. The most useful reports are "here is a real conflict/authorization failure that Teamplane did not prevent, here is the event log". Those become tests.
