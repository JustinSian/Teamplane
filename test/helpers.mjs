import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { initProject, loadWorkspace } from '../dist/core/config.js'

export function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

export function seedRepo(repo) {
  mkdirSync(join(repo, 'src'), { recursive: true })
  mkdirSync(join(repo, 'tests'), { recursive: true })
  writeFileSync(join(repo, 'src', 'auth.ts'), 'export function rotate(token) {\n  return token\n}\n')
  writeFileSync(join(repo, 'tests', 'auth.test.js'), 'test("placeholder", () => {})\n')
  writeFileSync(join(repo, '.gitignore'), '.teamplane/\n.teamplane-worktrees/\n')
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.name', 'Teamplane Test'])
  git(repo, ['config', 'user.email', 'test@teamplane.dev'])
  git(repo, ['add', '.'])
  git(repo, ['commit', '-m', 'seed'])
}

export function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'teamplane-test-'))
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  seedRepo(repo)
  const init = initProject({ root: repo, name: 'test', owner: 'alice', port: 0 })
  const workspace = loadWorkspace(repo)
  return { root, repo, init, workspace }
}

export function commitFile(worktree, relative, content, message = 'change') {
  const target = join(worktree, relative)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
  git(worktree, ['config', 'user.name', 'Teamplane Test'])
  git(worktree, ['config', 'user.email', 'test@teamplane.dev'])
  git(worktree, ['add', relative])
  git(worktree, ['commit', '-m', message])
}
