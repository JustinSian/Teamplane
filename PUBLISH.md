# Publish Teamplane to GitHub

This repository was built with a local git history and a bundle, so it can be pushed without a `gh` CLI or a token in this workspace.

## Option A — push with your own credentials (recommended)

1. Create an empty repository at `https://github.com/new`:
   - name: `teamplane`
   - private (recommended for the first push)
   - **do not** add README/.gitignore/license (the repository already has them)

2. From the repository directory:

```bash
git remote add origin https://github.com/JustinSian/Teamplane.git
git push -u origin main --follow-tags
```

Git Credential Manager will open a browser the first time. If you use a token, paste it as the password (`ghp_...` or `github_pat_...`).

If this machine has an SSH key registered with GitHub, SSH works even when HTTPS to `github.com` is reset:

```bash
git remote set-url origin git@github.com:JustinSian/Teamplane.git
GIT_TERMINAL_PROMPT=0 git push -u origin main --follow-tags
```

3. Check the rendered README, then make the repository public.

## Option B — push from the bundle

```bash
git clone dist/teamplane.bundle teamplane-push
cd teamplane-push
git branch -M main
git remote add origin https://github.com/JustinSian/Teamplane.git
git push -u origin main --follow-tags
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

## After the repository is public

- [ ] **Settings → Pages**: Source = *GitHub Actions*. The `pages` workflow deploys `site/` on every push to `main`.
- [ ] **Settings → General → Social preview**: upload `docs/assets/social.png` (1280×640). GitHub does not accept SVG here.
- [ ] **Settings → Code security**: enable **Secret scanning** and **Push protection** (free for public repositories).
- [ ] **About**: description from `package.json`, website = the Pages URL, topics: `agents` `multi-agent` `mcp` `deepseek-harness` `authorization` `capability` `coordination` `ai-agents`.
- [ ] **Actions**: confirm `ci`, `pages` and (after a tag) `release` are green.
- [ ] **Releases**: publish the existing `v0.1.0` tag as a release, or tag `v0.2.0` after the product-surface changes.
- [ ] **Discussions**: enable if you want the "what breaks it" conversations in one place.

## npm (optional)

`npm publish` requires an npm account and 2FA. The package is `teamplane`, MIT, with `bin`, `dist/`, `web/`, `docs/` and `dsh-plugin/`. Do not publish until the GitHub repository and CI are public and green.
