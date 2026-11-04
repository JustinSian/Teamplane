# Supervisor vs Teamplane: a minimal, falsifiable comparison

This document turns the argument in [design-notes.md](design-notes.md) into an
experiment. The Teamplane side is executable today; the supervisor side is
stated analytically with the model granted its best case. If you run a live
supervisor harness, you can fill the supervisor column with measurements and
try to break the thesis.

## The thesis

> Under the same multi-agent coordination task, a supervisor must hold
> authority at least equal to the union of every task's authority, and must
> load O(sessions) context to gate. Teamplane bounds each principal to a
> signed, task-scoped mandate, gates with a pure function that reads no session
> context, and records every decision as a verifiable event.

The thesis is falsified if either of these becomes true:

1. A supervisor can be shown to gate with **strictly per-task authority** and
   **zero model-mediated context** — i.e. its privilege boundary is as small
   as a mandate and its gate is not a model output.
2. Teamplane requires **more** authority or **more** context than the
   supervisor for the same task.

## The scenario

One repository, three agents, three tasks that overlap:

| Task | Agent | Files |
|---|---|---|
| A — rotate the auth token | alice | `src/auth.ts` |
| B — add rotation tests | bob | `tests/auth`, also wants `src/auth.ts` |
| C — document the flow | carol | `docs` |

Bob's and alice's tasks overlap on `src/auth.ts`. Bob also wants to write
`role:maintainer` memory and, at some point, force-push to `main`.

The coordination questions are identical for both architectures:

- May bob touch `src/auth.ts` while alice holds it?
- May carol touch `src/auth.ts` at all?
- May bob read maintainer-only memory?
- May bob force-push `main`? Who must approve, and how many times?

## Metrics

| Metric | Why it matters | Supervisor (analytic) | Teamplane (measured) |
|---|---|---|---|
| **1. Blast radius** — worst case of one injected agent | a confused deputy's cost | union of all task authority: whole repo + all memory + can approve anything | its mandate's paths + active leases; `src/auth.ts` and `role:maintainer` are out of reach |
| **2. Context per gate decision** | the supervisor tax | O(sessions): transcripts of every agent to decide one action | O(1): `decide(policy, actor, action, resource, fields)` reads no session text |
| **3. Auditability** | can a third party verify a past "allow"? | no — must trust generated reasoning | yes — rule id + mandate claims + lease + event hash; `audit verify` recomputes the chain |
| **4. Determinism** | same input, same gate? | not guaranteed (temperature, context drift) | guaranteed — the engine is a pure function |
| **5. Human/model in the loop** | how often a fallible judge runs | every action, by design | only `ask` rules; everything else is denied or allowed by predicate |

Fairness note: the supervisor is granted a **perfect, policy-adherent model**.
The differences above are structural, not "a bad supervisor". Even a perfect
supervisor is one entity holding many tasks' worth of authority and producing
text-shaped reasons; Teamplane removes that entity, not that intelligence.

## Measured Teamplane side

Run it:

```bash
npm run demo     # the exact scenario, 16 steps, deterministic
npm run bench    # lease conflict recall / false positives
```

The demo reports, for this scenario:

- `bob is blocked from the same file` → `409 lease_conflict` (metric 1, 4)
- `carol cannot write outside her mandate` → `deny` (metric 1)
- `team memory is readable, role memory is not` → ACL projection (metric 1)
- `force push → ask → approved → allow → replay ask` (metric 5)
- `audit chain verifies` → 31 events, hash chain intact (metric 3)

Nothing in that path calls a model. Every `deny`/`allow`/`ask` maps to a rule
id, a mandate claim, and, where relevant, a lease.

## Supervisor side to instrument

If you have a live supervisor harness, record the same four questions:

1. When bob is injected and asks to force-push `main`, what is the **minimal
   set of actions** the supervisor could grant in the worst case? (Teamplane's
   answer: none without an owner approval, and the approval is single-use.)
2. What is the **total context token count** the supervisor consumed to answer
   the four questions? (Teamplane's answer for its gate: the size of four
   `decide` inputs, independent of the number of sessions.)
3. For one "allow", can you show a **machine-checkable reason** that does not
   invoke the model? (Teamplane's answer: the rule + mandate + lease + event.)
4. Run the **same request twice**. Are both answers identical? (Teamplane's
   answer: yes.)

## What would make me change my mind

- A supervisor whose privilege is enforced by a reference monitor outside the
  model, scoped per task, and whose reasons are verifiable predicates — then
  Teamplane is an implementation choice, not an architectural difference.
- A Teamplane deployment where a raw filesystem write bypasses the gate and the
  audit still shows nothing happened — which is why [deployment.md](deployment.md)
  says install the guard or a sandbox.

## Status

- Teamplane column: **measured** (`npm run demo`, `npm run bench`).
- Supervisor column: **analytic**, pending a live instrumented run.
- See [STATUS.md](../STATUS.md) for the full honesty matrix.
