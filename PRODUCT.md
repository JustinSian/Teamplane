# Product definition

## One line

**Teamplane is the control plane that lets several humans and their agents work in one repository without sharing a brain, a token, or a chat history.**

## Who it is for

- A 5–30 person engineering team already using coding agents (DSH, Claude Code, Cursor, Codex).
- A platform/security lead who has to answer: *which agent did what, under whose authority, and can we prove it?*
- An open-source maintainer whose contributors run agents against the same repo.

Not for: a single developer with one agent (use the agent), or a company that wants a hosted SaaS with SSO on day one (wait for v1).

## The job

> "Three agents are editing the same repo. I need them to stop stepping on each other, I need to know who authorised each change, and I refuse to give one supervisor agent every credential and every transcript."

Today's options are bad:

| Option | Why it fails |
|---|---|
| One agent, more subagents | all authority and context in one process; one session bottleneck |
| Supervisor agent watching everything | over-privileged, unauditable, one prompt injection from disaster |
| PRs + CODEOWNERS only | no task-scoped authority, no lease, no machine-checkable provenance |
| A chat bot per user | no shared coordination; everyone re-explains the repo |

## Product principles

1. **Mandates, not omniscience.** Authority is a signed, narrow, expiring capability bound to one principal and one task.
2. **Deterministic gates, not model judgement.** The model may propose; the policy engine, mandate verifier and lease manager decide. None of them calls a model.
3. **Events, not transcripts.** Coordination uses typed events and curated memory fragments. The team sees conclusions, not conversations.
4. **Honest boundaries.** The product says what it does not enforce. A security tool that overstates its reach is worse than none.
5. **One command to see it.** If the first five minutes are a setup guide, the project is dead.

## Core journeys

### A. First run (target: 60 seconds)

```bash
npm install && npm run build && npm link
teamplane playground --open
```

A seeded team appears: four tasks, two live leases, one pending approval, a memory store, a live event feed. The visitor can click **Approve** and watch the event stream change.

### B. Daily work

1. Lead creates a task and issues a mandate for one agent, one path, one hour.
2. Agent calls `tp_task_start`, gets a worktree and a mandate token.
3. Agent acquires a lease before touching a file; a second agent gets a `409` with the holder and expiry.
4. Agent submits: leases → `merge-tree` → verification commands → merge.
5. The event log records every decision; `audit verify` proves the chain.

### C. Review and incident

1. A force push returns `ask`; the owner approves once in the console.
2. The approval is consumed; a replay returns `ask` again.
3. A denied action appears in the feed with the rule id and reason.
4. `teamplane audit export` gives an append-only record for the postmortem.

## Surfaces

| Surface | Role | Status |
|---|---|---|
| CLI | setup, scripted flows, CI | shipped |
| HTTP + SSE | the only authority; every client uses it | shipped |
| Web console | human review, approvals, tasks | partial |
| MCP | agent tools (DSH, Claude Code, Cursor, Codex) | shipped |
| GitHub Action | audit verification in CI | shipped |
| DSH host guard | local write enforcement | experimental |

## Metrics

**Activation** (does the promise land?)

- `playground` started / `npm run demo` completed per week.
- Time from clone to first approval click (target < 3 minutes).
- README → quickstart → demo conversion (GitHub traffic, best effort).

**Usage** (is it a product?)

- Weekly active teams (≥ 2 principals with ≥ 1 task).
- Leases acquired per active team per week.
- Approvals resolved; median approval latency.
- Submits gated per week; conflicts caught before merge.
- Memory fragments read per task (reuse, not hoarding).

**Trust** (is it safe?)

- `audit verify` failures (target: zero unexplained).
- Denied actions per 100 authorised actions.
- Time to revoke a compromised mandate.

**Stars are a lagging indicator.** They follow the thesis, the demo, and the first external deployment — not a badge campaign.

## Why this can be a star project

1. **A thesis people repeat.** "Your agents share a repo, not a brain." It is contrarian (against the supervisor-agent fashion) and concrete.
2. **A visual payoff.** The console shows leases, approvals and a live event feed — a screenshot that explains the product in two seconds.
3. **A one-command demo.** No model keys, no Docker, no cloud account.
4. **A real protocol.** Ed25519 mandates, typed leases, hash-chained events: something engineers can review and extend.
5. **Honest limits.** `STATUS.md` and the threat model make it trustworthy; overclaiming is how infra projects lose stars.
6. **Integration surface.** MCP means it plugs into the tools people already use; the GitHub Action puts it in CI.
7. **A roadmap with a product spine.** Playground → guard → dispatch → GitHub App → benchmark.

## Positioning

| | Authority | Coordination | Memory | Audit | Open |
|---|---|---|---|---|---|
| Single agent + subagents | one process | none | session | logs | n/a |
| Supervisor agent | one over-privileged agent | central | shared transcript | generated rationale | varies |
| Dust ("multiplayer AI") | workspace permissions | shared workspace | team memory | enterprise audit | no |
| Tencent Team Memory | role permissions | none | team memory | traceable | SDK |
| **Teamplane** | **signed per-task mandates** | **typed leases + merge gate** | **ACL + provenance** | **hash-chained events** | **MIT** |

Teamplane does not try to be a workspace, a chat product, or a model. It is the authority and coordination layer those products lack.

## Business model (later)

MIT core, self-hosted. A paid team edition can add SSO, a hosted control plane, long-term audit retention and policy simulation. No feature in the OSS core may depend on the hosted service.

## Risks

| Risk | Mitigation |
|---|---|
| "Yet another agent framework" fatigue | lead with the control-plane thesis, not another orchestrator |
| Demo looks like a dashboard, not a protocol | show the mandate token and the audit chain in the README |
| Security claims outrun implementation | STATUS.md, threat model, fail-closed defaults |
| Single-node toy | be explicit; ship dispatch and rotation before 1.0 |
| Maintainer bandwidth | small surface, zero dependencies, tests as the contract |

## Definition of a 1.0 product

- One command to a seeded team, and one command to a real team.
- A real agent dispatched into a worktree, with its session recorded as events.
- The guard installed and verified in at least one live runtime.
- Log rotation, rate limits, TLS guidance, health page.
- An independent benchmark for conflict interception.
- One external team running it for four consecutive weeks.
- A security review with no open high-severity findings.
