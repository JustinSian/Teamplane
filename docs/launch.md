# Your agents share a repo, not a brain

*Draft launch post. Screenshots: `docs/assets/social.png`, `docs/assets/console.png`.*

---

Three agents are editing the same repository. One is refactoring auth, one is adding tests, one is fixing docs. Each is competent. Together they produce a stale branch, a duplicated investigation, a force push to `main`, and a chat log that contains the answer nobody can find.

The industry's answer is to add a supervisor: a larger agent that reads every session, remembers everything and approves every action. It demos well. It is also the most over-privileged component in the system, its reasons are generated text, and it reads the untrusted content it is supposed to police.

I built **Teamplane** on the opposite bet: coordination should be made of small, verifiable pieces.

- A **signed mandate** says who may do what, for how long, on which task.
- A **deterministic gate** decides with a pure function, not a prompt.
- A **typed lease** says who owns the file right now.
- A **hash-chained event log** lets anyone replay the decision.

No model is in the decision path. The agents keep the interesting job — planning, coding, judgement — and lose the two jobs they are worst at: being an authority and being a lock.

## The three mechanisms

**Mandates.** A mandate is an Ed25519 capability bound to one principal, one task, a set of path prefixes, actions, branches and a memory namespace. It attenuates: a derived mandate must be a strict subset of its parent, and expansion fails closed. Verification is offline; revocation is an event.

**A deterministic gate.** Policy is JSON: `deny > ask > allow > default deny`. A second gate checks the mandate, a third checks the lease for writes. Approvals are single-use, bound to an action hash, and expire. A force push to `main` is `ask`; it becomes `allow` once, then returns to `ask`.

**Events, not transcripts.** Team memory is curated fragments with provenance and visibility — never raw sessions. Coordination is a typed event stream: `lease.denied`, `approval.requested`, `submit.rejected`. The team sees conclusions, not conversations.

## What I measured

- 29 tests, including the guard running inside the **real** `@deepseek-ai/dsh-tools` `ToolRuntime` pipeline.
- A 16-step executable demo: 1 winner per contended lease, mandate denials, one-shot approvals, merge gate.
- 50 concurrent requests for the same lease: **1 × 201, 49 × 409**. 50 distinct keys: **50 × 201**.
- 0.59 ms per authorization decision on loopback — not a capacity claim.
- A benchmark of the lease itself: a `file:` lease caught **30/30** textual conflicts, and also blocked **30/30** clean same-file edits. That is the honest cost of a decidable lock. The merge gate is the precise check; the lease is the cheap early signal.

## What I did not measure

No real model loop, no multi-machine soak, no red team, no independent benchmark, no external team. The 47% disjoint-file conflict figure people cite comes from MERGEGYM, not from me. `STATUS.md` lists every gap.

## Why not a supervisor agent?

A supervisor has three properties no prompt fixes: it is a single point of failure, it is a confused deputy (it holds credentials for everything), and it is unauditable ("the supervisor decided" is not a reason a security review accepts).

Least authority at the point of action beats omniscience at the centre.

## Try it

```bash
git clone https://github.com/JustinSian/Teamplane.git
cd Teamplane
npm install && npm run build && npm link
teamplane playground --open
```

A seeded team appears: four tasks, two live leases, a pending force-push approval, a memory store and a live event feed. No model keys, no Docker, no cloud account. Click **Approve** and watch the event stream change.

DSH, Claude Code, Cursor and Codex connect over MCP. The repo also ships a GitHub Action that fails a build when the audit chain does not verify.

## What I want from you

Break it. The threat model names the gaps — lease bypass through shell effects, per-fragment ACLs that do not stop inference, semantic conflicts your tests miss. Open an issue with the scenario, not the feature. A negative result is more useful than a star.

If the thesis is right, the next version adds symbol-scoped leases, a GitHub App, and a benchmark that reproduces the disjoint-file problem on real concurrent agents.

**Mandates, not omniscience.**

---

*Teamplane is MIT, zero runtime dependencies, Node ≥ 20.11. Repo: https://github.com/JustinSian/Teamplane*
