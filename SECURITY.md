# Security policy

## Reporting

Please open a **private security advisory** on GitHub:
`https://github.com/JustinSian/teamplane/security/advisories/new`

Include the version/commit, the reproduction, and the event log if relevant. Do not open a public issue for an unpatched vulnerability.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | yes, best effort |

Pre-1.0 means interfaces may change, but security fixes are backported to the latest minor.

## Security model in one page

Teamplane is a coordination layer, not a sandbox. It assumes:

1. The host running the control plane is trusted by the team.
2. The signing key (`.teamplane/keys/root.key`) is readable only by the operator.
3. The remote's base branch is protected; the merge gate is the sanctioned path, not the only possible one.
4. Agents are untrusted. They may be prompt-injected, confused, or malicious.
5. Teammates are semi-trusted. They can write memory and open tasks; the log records who did what.

What Teamplane enforces:

- Every API action is checked against policy **and** the caller's mandate.
- Writes must hold a lease; leases conflict by typed containment, not guesswork.
- Mandates attenuate; approvals are single-use and bound to an action hash.
- Memory reads are ACL-projected; recognised secrets are rejected on write.
- Events are hash-chained and replay-verified.

What it does **not** enforce:

- Raw file writes inside a worktree, unless the host guard is installed.
- Shell side effects inside an allowed command.
- Semantic correctness of a merge.
- Confidentiality against a compromised host or signing key.

See [docs/threat-model.md](docs/threat-model.md) for T1–T13 and the deployment checklist.

## Hardening checklist

- Bind the server to `127.0.0.1` unless TLS terminates in front of it.
- Keep `.teamplane/` out of version control; `keys/root.key` must be `0600`.
- Short TTLs: leases 15–60 min, mandates 1–8 h, approvals 30 min.
- One token per principal; create a new principal and disable the old one to rotate.
- Install `dsh-teamplane-guard` (or an equivalent host guard) for every writing runtime.
- Anchor the output of `teamplane audit verify` in CI or a signed release.
- Review `memory.conflict` events; they are the earliest signal of a poisoned or divided team memory.
