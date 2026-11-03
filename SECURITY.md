# Security policy

## Reporting

Please open a **private security advisory** on GitHub:
`https://github.com/JustinSian/teamplane/security/advisories/new`

Include the version/commit, the reproduction, and the event log if relevant. Do not open a public issue for an unpatched vulnerability.

## Supported versions

| Version | Supported |
|---|---|
| 0.4.x | yes, best effort |

Pre-1.0 means interfaces may change, but security fixes are backported to the latest minor.

## Security model in one page

Teamplane is a coordination layer, not a sandbox. It assumes:

1. The host running the control plane is trusted by the team.
2. The signing key (`.teamplane/keys/root.key`) is readable only by the operator.
3. The remote's base branch is protected; the merge gate is the sanctioned path, not the only possible one.
4. Agents are untrusted. They may be prompt-injected, confused, or malicious.
5. Teammates are semi-trusted. They can write memory and open tasks; the log records who did what.

What Teamplane enforces:

- Every API action is checked against policy **and** the caller's mandate. Unknown resource kinds fail closed; `task:` actions are bound to the mandate's task.
- Writes must hold a lease; leases conflict by typed containment, not guesswork. Successful `fs.write` authorisations count against `maxWrites`.
- Mandates attenuate; approvals derive `requiredRole` from the matching policy rule (a request body cannot choose it), are single-use, action-hash-bound and consumed atomically.
- Verification commands are bound to a task at creation (or changed by an authorised principal); `submit` rejects commands supplied in the request body.
- Memory reads are ACL-projected; `memory.written` events and SSE frames redact content for principals that cannot read the fragment.
- Events are hash-chained and replay-verified. Snapshots are written as a cache but **never loaded**; startup always replays the chain.
- SSE clients use a one-time ticket (`POST /v1/stream-ticket`); the `?token=` fallback is documented as legacy.

Signing keys live outside the workspace by default: `~/.teamplane/keys/<workspace-id>/root.key` (`TEAMPLANE_KEYS_DIR` overrides it; tests use a temp directory). Anyone with filesystem access to the control-plane host can still read the key, and `mode` is not an ACL on Windows. For strong isolation, run the control plane on a separate host or container and keep worktrees off that host.

What it does **not** enforce:

- Filesystem access to the control-plane host, including the signing key.
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

## Secret scanning

Two layers:

- **CI**: `.github/workflows/security.yml` runs `node scripts/scan-secrets.mjs` over tracked files and `node scripts/scan-secrets.mjs --history` over every commit. It reports the file, line and pattern name, never the value.
- **GitHub**: enable **Settings → Code security → Secret scanning** and **Push protection** for the repository. Public repositories get these free; push protection blocks a token before it lands.

Run locally:

```bash
npm run scan:secrets
npm run scan:secrets:history
```

If a secret ever lands: **revoke it first**, then rotate, then remove it from history. Deleting the commit does not un-leak a key that was already public.
