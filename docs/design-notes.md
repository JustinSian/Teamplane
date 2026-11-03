# Design notes

Teamplane exists because of an argument, not a feature list. This document states the argument, the prior art that shaped it, and what would prove it wrong.

## The argument in one paragraph

Multi-agent systems usually answer coordination with a bigger agent: a supervisor that reads every session, remembers everything, and approves every action. That design has three problems that no prompt can fix — it is a single point of failure, it is a confused deputy (it holds more authority than any one task needs), and it is unauditable (its reasons are generated text). Teamplane replaces the supervisor with three mechanisms that are cheap to verify: **signed, narrowing mandates** (who may do what, for how long, on which task), **deterministic policy plus leases** (what is allowed *now*, and who owns the resource), and **structured events plus curated memory** (what the team needs to know, without sharing what it said).

The model keeps the interesting job — planning, coding, judgement — and loses the two jobs it is worst at: being an authority and being a lock.

## Three moves

### 1. Extend the Mandate from one user to many principals

DeepSeek Harness's Super-agent model gives a Router a `Mandate` when it accepts work: the policy version, scope, strength, and sender it relied on. The prototype intentionally does **not** model a `Principal`; its domain doc lists "Principal or Membership as an entity" under *rejected concepts*, because the prototype assumes one team with one allowlist.

Teamplane makes the principal first-class and keeps the mandate's shape. The result is a capability that answers "may *this* agent, for *this* task, touch *this* path, until *this* time" — and nothing more. Derivation only narrows, which makes delegation safe by construction.

### 2. Move the gate out of the model

A model-mediated gate is a suggestion. Three independent lines of work converge on this:

- **ScopeGate** audited LangChain/LangGraph, LlamaIndex and the Stripe Agent Toolkit and found that all three provide *capability gating* by default, but none provides a deterministic, fail-closed, per-call **value** authorization gate. The same unauthorised payout call executed under the default dispatch. The fix is a PDP/PEP outside the model: scope, authorization, money ceiling, idempotency, default deny.
- **DelegateGuard** turns the initiating user's authorization into attenuable capabilities over purpose, labels, operations, sinks and delegation depth, mediates every data-moving action *outside* the LLM, and cascades revocation through the delegation graph.
- The classic **reference monitor** (Anderson, 1972) and XACML's PDP/PEP split say the same thing in older language: the enforcement point must be non-bypassable, always invoked, and small enough to verify.

Teamplane's policy engine is a pure function; its mandate verifier is Ed25519 over canonical JSON; its lease check is a containment test. None of them calls a model. The DSH guard plugin applies the same decision at the host's `ctx.tools.guard`, which is synchronous and monotonic — a later listener cannot turn a denial back into permission.

### 3. Replace "watch every session" with "subscribe to events"

The omniscient-controller design assumes that more context is better. The evidence points the other way:

- **Shared Selective Persistent Memory** (2026) keeps four categories of reusable context — task specifications, data schemas, tool configurations, output constraints — and discards session-specific reasoning traces. In its controlled replication, selective memory completed 12/12 trials at 3.9K tokens, no memory 0/12, and full conversation history only 8/12 at 7.7K tokens. What is kept matters more than how much.
- **Collaborative Memory** (ICML 2025) shows cross-user sharing can reduce resource calls by up to 61% at 50% query overlap, but only with two-tier memory, immutable provenance and read/write policies that enforce asymmetric, time-varying access.
- **Shared Organizational Memory** (2026) reports an enterprise coding-agent deployment where capture happens with contributor approval, is curated into reusable Q&A, is gated for security/privacy, and only then is retrieved.

Teamplane's memory is therefore a curated fragment store with provenance and ACLs, not a transcript lake. The coordination channel is a typed event stream (`lease.denied`, `approval.requested`, `submit.rejected`), not a feed of everything everyone said.

## Why not a master agent?

| Property | Omniscient controller | Teamplane |
|---|---|---|
| Authority | one agent holds everything | each action holds only its mandate |
| Failure | whole team stops | one task stops; leases expire |
| Audit | generated rationale | deterministic rule id + hash-chained events |
| Injection | the controller reads the untrusted text and holds the keys | the controller never reads transcripts; the gate checks values |
| Cost | O(sessions) context per decision | O(1) per policy/lease check |
| Privacy | everyone's sessions visible to one agent | fragments with explicit visibility |
| Recourse | ask the controller why | replay the decision from the log |

The controller is not evil; it is *over-privileged*. The design principle is least authority at the point of action, not omniscience at the centre.

## What prior art says about the hard parts

- **Concurrent edits do not respect file ownership.** MERGEGYM (2026) found that of 167 textual conflicts in 715 concurrent agent PR pairs, **79 (47.3%) occurred despite disjoint authored file sets**, because three-way merge compares both heads to a common merge base while authors reason about their own diffs. That is why Teamplane leases *and* runs `git merge-tree` at submit: the lease prevents the easy collision, the verifier catches the semantic one.
- **Cheap verification beats prediction.** The same work notes local `git merge-tree` replay has a median cost of 0.02 s. When exact replay is cheap, verify everything; do not ask a model to predict conflicts.
- **Access control is not a filter on retrieval.** Collaborative Memory formalises read *and* write policies over a bipartite user–agent–resource graph, with provenance for retrospective checks. Teamplane adopts the two-tier idea but keeps the policy model deliberately small (JSON rules, no graph solver) so an operator can read it.
- **Derived authority must attenuate.** DelegateGuard's delegation graph and revocation cascade are the mature version of what Teamplane does with a single parent link. v0.1 keeps one parent; a DAG is roadmap.
- **The unit of coordination is a ticket, not a chat.** Super-agent's `Ticket`/`Assignment`/`Subscription` model, and the older blackboard and Contract-Net traditions, all separate the shared work object from the participants' private state. Teamplane's `Task`/`Lease`/`Mandate` is the same move with cryptographic authority.

## What Teamplane adds

1. A **multi-principal mandate** with decidable attenuation and offline verification, in a form small enough to embed in a worktree context file.
2. A **two-gate + lease** authorization pipeline where each gate is independently testable and the failure names the gate.
3. A **typed lease** model with decidable containment and fencing, paired with a merge gate that verifies rather than predicts.
4. A **memory contract** that refuses transcripts, rejects secrets, records provenance and surfaces contradictions as events.
5. An **event-sourced audit** whose integrity can be checked without trusting the process that wrote it.

## Falsifiable claims

The design should be rejected if any of these fail:

- **C1.** A principal cannot perform an action outside its mandate, including via a derived mandate, a replayed approval, or a stale lease. (Tests: mandate derivation, approval consumption, fencing.)
- **C2.** Two agents with overlapping intent cannot both merge conflicting changes; the second submit is rejected with the conflicting paths. (Test: merge-tree integration.)
- **C3.** A reader cannot observe a fragment outside its visibility, and a writer cannot store a recognised secret. (Tests: ACL matrix, secret patterns.)
- **C4.** The event log detects a single-byte mutation anywhere in its history. (Test: tamper detection.)
- **C5.** The decision path contains no model call and no network call. (Code inspection; the policy engine has no imports beyond the domain types.)

C1–C4 are covered by `npm test`. C5 is a structural property of `src/policy/engine.ts` and `src/domain/mandate.ts`.

## Limits and open questions

- **Semantic conflicts remain semantic.** `merge-tree` catches textual conflicts; a change to `src/auth.ts` that breaks `src/api.ts` is caught only if your verification commands exercise it. The gate is a floor, not a ceiling.
- **Cross-user inference.** Per-fragment ACLs do not prevent combining visible fragments into a conclusion. This is the open problem in Collaborative Memory too; role-scoped memory is a mitigation, not a proof.
- **Truth.** Provenance records who said it, not whether it is true. A team can be confidently wrong together; `memory.conflict` makes disagreement visible, not correctness.
- **Scale.** One writer, O(n) replay. The domain model is ready for segmentation; the implementation is not.
- **Adoption.** The hardest part is not the protocol; it is convincing a team to write down its rules. The default policy is intentionally small so it can be read in one sitting.
