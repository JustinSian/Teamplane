# DeepSeek Harness integration

DSH is the first-class adapter, not the product boundary. There are two levels of integration, and they have different guarantees.

## Level 1 — MCP tools (portable, recommended)

Add one row to the profile's `cordis.patch.yml`:

```yaml
- id: mcp-teamplane
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: teamplane
    transport: stdio
    command: npx
    args: ['-y', 'teamplane', 'mcp']
    failOnStartupError: false
    env:
      TEAMPLANE_URL: http://127.0.0.1:7317
      TEAMPLANE_TOKEN: !!js process.env.TEAMPLANE_TOKEN
```

Or the shared control plane over HTTP:

```yaml
- id: mcp-teamplane-http
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: teamplane
    transport: streamable-http
    url: http://127.0.0.1:7317/mcp
    headers:
      Authorization: !!js '`Bearer ${process.env.TEAMPLANE_TOKEN}`'
      X-Teamplane-Mandate: !!js process.env.TEAMPLANE_MANDATE
```

`teamplane dsh print-config` prints both, filled with the current workspace URL.

Tools appear as `mcp__teamplane__tp_lease_acquire` and so on.

**Guarantee:** every *API* action is authorised. If the model never calls the tool, the API cannot stop a raw file write; the merge gate catches it at submit.

## Level 2 — host guard (experimental, stronger)

`dsh-plugin/` is a plain ESM DSH bundle. It registers a synchronous guard in the tool pipeline:

```js
export const name = 'teamplane-guard'
export const inject = ['tools']

export function apply(ctx, config) {
  ctx.tools.guard(createGuard(config))
}
```

The guard reads `.teamplane/context.json` (written by `task start`) and, optionally, `.teamplane/guard.json`:

```json
{
  "strict": true,
  "denyCommands": ["git push --force", "rm -rf /"]
}
```

It denies:

- writes whose path is outside the worktree;
- writes under `.teamplane/`;
- writes outside the mandate's `paths`;
- shell commands containing a denied pattern;
- in strict mode, any write when no context file exists.

The check is synchronous, local, offline, and runs before the tool executes. `dsh-tools` documents guards as monotonic: a later listener cannot turn a denial into permission.

### Install (does not touch the running profile automatically)

```bash
# from the repository root
dsh plugin --profile <profile> add ./dsh-plugin
```

Or add the row manually:

```yaml
- insert:
    - id: teamplane-guard
      name: dsh-teamplane-guard
```

Copy `dsh-plugin/` into the profile's `node_modules` (or use `dsh plugin add` with the path), then restart the harness.

### Test without installing

```bash
node --test test/unit/dsh-guard.test.mjs
```

The unit tests use a fake `ctx.tools.guard` and assert allow/deny for inside, outside, protected path, dangerous command and strict mode.

## What the guard cannot see

- Writes performed by a shell script the agent invokes (the command is checked, not its effects).
- Writes from a runtime that does not call `ctx.tools.guard` (Claude Code, Cursor, Codex).
- Network exfiltration inside an allowed command.

That is why the merge gate and the event log remain the authoritative controls. The guard is a fast local tripwire, not a sandbox. For strong isolation, run worktrees in containers with the control plane as the only egress.

## Compatibility

Tested against the documented DSH `0.2.x` plugin surface: `ctx.tools.guard(fn)`, bundle patch rows, and the `dsh.bundle.patch` package field. The package declares `peerDependencies` on `@deepseek-ai/dsh >=0.2.0-rc.1 <0.3.0-0`; the guard uses no DSH imports at runtime, so a patch-level change does not break it.
