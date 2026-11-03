# Benchmarks

Small, reproducible measurements that keep the docs honest. Each one runs offline, needs only `git`, and writes its result to a Markdown file next to the script.

## conflict-replay

```bash
node bench/conflict-replay.mjs        # or: npm run bench
TRIALS=100 node bench/conflict-replay.mjs
```

**Question:** what does a `file:` lease actually buy, compared with the merge gate?

**Method:** build a 10-file, 40-line repository; for 30 trials per mode, create two branches from the same base:

| Mode | Branch A | Branch B |
|---|---|---|
| `same-line` | edits line 5 of `fN` | edits line 5 of the same file |
| `other-line` | edits line 30 of `fN` | edits line 5 of the same file |
| `other-file` | edits line 30 of `fN` | edits line 5 of `f(N+1)` |

Then run `git merge-tree --write-tree --name-only a b`, and separately model an exclusive `file:fN` lease held by A.

**Result** (see [RESULTS.md](RESULTS.md)):

| Mode | Textual conflict | Lease blocks | Merge gate blocks |
|---|---|---|---|
| same-line | 30/30 | 30/30 | 30/30 |
| other-line | 0/30 | 30/30 | 0/30 |
| other-file | 0/30 | 0/30 | 0/30 |

**Interpretation:** a file-level lease has perfect recall and a 100% false-positive rate on clean same-file edits. It is a cheap, decidable early signal, not a precise conflict oracle. The merge gate is the precise check. This is why Teamplane has both, and why the roadmap lists symbol/hunk-scoped leases as future work.

**Threats to validity:**

- Conflicts are textual and synthetic; semantic breakage is out of scope.
- Git's three-way merge is the oracle; different merge drivers change the numbers.
- A lease is modelled as a key conflict, not as human scheduling behaviour.
- 30 trials per mode is enough to show the mechanism, not to estimate a population rate.

**What would change the conclusion:** if teams rarely edit the same file concurrently, the false-positive cost approaches zero; if they often do, finer-grained leases matter more than faster gates.
