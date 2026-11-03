# Launch kit

The code is ready. This file is the distribution checklist — the part that actually produces stars, and the part only a human with account access can do.

## Preconditions

- [ ] Repository is **public** (`https://github.com/JustinSian/Teamplane` returns 200 without login).
- [ ] **Settings → Pages → Source = GitHub Actions**; the `pages` workflow deployed `site/`.
- [ ] **Social preview** = `docs/assets/social.png` (1280×640).
- [ ] About: description + topics (`agents`, `multi-agent`, `mcp`, `deepseek-harness`, `authorization`, `capability`, `coordination`).
- [ ] `ci` and `pages` are green on `main`.
- [ ] A release exists for the current tag (`v0.2.7` or later).
- [ ] `npm run demo` passes on a clean clone (the README promise).
- [ ] npm publish is optional; if skipped, the README's `npm link` path is the install story.

## Assets

| Asset | Use |
|---|---|
| `docs/assets/social.png` | GitHub social preview, X/LinkedIn card |
| `docs/assets/console.png` | first reply on HN, README hero |
| `docs/assets/console-tasks.png` | "it has a UI" reply |
| `docs/assets/console-mandates.png` | "how does authority work" reply |
| `bench/RESULTS.md` | "is the lease worth it?" reply |
| `STATUS.md` | every "is it production ready?" reply |

## Channels

### Hacker News — Show HN

**Title:** `Show HN: Teamplane – signed mandates and leases instead of a supervisor agent`

**URL:** the repository.

**First comment (post immediately):**

> I kept seeing the same multi-agent failure: three agents in one repo, duplicated work, a stale branch, and a supervisor agent holding every credential and reading every transcript.
>
> Teamplane replaces the supervisor with three verifiable pieces: Ed25519 mandates scoped to one task, a deterministic policy + lease gate, and a hash-chained event log. No model in the decision path.
>
> The demo is one command and needs no API key: `teamplane playground --open`. It seeds a team with a pending force-push approval you can click.
>
> The most useful thing I can tell you is what I measured and what I didn't. STATUS.md has the matrix; the benchmark shows a file-level lease has 100% conflict recall and a 100% false-positive rate on clean same-file edits. The merge gate is the precise check.
>
> I'd rather hear the scenario that breaks it than a star.

### Reddit

- `r/ExperiencedDevs`: title *"We replaced the supervisor agent with signed mandates — here is what we measured"*. Lead with the failure story, link the design notes, not the repo first.
- `r/LLMDevs`: *"A deterministic control plane for multi-agent repos (MCP, no model in the gate)"*.
- `r/DeepSeek`: focus on the DSH MCP row and the guard running inside the real `dsh-tools` pipeline.

Do not cross-post all at once; one channel per day, answer every technical reply.

### Lobsters

Title: `Teamplane: signed mandates and leases for multi-user agent teams`. Tags: `ai`, `security`, `practices`.

### DeepSeek Harness community

Post the exact `cordis.patch.yml` row and the `task launch -- dsh` flow. This is the audience most likely to actually run it.

### X / LinkedIn

Thread:

1. "Your agents share a repo, not a brain." + social image.
2. The supervisor trap (3 bullets).
3. The three mechanisms.
4. The benchmark table (including the false positives).
5. `teamplane playground --open` + link.

## Timing

Tuesday–Thursday, 08:00–10:00 US Eastern. Avoid a US holiday and the day of a major model release.

## Response plan

| Question | Answer |
|---|---|
| "Isn't this just a supervisor with extra steps?" | No model is in the gate; authority is a signature, not a judgement. Link `docs/design-notes.md`. |
| "Is it production ready?" | No. `STATUS.md` lists what is shipped, partial and not measured. |
| "Why not just use PRs + CODEOWNERS?" | Those are coarse and post-hoc; a mandate is per-task and the lease is pre-write. The merge gate still runs. |
| "Does it work with Claude Code / Cursor?" | Any MCP client; DSH is the reference with a host guard. |
| "What about semantic conflicts?" | The gate verifies text and your commands; it is a floor, not a ceiling. |
| "Show me the code" | `src/policy/engine.ts` is a pure function; `src/domain/mandate.ts` is the capability; `bench/` is the measurement. |

Never argue about stars. Link evidence, thank the critic, open an issue.

## After launch

- Within 48h: a follow-up post with the **benchmark** ("what a lease costs"), including the false positives.
- Within a week: a **failure post** — the first real bug or bypass someone reports, with the fix.
- Monthly: a short "what changed" release note; keep the tag cadence.

## Success metrics (first month)

- 100+ stars is a signal; 10 real `playground` runs is a better one.
- 3 external issues with a reproduction.
- 1 external team running it for a week.
- 0 unanswered security questions.

Stars are a lagging indicator of a thesis people repeat. The thesis is: **mandates, not omniscience.**
