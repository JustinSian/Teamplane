# dsh-teamplane-guard

An experimental DeepSeek Harness host plugin that enforces a Teamplane mandate at the tool-call boundary.

```js
export const name = 'teamplane-guard'
export const inject = ['tools']
export function apply(ctx, config = {}) {
  ctx.tools.guard(createGuard(config))
}
```

## What it checks

| Tool | Check |
|---|---|
| `write`, `edit`, `str_replace_editor`, `apply_patch`, `fs_write`, `create_file` | path must stay inside the worktree, outside `.teamplane/`, and inside the mandate's `paths` |
| `bash`, `pwsh`, `terminal` | command must not contain a denied pattern (`git push --force`, `git reset --hard`, `rm -rf /`, …) |
| anything else | untouched |

The guard is synchronous, local and offline. It reads `.teamplane/context.json` (written by `teamplane task start`) and optional `.teamplane/guard.json`:

```json
{
  "strict": true,
  "denyCommands": ["git push --force", "rm -rf /"]
}
```

`strict` (or `TEAMPLANE_GUARD=strict`) fails closed when no context exists.

## Install

```bash
# from the Teamplane repository root
dsh plugin --profile <profile> add ./dsh-plugin
```

Or add the bundle row manually:

```yaml
- insert:
    - id: teamplane-guard
      name: dsh-teamplane-guard
```

Restart the harness after installing.

## Limits

The guard sees tool arguments, not their effects. A shell script can still write outside the mandate; the merge gate and the event log remain authoritative. See `../docs/dsh.md` and `../docs/threat-model.md`.

## Test

```bash
node --test test/unit/dsh-guard.test.mjs
```
