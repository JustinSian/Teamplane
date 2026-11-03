# How Teamplane compares

The honest version. All products change; these notes reflect public material as of November 2026.

## The short table

| | Authority | Coordination | Memory | Audit | Open / self-host |
|---|---|---|---|---|---|
| **Single agent + subagents** (DSH, Claude Code) | one process holds everything | none between users | session-local | logs | n/a |
| **Supervisor agent** (most multi-agent frameworks) | one over-privileged agent | central scheduling | shared transcript or blackboard | generated rationale | varies |
| **Dust** ("multiplayer AI") | workspace permissions | shared projects, todos, notifications | built-in team memory | enterprise audit, cost controls | no |
| **Tencent Cloud Team Memory** | role/user/agent permissions on memory | none | Chat/Wiki/CodeGraph/Skill assets | traceable calls | SDK |
| **DeepSeek Super-agent** | Router holds the mandate | Router/Worker + events | inline + spill, chain of recall | event log (prototype) | MIT prototype |
| **Teamplane** | **signed per-task mandates** | **typed leases + merge gate** | **ACL + provenance, no transcripts** | **hash-chained events** | **MIT** |

## When to choose each

### Single agent with subagents

Choose it when one person is doing one thing. It is the best product for that job, and Teamplane does not replace it. Teamplane starts where the second human (or the second independent agent) enters the repo.

### A supervisor agent

Choose it if you want a single conversational interface over many tools and you trust the supervisor's privilege boundary. Do not choose it if the supervisor will hold production credentials or read untrusted content while holding them.

### Dust

Choose Dust if you want a commercial workspace where humans and agents share projects, notifications and documents, with enterprise governance out of the box. Teamplane is not a workspace; it is the authority and coordination layer a workspace needs. They could be complementary: Dust as the surface, Teamplane as the gate.

### Tencent Cloud Team Memory

Choose it if the problem is team knowledge: chat history, wiki, code graph, reusable skills, with permissions on memory. Teamplane's memory model is deliberately narrower (curated fragments, no transcript ingestion) because its job is coordination, not knowledge management.

### DeepSeek Super-agent

Choose it if you are building a proactive agent that watches channels and works in the background. Super-agent's Router/Worker split and event-driven design are the closest prior art. Teamplane extends its `Mandate` from one user to many principals and moves the gate out of the model. If you already run DSH, use both: Super-agent for proactivity, Teamplane for cross-user authority.

## The three differences that matter

1. **Authority is per task, not per workspace.** A workspace role is too coarse; a session is too narrow. A mandate is the right grain.
2. **The gate is deterministic and outside the model.** This is the difference between a policy and a suggestion.
3. **The audit is a chain, not a log.** Anyone can verify that no event was changed, without trusting the process that wrote it.

## What we are not claiming

- Teamplane does not make agents smarter.
- It does not replace code review.
- It does not prevent semantic conflicts that your tests do not catch.
- It is not production-grade until [STATUS.md](../STATUS.md) says so.

## References

- Dust, *multiplayer operating system for enterprise AI* — [tech.eu](https://tech.eu/2026/05/18/dust-raises-40m-series-b-to-build-the-multiplayer-operating-system-for-enterprise-ai/)
- Tencent Cloud Team Memory — [overview](https://article.pchome.net/info/15346.html), [design note](https://cloud.tencent.com.cn/developer/article/2752618)
- DeepSeek Harness Super-agent — [report](https://m.ithome.com/html/1020615.htm), [prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)
- Collaborative Memory (ICML 2025) — [arXiv:2505.18279](https://arxiv.org/abs/2505.18279)
- MERGEGYM — [arXiv:2610.04779](https://arxiv.org/abs/2610.04779)
- ScopeGate — [arXiv:2606.28679](https://arxiv.org/abs/2606.28679)
- DelegateGuard — [arXiv:2610.16005](https://arxiv.org/abs/2610.16005)
