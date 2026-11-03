import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { createGuard } from '../../dsh-plugin/index.js'

/**
 * This is the compatibility test the fake-ctx unit test cannot give us:
 * the guard runs inside the real @deepseek-ai/dsh-tools pipeline, after the
 * extensible pre-execute waterfall, and a denial is returned as a tool error.
 */
test('the guard runs inside the real DSH tool pipeline', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'teamplane-dsh-runtime-'))
  mkdirSync(join(cwd, '.teamplane'), { recursive: true })
  writeFileSync(
    join(cwd, '.teamplane', 'context.json'),
    JSON.stringify({ taskId: 'tsk_real', mandateId: 'mnd_real', paths: ['src/auth.ts'] }),
  )

  const ctx = new Context()
  ctx.systemPrompt = { tools() {} }
  const runtime = new ToolRuntime(ctx, { mode: 'native' })
  runtime.guard(createGuard({ cwd }))

  runtime.register(
    defineTool({
      name: 'write',
      description: 'write a file',
      parameters: { path: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        return `wrote ${args.path}`
      },
    }),
  )

  const run = (path, index) =>
    runtime.execute({
      callId: `call-${index}`,
      name: 'write',
      arguments: { path },
      signal: new AbortController().signal,
    })

  try {
    const allowed = await run('src/auth.ts', 1)
    assert.equal(allowed.isError, false)
    assert.equal(allowed.value, 'wrote src/auth.ts')

    const denied = await run('src/other.ts', 2)
    assert.equal(denied.isError, true)
    assert.match(denied.error.message, /outside the mandate/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
