# Threat model

Teamplane's security claim is narrow and testable: **an agent cannot exceed the signed mandate of its principal, and every decision is reproducible from the event log** — provided the enforcement points below are actually in the path.

This document names the assets, the trust boundaries, what is mitigated, and what is *not*.

## Assets

| Asset | Why it matters |
|---|---|
| Mandate signing key (`keys/root.key`) | forges any authority in the deployment |
| Principal tokens | impersonate a teammate |
| Repository and worktrees | code, secrets, build artefacts |
| Event log | the only audit trail; tampering hides actions |
| Memory fragments | can contain sensitive conclusions or poisoned guidance |
| Approval records | authorise one dangerous action |

## Trust boundaries

```
untrusted inputs (PR text, issues, memory, web pages)
        │
        ▼
   agent runtime  ──MCP──▶  control plane  ──git──▶  repository
        │                        │
        │                        └──▶ event log (append-only)
        ▼
   host tool guard (optional, local, synchronous)
```

1. **Agent → control plane.** The agent is untrusted. Every call carries a principal token and a mandate; the control plane re-authorises each call by value.
2. **Control plane → git.** The merge gate is the only path that writes to the base branch in the recommended workflow.
3. **Host → worktree.** Without the guard plugin, the control plane cannot see a raw file write inside a worktree. This is the largest residual gap; see T5.
4. **Human → approval.** An approval is bound to an action hash and expires; it is not a role-wide blank cheque.

## Threats

| # | Threat | Mitigation | Residual risk |
|---|---|---|---|
| T1 | **Prompt injection** in a PR comment or memory fragment tells the agent to exfiltrate secrets or rewrite main | Mandate scope limits paths/actions; secrets are rejected on memory write; guard blocks writes outside scope; approval required for force-push | An injected instruction that stays *inside* the mandate can still do damage (e.g. delete a test in `tests/auth`). Scope is not intent. |
| T2 | **Confused deputy**: the model calls a tool with arguments it does not understand | Authorisation is by value, outside the model: principal + action + resource + mandate are re-checked per call; `deny` wins over `allow` | The deputy can still perform any action the principal is genuinely allowed to perform. |
| T3 | **Mandate forgery / expansion** | Ed25519 signature; derivation checks subset on paths, actions, branches, memory, expiry and write limit; revocation is an event | Private key on disk outside the workspace (default `~/.teamplane/keys/<id>/`). No HSM, no key rotation. |
| T4 | **Token theft** | Tokens are 256-bit random, stored only as SHA-256; logs redact the `Authorization` header; console stores the token in `localStorage` | Malware on the user's machine, or an XSS not prevented by the CSP, can read it. |
| T5 | **Lease bypass**: an agent writes a file without calling `authorize` | Merge gate checks changed files against leases; the optional DSH guard denies writes outside mandate/worktree at the tool boundary | A shell command that writes through a script, or a non-DSH runtime without a guard, bypasses the local check. The merge gate still catches it at submit. For strong isolation, run each worktree in a container with the control-plane API as the only egress. |
| T6 | **Stale holder writes after lease expiry** | Fencing token increments on every acquisition; submit re-checks active leases; expired leases cannot be renewed | A write that lands between expiry and the next submit is still a write. Use short TTLs and re-acquire before long edits. |
| T7 | **Approval replay** | Approval binds `(action, resource, mandate)`, expires, and is single-use (`approval.consumed`); self-approval is rejected | Collusion between two principals with the required roles. |
| T8 | **Memory inference leak** | Per-fragment ACL (`private` / `team` / `role:<role>`), provenance, read projection | Combining several legitimately visible fragments can reveal a conclusion that no single fragment states. This is a known open problem (see Collaborative Memory's limitations). Keep sensitive conclusions `role:`-scoped. |
| T9 | **Memory poisoning** | Provenance is mandatory; contradictions emit `memory.conflict`; secret scan; no anonymous writes | A trusted teammate can write a wrong "decision". Teamplane records who and when; it does not establish truth. |
| T10 | **Merge-gate bypass** | The gate runs `git merge-tree` + your verification commands; submit results are events | A human or agent with direct push access to the remote bypasses the gate entirely. Protect the base branch on the remote; treat the gate as the only sanctioned path. |
| T11 | **Event-log tampering** | Hash chain verified on startup and by `audit verify`; append-only file | An attacker with write access can truncate the tail (a shorter valid chain) or delete the file. Anchor the head hash somewhere else (a signed release, an external log) for stronger guarantees. |
| T12 | **Denial of service** | 1 MiB body cap, per-command timeout, lease TTL, single-writer append | No rate limiting in v0.1; a local attacker can flood the event log. |
| T13 | **Cross-source identity confusion** | A principal is a Teamplane id; external identities (GitHub login, Feishu open id) are provenance strings, not principals | Mapping external accounts to principals is an operator decision, not something the agent may assert. |

## What is deliberately not defended

- **A malicious owner.** Owners can rewrite policy, revoke mandates and approve anything. Teamplane is not a defence against the deployment's root.
- **A compromised host.** If the machine running the control plane is compromised, the signing key and log are compromised.
- **Semantic correctness.** The gate proves a merge is textually clean and your commands exit zero. It does not prove the code is good.
- **Covert channels.** Agents can encode data in commit messages, branch names or timing. Scope limits the blast radius, not the channel.

## Deployment checklist

- [ ] Run the control plane on a host your team trusts; bind to `127.0.0.1` unless you terminate TLS in front of it.
- [ ] Keep `.teamplane/` out of git; never commit `keys/root.key`.
- [ ] Use one principal token per human/agent; rotate by creating a new principal and disabling the old one.
- [ ] Keep TTLs short (15–60 min) for leases and mandates on active work.
- [ ] Protect the remote's base branch; the merge gate is not a substitute for branch protection.
- [ ] Install the DSH guard plugin for every runtime that writes files; otherwise treat worktree writes as advisory.
- [ ] Anchor `audit verify` output (head hash) in CI or a signed release.
- [ ] Review `memory.conflict` events weekly; they are the cheapest signal of a team disagreeing with itself.
