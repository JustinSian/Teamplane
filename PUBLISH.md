# Publish Teamplane to GitHub

This repository was built with a local git history and a bundle, so it can be pushed without a `gh` CLI or a token in this workspace.

## Option A — push with your own credentials (recommended)

1. Create an empty repository at `https://github.com/new`:
   - name: `teamplane`
   - private (recommended for the first push)
   - **do not** add README/.gitignore/license (the repository already has them)

2. From the repository directory:

```bash
git remote add origin https://github.com/JustinSian/teamplane.git
git push -u origin main
```

Git Credential Manager will open a browser the first time. If you use a token, paste it as the password (`ghp_...` or `github_pat_...`).

3. Check the rendered README, then make the repository public.

## Option B — push from the bundle

```bash
git clone dist/teamplane.bundle teamplane-push
cd teamplane-push
git branch -M main
git remote add origin https://github.com/JustinSian/teamplane.git
git push -u origin main
```

The bundle contains the full history (all commits), not just a snapshot.

## Option C — token in the environment

If `GH_TOKEN` is set, `node scripts/publish.mjs` creates the repository through the GitHub API and pushes. The script never prints the token and refuses to run without it.

```bash
export GH_TOKEN="github_pat_..."
node scripts/publish.mjs
```

Use a fine-grained token with **Contents: read/write** and **Administration: read/write** (only needed to create the repository), shortest expiry.

## Before making it public

```bash
git ls-files | grep -Ei "\.env$|\.key$|token|secret"   # should be empty
git log --oneline                                       # review the history
npm pack --dry-run                                      # review the package contents
npm test && npm run demo:ci && npm run mcp:smoke
```

- [ ] `.teamplane/` is not tracked (it is in `.gitignore`)
- [ ] no tokens, keys or personal email addresses in commits
- [ ] CI is green on the first push
- [ ] repository description: *A deterministic control plane for multi-user agent teams: signed mandates, resource leases, permissioned memory and an auditable merge gate.*
- [ ] topics: `agents` `multi-agent` `mcp` `deepseek-harness` `authorization` `capability` `coordination`

## npm (optional)

`npm publish` requires an npm account and 2FA. The package is `teamplane`, MIT, with `bin`, `dist/`, `web/`, `docs/` and `dsh-plugin/`. Do not publish until the GitHub repository and CI are public and green.
