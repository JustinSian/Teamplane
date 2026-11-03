/**
 * Create the GitHub repository and push, using GH_TOKEN from the environment.
 * Never prints the token. Requires the `repo` scope (or Contents + Administration
 * for a fine-grained token).
 */
import { spawnSync } from 'node:child_process'

const token = process.env.GH_TOKEN
if (!token) {
  console.error('GH_TOKEN is not set. See PUBLISH.md for the manual path.')
  process.exit(2)
}

const user = process.env.GH_USER ?? 'JustinSian'
const name = process.env.GH_REPO ?? 'teamplane'
const description =
  'A deterministic control plane for multi-user agent teams: signed mandates, resource leases, permissioned memory and an auditable merge gate.'

const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'content-type': 'application/json',
  'user-agent': 'teamplane-publish',
}

const response = await fetch('https://api.github.com/user/repos', {
  method: 'POST',
  headers,
  body: JSON.stringify({ name, description, private: true, has_issues: true, has_wiki: false }),
})

if (response.status === 422) {
  console.log(`repository ${user}/${name} already exists; pushing to it`)
} else if (!response.ok) {
  console.error(`GitHub API ${response.status}: ${(await response.text()).slice(0, 500)}`)
  process.exit(1)
} else {
  console.log(`created ${user}/${name}`)
}

function git(args) {
  const result = spawnSync('git', args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const remotes = spawnSync('git', ['remote'], { encoding: 'utf8' }).stdout ?? ''
if (!remotes.split('\n').includes('origin')) {
  git(['remote', 'add', 'origin', `https://github.com/${user}/${name}.git`])
}
git(['push', '-u', 'origin', 'HEAD:main'])
console.log(`pushed: https://github.com/${user}/${name}`)
