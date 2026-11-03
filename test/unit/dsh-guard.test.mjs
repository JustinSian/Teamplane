import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGuard } from '../../dsh-plugin/index.js'

function workspace(paths = ['src/auth.ts']) {
  const cwd = mkdtempSync(join(tmpdir(), 'teamplane-guard-'))
  mkdirSync(join(cwd, '.teamplane'), { recursive: true })
  writeFileSync(join(cwd, '.teamplane', 'context.json'), JSON.stringify({ taskId: 'tsk_1', mandateId: 'mnd_1', paths }))
  return cwd
}

test('guard allows writes inside the mandate', () => {
  const guard = createGuard({ cwd: workspace() })
  assert.equal(guard({ name: 'write', args: { path: 'src/auth.ts' } }), undefined)
})

test('guard denies writes outside the mandate and outside the worktree', () => {
  const cwd = workspace()
  const guard = createGuard({ cwd })
  assert.match(guard({ name: 'write', args: { path: 'src/other.ts' } }), /outside the mandate/)
  assert.match(guard({ name: 'write', args: { path: '../escape.ts' } }), /outside the task worktree/)
  assert.match(guard({ name: 'write', args: { path: '.teamplane/context.json' } }), /read-only/)
})

test('guard denies configured shell commands', () => {
  const guard = createGuard({ cwd: workspace(), denyCommands: ['git push --force'] })
  assert.match(guard({ name: 'bash', args: { command: 'git push --force origin main' } }), /command denied/)
  assert.equal(guard({ name: 'bash', args: { command: 'npm test' } }), undefined)
})

test('strict mode fails closed without a mandate', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'teamplane-guard-empty-'))
  const guard = createGuard({ cwd, strict: true })
  assert.match(guard({ name: 'write', args: { path: 'src/a.ts' } }), /no signed mandate/)
})
