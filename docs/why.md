# Why Teamplane exists

Agent teams do not fail because the models are not smart enough. They fail because **nobody decided who is allowed to do what.**

Three agents are editing one repository. One is refactoring auth, one is adding tests, one is fixing docs. Each is competent. Together they produce a stale branch, a duplicated investigation, a force push to `main`, and a chat log that contains the answer nobody can find.

The industry's answer is to add a supervisor: a larger agent that reads every session, remembers everything and approves every action. It demos well. It is also the most over-privileged component in the system, its reasons are generated text, and it reads the untrusted content it is supposed to police.

Teamplane is the opposite bet.

## The supervisor trap

A supervisor agent has three properties that no prompt fixes:

1. **It is a single point of failure.** If it is down, the team stops. If it is confused, every task is confused.
2. **It is a confused deputy.** It holds credentials for everything, so any injection that reaches it inherits everything.
3. **It is unauditable.** "The supervisor decided" is not a reason a security review can accept.

The alternative is not "no coordination". It is **coordination built from small, verifiable pieces**:

- a signature that says who may do what, for how long, on which task;
- a policy function that returns the same answer every time;
- a lease that says who owns the file right now;
- an event log that can be replayed and checked.

## Three moves

### 1. Authority is a signature, not a role

A role says "you are an engineer". A mandate says "you, for this task, may write `src/auth.ts` and `tests/auth`, on branch `tp/tsk_...`, until 14:30, under policy v3". The second is what a team actually needs.

Mandates attenuate. A derived mandate must be a strict subset of its parent — narrower paths, fewer actions, shorter expiry. There is no operation that widens one. Verification is offline; revocation is an event.

### 2. The gate is a function, not a conversation

`deny > ask > allow > default deny`. No model. No clock. No IO. The same inputs produce the same decision, which means a reviewer can replay it.

Approvals are single-use, bound to an action hash, and expire. A force push is not "the supervisor thought it was fine"; it is a recorded owner decision, consumed once.

Leases are typed (`file:`, `dir:`, `branch:`, `memory:`) with decidable containment and monotonically increasing fencing. The merge gate then verifies with `git merge-tree` and your own commands. When exact replay is cheap — it is, about 20 ms — verify, do not predict.

### 3. Coordinate with events, not transcripts

A team does not need everyone's conversation. It needs to know: who owns this file, what was decided, what broke, who approved it.

So memory is curated fragments with provenance and visibility, not a transcript lake. Coordination is a typed event stream, not a feed of everything everyone said. The team sees conclusions; the conversations stay where they belong.

## What we refuse to build

- An omniscient supervisor.
- A model in the decision path.
- A memory store that ingests raw sessions.
- A security claim we cannot test.
- A product that needs a cloud account to show you what it does.

## What would change our mind

This design should be rejected if:

- a principal can exceed its mandate through derivation, replay or a stale lease;
- two agents can merge conflicting changes through the gate;
- a reader can see a fragment outside its visibility;
- the event log cannot detect a mutation;
- or the whole thing is too annoying to use, which is the failure mode engineers underestimate.

The tests in `test/` are the first four. The fifth is why `teamplane playground` exists.

## Try it, then break it

```bash
npm install && npm run build && npm link
teamplane playground --open
```

Then read `docs/threat-model.md` and open an issue with the scenario that breaks it. A negative result is more useful than a star.
