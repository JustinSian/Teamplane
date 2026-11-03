import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseJson } from '../core/util.js'
import { HttpApi, runStdio } from './server.js'

interface WorktreeContext {
  server: string | null
  taskId: string
  mandate: string | null
}

function readContext(cwd: string): WorktreeContext | null {
  const path = join(cwd, '.teamplane', 'context.json')
  if (!existsSync(path)) return null
  try {
    return parseJson<WorktreeContext>(readFileSync(path, 'utf8'), 'context.json')
  } catch {
    return null
  }
}

export async function runMcpStdio(cwd = process.cwd()): Promise<void> {
  const context = readContext(cwd)
  const baseUrl = process.env.TEAMPLANE_URL ?? context?.server ?? ''
  const token = process.env.TEAMPLANE_TOKEN ?? ''
  const mandate = process.env.TEAMPLANE_MANDATE ?? context?.mandate ?? undefined

  if (!baseUrl) {
    process.stderr.write('teamplane-mcp: set TEAMPLANE_URL (or run inside a task worktree with .teamplane/context.json)\n')
    process.exit(2)
  }
  if (!token) {
    process.stderr.write('teamplane-mcp: set TEAMPLANE_TOKEN to a principal token\n')
    process.exit(2)
  }

  await runStdio(new HttpApi({ baseUrl, token, mandate }))
}
