# Deploying Teamplane

Teamplane is a coordination layer, not a sandbox. It protects agents from each
other; it does not protect a host from its administrator. Read this page before
putting a control plane anywhere other than loopback.

## What the control plane protects

| Threat | Protected? | Mechanism |
|---|---|---|
| An agent writes outside its mandate | Yes, through the API/guard | signed mandate + policy + lease |
| Two agents overwrite the same file | Yes, through the API/guard | typed leases with fencing tokens |
| A private memory fragment is read by another agent | Yes, through the API | ACL projection + sealed vault |
| An approval is forged or replayed | Yes | policy-derived role + action hash + atomic consumption |
| A forged snapshot changes principals | Yes | snapshots are ignored; the chain is replayed |
| Raw filesystem writes from a shell | **No** | install the host guard or use a sandbox |
| A host administrator reads the key | **No** | separate host / KMS / HSM |
| A stolen `.teamplane/` backup without the key | Vault content is protected | AES-256-GCM with a key outside the workspace |

The last three rows are deployment boundaries, not application bugs.

## Profiles

### 1. Laptop, one operator (default)

```bash
teamplane init --name acme --owner alice
export TEAMPLANE_TOKEN="tp_..."
teamplane serve
```

The server binds `127.0.0.1:7317`. Keys default to
`~/.teamplane/keys/<workspace-id>/`; the repository holds `.teamplane/` (events,
policy, sealed memory) and the sibling `.teamplane-worktrees/`.

Do not change the bind address to `0.0.0.0` on a laptop.

### 2. Shared team host or container

Run the control plane as a dedicated OS user or container, bind it to loopback,
and put TLS in front. Do not mount the host's Docker socket into the container.

This repository ships a two-stage `Dockerfile` and a `docker-compose.yml`:

```bash
mkdir -p workspace/repo
docker compose run --rm control-plane \
  init --dir /workspace/repo --name acme --owner alice --host 0.0.0.0
# copy the token printed above; it is shown once
docker compose up -d
curl -fsS http://127.0.0.1:7317/healthz
```

The compose file publishes the port on `127.0.0.1` only. The workspace is
`./workspace` on the host; the repository is `./workspace/repo`. Worktrees are
created under `./workspace/.teamplane-worktrees`, so the mount must contain the
parent directory, not just the repository.

The image runs as uid/gid `1000`. On Linux, make the bind mount writable by that
user, or set `TEAMPLANE_UID` / `TEAMPLANE_GID`:

```bash
sudo chown -R 1000:1000 workspace
TEAMPLANE_UID="$(id -u)" TEAMPLANE_GID="$(id -g)" docker compose up -d
```

Keys live in the named volume `teamplane-keys` (`/data/keys`), outside the
repository mount. Back it up with the workspace.

### 3. Public SaaS

Not supported in 0.5.x. A multi-tenant deployment needs at minimum: per-tenant
key isolation (KMS/HSM), a sandbox that enforces every write, network
authentication beyond bearer tokens, and an external audit. Do not expose the
current server directly to the internet.

## TLS and SSE

Terminate TLS at a reverse proxy and forward to `127.0.0.1:7317`. Disable proxy
buffering for `/v1/stream`, or event delivery will stall. Caddy example:

```caddyfile
teamplane.example.com {
  reverse_proxy 127.0.0.1:7317 {
    flush_interval -1
  }
}
```

The console obtains a short-lived, single-use ticket for SSE; the legacy
`?token=` fallback should not be used in production because tokens can appear in
proxy logs.

## Filesystem and backups

Back up these together, at the same point in time:

- the repository (or at least `.teamplane/` and `.teamplane-worktrees/`)
- the keys directory (`~/.teamplane/keys/<workspace-id>/`, or the
  `teamplane-keys` volume)

Without the key, sealed memory fragments cannot be decrypted. Losing the key is
equivalent to losing private memory; there is no recovery path in 0.5.x.

A backup of `.teamplane/` alone is not enough. Test a restore on a separate
machine before relying on it.

## Permissions

Linux/macOS:

```bash
chmod 700 ~/.teamplane ~/.teamplane/keys ~/.teamplane/keys/* 
chmod 600 ~/.teamplane/keys/*/root.key
chmod 700 <repo>/.teamplane <repo>/.teamplane/memory
chmod 600 <repo>/.teamplane/memory/*.json
```

Windows: `mode` is not an ACL. Restrict the key directory and the workspace
state directory to the account that runs the control plane:

```powershell
icacls "$env:USERPROFILE\.teamplane" /inheritance:r /grant:r "$env:USERNAME:(OI)(CI)F"
icacls "<repo>\.teamplane" /inheritance:r /grant:r "$env:USERNAME:(OI)(CI)F"
```

A shared Windows host with multiple interactive users needs this; a single-user
laptop is lower risk. `teamplane doctor` reports the key location and workspace
state, but does not change ACLs.

## Audit checkpoint

`audit verify` proves the chain is internally consistent, but it is computed on
the machine being audited. Sign the head and keep the signature elsewhere:

```bash
teamplane audit sign --out checkpoint.json   # sign seq + hash with the workspace key
teamplane audit verify --checkpoint checkpoint.json
```

The signature uses the Ed25519 key in `~/.teamplane/keys/<id>/`, which is
outside the workspace. Copy `checkpoint.json` to a place the event-log writer
does not control (a separate repo, object store, or a teammate's machine). If
an attacker rewrites the chain, they cannot produce a new valid checkpoint
without that key.

## Verification sandbox

`submit` runs the task's verification commands on the control-plane host, and
`npm test` executes the task's `package.json` scripts — code an agent controls.
Two environment variables give you an isolation boundary:

| Variable | Effect |
|---|---|
| `TEAMPLANE_VERIFY_RUNNER` | A command template run with `shell: true`; `{worktree}` and `{command}` are substituted. Example: `docker run --rm -v "{worktree}:/work" -w /work --rm node:22 sh -c "{command}"` |
| `TEAMPLANE_VERIFY_REQUIRE_RUNNER=1` | Refuse to run verification at all when no runner is configured (`503 verify_runner_required`) |

Use `TEAMPLANE_VERIFY_REQUIRE_RUNNER=1` on any host you do not fully trust, and
point the runner at an isolated container.

## What is still not enforced

- **Raw writes.** An agent with a shell can write into the worktree without
  calling `/v1/authorize`. `maxWrites` counts successful authorisations, not
  filesystem operations. Install the DSH guard, or run the agent in a container
  with only its worktree mounted.
- **Host administrators.** Anyone who can read the key can sign mandates and
  decrypt memory. Use a separate host/container and an OS account that agents
  cannot reach.
- **Single node.** One process, one writer. There is no HA or multi-node mode.

## Upgrades

```bash
# stop the control plane, back up workspace + keys
git pull
npm ci
npm run build
npm test
teamplane doctor
teamplane serve
```

0.3 → 0.4 moved keys out of the workspace and memory text out of the event log;
0.5 seals the vault. Startup migrates 0.3/0.4 data, but back up first. If a
restore spans versions, start the oldest compatible version and let it migrate,
then upgrade.

## Incident checklist

1. Stop the control plane if the host may be compromised.
2. Preserve `.teamplane/events.jsonl`, archives, and the key directory for
   forensics; do not "fix" the chain.
3. Disable the affected principal: `teamplane user disable --id usr_...`.
4. Revoke every mandate for the task: `teamplane mandate revoke --id mnd_...`.
5. If the key is compromised, treat every mandate and every sealed memory
   fragment as compromised. There is no key rotation in 0.5.x; rebuild the
   workspace with a fresh key and re-issue mandates. Export anything you still
   need before discarding the old workspace.
6. Re-run `teamplane audit verify` and keep the output with the incident note.
