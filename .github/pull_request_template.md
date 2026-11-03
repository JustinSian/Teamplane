## What this changes

<!-- One paragraph. The scenario, not just the diff. -->

## Which invariant does it protect?

- [ ] Mandate scope cannot widen
- [ ] A lease has one holder and a monotonic fencing token
- [ ] A memory read cannot widen visibility
- [ ] An approval is single-use and bound to the action
- [ ] The event chain detects mutation
- [ ] None — docs, tooling or UI

## Evidence

<!-- Test name, demo step, or event-log excerpt. -->

## Checklist

- [ ] `npm test` passes
- [ ] `npm run demo` passes
- [ ] `npm run mcp:smoke` passes (if MCP changed)
- [ ] Docs updated (`README`, `STATUS`, `docs/`)
- [ ] No tokens, keys or private data in the diff
