/**
 * dsh-teamplane-guard — an experimental DeepSeek Harness host plugin.
 *
 * It registers a synchronous `ctx.tools.guard` that fails closed when a tool
 * tries to write outside the signed mandate recorded in
 * `.teamplane/context.json`. The decision is local and deterministic: no model
 * and no network call are involved.
 */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, normalize, relative } from 'node:path'

export const name = 'teamplane-guard'
export const inject = ['tools']

const WRITE_TOOLS = new Set(['write', 'edit', 'str_replace_editor', 'apply_patch', 'fs_write', 'create_file'])
const PROTECTED_PREFIX = '.teamplane'

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function toPosix(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

function within(prefix, value) {
  const p = toPosix(prefix)
  const v = toPosix(value)
  if (p === '') return true
  return v === p || v.startsWith(`${p}/`)
}

function toolName(exec) {
  return exec?.name ?? exec?.tool?.name ?? exec?.toolName ?? exec?.call?.name ?? ''
}

function toolArgs(exec) {
  return exec?.args ?? exec?.arguments ?? exec?.call?.args ?? {}
}

function extractPath(args) {
  const value = args?.path ?? args?.file_path ?? args?.filePath ?? args?.filename
  if (typeof value !== 'string' || value === '') return null
  return value
}

export function createGuard(options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const context = readJson(join(cwd, '.teamplane', 'context.json'))
  const policy = readJson(join(cwd, '.teamplane', 'guard.json')) ?? {}
  const strict = options.strict ?? policy.strict ?? process.env.TEAMPLANE_GUARD === 'strict'
  const denyCommands = options.denyCommands ?? policy.denyCommands ?? defaultDeniedCommands

  return function guard(exec) {
    const tool = toolName(exec)
    const args = toolArgs(exec)

    if (tool === 'bash' || tool === 'pwsh' || tool === 'terminal') {
      const command = String(args?.command ?? args?.cmd ?? '')
      if (/[<>]/.test(command)) return 'teamplane: shell redirection is denied; use a file-write tool instead.'
      const denied = denyCommands.find((pattern) => command.includes(pattern))
      if (denied) return `teamplane: command denied by guard policy (${denied}).`
      if (strict && !context) return 'teamplane: no .teamplane/context.json; refusing shell access in strict mode.'
      return undefined
    }

    if (!WRITE_TOOLS.has(tool)) return undefined

    const target = extractPath(args)
    if (!target) return 'teamplane: a write tool must name its target path; denied.'

    const absolute = isAbsolute(target) ? normalize(target) : normalize(join(cwd, target))
    const relativePath = toPosix(relative(cwd, absolute))
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      return `teamplane: write outside the task worktree is denied (${target}).`
    }
    if (within(PROTECTED_PREFIX, relativePath)) {
      return 'teamplane: the .teamplane control directory is read-only to agents.'
    }
    if (!context) {
      return strict ? 'teamplane: no signed mandate; write denied in strict mode.' : undefined
    }
    const paths = Array.isArray(context.paths) ? context.paths : []
    if (paths.length === 0) {
      return `teamplane: mandate ${context.mandateId ?? 'unknown'} has no writable paths.`
    }
    if (!paths.some((prefix) => within(prefix, relativePath))) {
      return `teamplane: ${relativePath} is outside the mandate paths (${paths.join(', ')}).`
    }
    return undefined
  }
}

// Force pushes are deliberately absent: they are governed by the approval gate,
// which a synchronous local guard cannot consult. Add them in guard.json if the
// workflow never needs an approved force push.
const defaultDeniedCommands = ['git reset --hard', 'rm -rf /', 'shutdown', 'format c:']

export function apply(ctx, config = {}) {
  if (!ctx?.tools || typeof ctx.tools.guard !== 'function') return
  const guard = createGuard(config)
  ctx.tools.guard(guard)
}

export { within, toPosix, extractPath, defaultDeniedCommands }
