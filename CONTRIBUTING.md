# Contributing

## Setup

```bash
git clone https://github.com/JustinSian/teamplane.git
cd teamplane
npm install
npm run build
npm test
npm run demo
```

Requirements: Node >= 20.11, git >= 2.38. No runtime dependencies; TypeScript is the only dev tool.

## Layout

```
src/core/        ids, canonical JSON, config, errors
src/policy/      pure decision function + default policy
src/domain/      mandates (crypto), service (business rules)
src/store/       event log, projection, snapshot
src/server/      HTTP, SSE, static console
src/mcp/         JSON-RPC, tools, stdio, HTTP transport
src/client/      typed HTTP client used by the CLI
src/cli.ts       command surface
web/             dependency-free console
dsh-plugin/      experimental DeepSeek Harness guard
test/            unit + integration + guard tests
docs/            architecture, threat model, policy, API, MCP, DSH
```

## Rules of the codebase

- **The decision path is pure.** `src/policy/engine.ts` and `src/domain/mandate.ts` may not import `fs`, `http`, a model client, or `nowIso()`. Time is an argument.
- **Events are facts.** Never mutate a stored event; add a new one. Every new event type needs an `applyEvent` branch and a test.
- **Fail closed.** New checks return a reason string or throw `TeamplaneError` with a stable `code`.
- **No new runtime dependencies** without a discussion. The zero-dependency property is a feature.
- **The console uses `textContent`, never `innerHTML`,** for data.

## Tests

```bash
npm test                 # build + all tests
npm run typecheck        # tsc --noEmit
npm run demo             # end-to-end scenario
npm run mcp:smoke        # stdio + HTTP MCP
```

New behaviour needs a test. Security-relevant behaviour needs a test that *fails* without the fix.

## Commits

Conventional-ish prefixes: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`. Keep the subject under 72 characters. One logical change per commit.

## Pull requests

- Describe the scenario, not just the diff.
- Include the event-log excerpt for coordination changes.
- If you change the policy schema or an HTTP shape, update `docs/` in the same PR.
- CI must be green on Linux and Windows.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

By contributing you agree your work is licensed under MIT.
