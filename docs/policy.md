# Policy language

A policy is a JSON document. It is deliberately small: a team should be able to read the whole thing in one sitting.

Location: `.teamplane/policy.json` (editable copy). Applying it through `PUT /v1/policy` writes a `policy.updated` event and increments `version`.

## Shape

```json
{
  "version": 1,
  "default": "deny",
  "rules": [
    {
      "id": "agent-write",
      "description": "Agents may write only inside a mandate and while holding a lease.",
      "effect": "allow",
      "principals": ["role:agent", "role:maintainer"],
      "actions": ["fs.write"],
      "resources": ["*"],
      "conditions": { "all": [{ "field": "request.branch", "op": "eq", "value": "main" }] },
      "obligations": { "requireMandate": true, "requireLease": true }
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | monotonically increasing; the server rewrites it on apply |
| `default` | yes | `deny` (recommended) or `allow` when no rule matches |
| `rules[].id` | yes | unique; appears in decisions and audit events |
| `rules[].effect` | yes | `allow`, `deny`, `ask` |
| `rules[].principals` | yes | patterns: `*`, `role:owner`, `kind:agent`, `user:usr_...`, or a principal id |
| `rules[].actions` | yes | patterns: `fs.write`, `git.*`, `*` |
| `rules[].resources` | yes | patterns: `file:src/**`, `dir:src`, `branch:main`, `memory:team/*`, `*` |
| `rules[].conditions` | no | `all` / `any` leaves |
| `rules[].obligations` | no | what must also be true before the action runs |

## Decision procedure

1. Collect every rule where principal, action and resource match and conditions hold.
2. If any matched rule is `deny` → **deny**.
3. Else if any is `ask` → **ask**.
4. Else if any is `allow` → **allow**.
5. Else → `default`.

Order in the array does not matter. `deny` always wins. This makes a policy easy to reason about: adding a deny rule can only reduce authority.

`POST /v1/policy/explain` runs the same function and returns `{decision, ruleId, reason, matchedRules, policyVersion}`.

## Conditions

```json
{ "all": [
  { "field": "request.force", "op": "eq", "value": true },
  { "field": "time.hour", "op": "gte", "value": 9 }
] }
```

| Op | Meaning |
|---|---|
| `eq`, `ne` | deep equality |
| `in`, `not_in` | membership in an array |
| `gt`, `gte`, `lt`, `lte` | numeric comparison |
| `exists` | field is present and not null |
| `matches` | glob match (`*`, `?`) |

Fields are resolved from the request context: `actor.id`, `actor.kind`, `actor.roles`, `request.action`, `request.resource`, plus any `fields` supplied by the caller. There is no way for a condition to read memory contents or a transcript — policy sees facts, not prose.

## Obligations

| Obligation | Effect |
|---|---|
| `requireMandate` | the request must carry a valid `X-Teamplane-Mandate` |
| `requireLease` | a write must be covered by an active lease held by the mandate |
| `requireApproval` | an approval is needed before the action runs |
| `approvalRole` | which role may approve (`owner` by default) |
| `ttlSeconds` | approval lifetime |
| `maxBytes` | reserved for memory limits |

An `allow` rule with unfulfilled obligations becomes a deny (for mandate/lease) or an ask (for approval). The obligation, not the model, decides.

## Default policy

The shipped policy has eight rules:

| Rule | Effect | Who / what |
|---|---|---|
| `owner-all` | allow | owners, everything |
| `agent-read` | allow | agents, `fs.read` / `memory.read`, mandate required |
| `agent-write` | allow | agents, `fs.write`, mandate + lease required |
| `agent-coordinate` | allow | agents, lease/memory/submit, mandate required |
| `maintainer-issue` | allow | maintainers, create/start tasks and issue mandates |
| `viewer-read` | allow | viewers, read-only |
| `force-push-ask` | ask | anyone, force push to `main`, owner approval |
| `policy-owner` | allow | owners, policy/roles/revocation |

## What policy does not do

- It does not parse code or diffs.
- It does not consult memory.
- It does not call a model.
- It does not replace the mandate: policy answers "may this role do this kind of thing"; the mandate answers "may this task touch this specific thing". Both must pass.

## Commands

```bash
teamplane policy show
teamplane policy lint --file .teamplane/policy.json
teamplane policy apply --file .teamplane/policy.json
teamplane policy explain --action fs.write --resource file:src/auth.ts
```

`lint` checks schema, duplicate ids and empty match arrays. Invalid policies are refused with a `422` and a list of errors.
