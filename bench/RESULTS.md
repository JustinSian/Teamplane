# Why a file-level lease is conservative

Trials per mode: **30**. Repository: 10 files, 40 lines each.

| Concurrent edits | Textual conflict | `file:` lease blocks | Merge gate blocks |
|---|---|---|---|
| same-line | 30/30 (100%) | 30/30 (100%) | 30/30 (100%) |
| other-line | 0/30 (0%) | 30/30 (100%) | 0/30 (0%) |
| other-file | 0/30 (0%) | 0/30 (0%) | 0/30 (0%) |

**Reading it:** a file-level lease catches every conflict, but it also blocks every clean same-file edit (`other-line`). That is the price of a decidable, cheap lock. The merge gate is the precise check; the lease is the cheap early signal. Symbol- or hunk-level leases would reduce the false positives, at the cost of a harder conflict predicate.

Reproduce: `node bench/conflict-replay.mjs`. Set `TRIALS` to change the sample.
