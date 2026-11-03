# The demo, and what it actually proves

`npm run demo` is not a screenshot. It builds a real repository, starts a real control plane on an ephemeral port, and drives the HTTP API as three different principals. Every assertion is executable; a failure exits non-zero.

## Setup

- A temporary git repository with `src/auth.ts`, `src/api.ts`, `tests/auth.test.ts`, `docs/README.md`.
- `init` creates the owner (alice), the signing key, the event log and the default policy.
- bob (maintainer) and carol (agent) are created with one-time tokens.
- Three tasks and three worktrees (`tp/tsk_...`), each with a `.teamplane/context.json` containing its signed mandate.

## Steps and claims

| Step | Observed | Claim |
|---|---|---|
| alice leases `file:src/auth.ts` | `fencing=1` | leases are typed and monotonic |
| bob asks for the same file | `409 lease_conflict` with holder + expiry | coordination does not depend on politeness |
| bob leases `dir:tests/auth` | success | containment is decidable |
| carol calls `authorize(fs.write, file:src/auth.ts)` | `deny: Path src/auth.ts is outside the mandate paths` | a principal cannot exceed its mandate |
| alice writes team memory, then role memory | bob sees both; carol sees only team | memory ACLs are enforced at read time |
| bob asks to force-push `main` | `ask` | dangerous actions are gated |
| alice approves once | `allow`, then `ask` again after `consume` | approvals are single-use and bound to the action |
| alice commits and submits | `merged src/auth.ts` | the merge gate runs leases → merge-tree → verify → merge |
| bob submits with a failing verification | `ok:false, "Verification command failed."` | a clean diff is not enough |
| bob submits with a passing verification | `ok:true` | the gate is not a blanket denial |
| `audit verify` | `ok:true`, hash chain intact | the log is tamper-evident |

## The report

`demo/out/report.md` contains a table of every step, its duration, and its detail. `report.json` is the machine-readable version (used by CI).

The demo is deterministic: all ids are generated, but the order and assertions are fixed. It leaves no state outside the temp directory; `--keep` keeps it for inspection.

## How to add a scenario

Add a `step('name', async () => { ... })` in `src/demo/run.ts`. Each step gets its own timing and failure isolation; a thrown error records a FAIL and continues, so one broken scenario does not hide the others.

Scenarios worth adding:

- two tasks editing the same file with `requireLease:false` → `git merge-tree` conflict path list;
- a derived mandate that tries to widen its parent → `403 mandate_expansion`;
- a memory fragment containing an AWS key → `422 secret_detected`;
- tampering with `events.jsonl` → CLI `audit verify` exits non-zero.

## Why not use real models?

The demo tests the *control plane*, not model quality. Model calls would add latency, cost and nondeterminism without testing any of the claims above. The MCP smoke test (`npm run mcp:smoke`) exercises the path a model would take.
