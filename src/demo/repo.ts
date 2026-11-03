import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function seedRepo(repo: string): void {
  mkdirSync(join(repo, 'src'), { recursive: true })
  mkdirSync(join(repo, 'tests'), { recursive: true })
  mkdirSync(join(repo, 'docs'), { recursive: true })
  writeFileSync(join(repo, 'src', 'auth.ts'), 'export function rotate(token: string): string {\n  return token\n}\n')
  writeFileSync(join(repo, 'src', 'api.ts'), 'export function handler(): string {\n  return "ok"\n}\n')
  writeFileSync(join(repo, 'tests', 'auth.test.ts'), 'test("placeholder", () => {})\n')
  writeFileSync(join(repo, 'docs', 'README.md'), '# Acme\n')
  writeFileSync(join(repo, '.gitignore'), '.teamplane/\n.teamplane-worktrees/\nnode_modules/\n')
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.name', 'Teamplane Demo'])
  git(repo, ['config', 'user.email', 'demo@teamplane.dev'])
  git(repo, ['add', '.'])
  git(repo, ['commit', '-m', 'seed repo'])
}

export function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout ?? ''
}

export function gitCommit(cwd: string, message: string): void {
  git(cwd, ['config', 'user.name', 'Teamplane Demo'])
  git(cwd, ['config', 'user.email', 'demo@teamplane.dev'])
  git(cwd, ['add', '.'])
  git(cwd, ['commit', '-m', message])
}

export function commitFile(cwd: string, relative: string, content: string, message = 'change'): void {
  const target = join(cwd, relative)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
  git(cwd, ['config', 'user.name', 'Teamplane Demo'])
  git(cwd, ['config', 'user.email', 'demo@teamplane.dev'])
  git(cwd, ['add', relative])
  git(cwd, ['commit', '-m', message])
}
