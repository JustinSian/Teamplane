import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { posix } from 'node:path'

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export class TeamplaneError extends Error {
  readonly code: string
  readonly status: number
  readonly details: JsonValue | undefined

  constructor(code: string, message: string, status = 400, details?: JsonValue) {
    super(message)
    this.name = 'TeamplaneError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export function fail(code: string, message: string, status = 400, details?: JsonValue): never {
  throw new TeamplaneError(code, message, status, details)
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

function base36(n: number): string {
  if (n === 0) return '0'
  let out = ''
  while (n > 0) {
    out = ID_ALPHABET[n % 36] + out
    n = Math.floor(n / 36)
  }
  return out
}

export function id(prefix: string): string {
  const time = base36(Date.now())
  const rand = randomBytes(6).toString('hex')
  return `${prefix}_${time}${rand}`
}

export function uuid(): string {
  return randomUUID()
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

export function randomToken(prefix = 'tp'): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`
}

/** Stable JSON: sorted keys, no whitespace. Used for hashes and signatures. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sortValue)
  const record = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    const child = record[key]
    if (child === undefined) continue
    out[key] = sortValue(child)
  }
  return out
}

export function hashObject(value: unknown): string {
  return sha256(canonicalJson(value))
}

/** Parse `15m`, `2h`, `30s` or a bare number of seconds. */
export function parseDuration(input: string | number): number {
  if (typeof input === 'number') return Math.max(0, Math.floor(input))
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(input.trim())
  if (!match) fail('invalid_duration', `Cannot parse duration: ${input}`, 422)
  const amount = Number(match[1])
  const unit = match[2] ?? 's'
  const factor = unit === 'ms' ? 0.001 : unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400
  return Math.max(0, Math.floor(amount * factor))
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString()
}

export function isExpired(iso: string, now = nowIso()): boolean {
  return new Date(iso).getTime() <= new Date(now).getTime()
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Glob-ish matching: `*` matches any run of characters, `?` one character. */
export function matchPattern(pattern: string, value: string): boolean {
  if (pattern === '*') return true
  if (!pattern.includes('*') && !pattern.includes('?')) return pattern === value
  const source = pattern
    .split('')
    .map((char) => {
      if (char === '*') return '[\\s\\S]*'
      if (char === '?') return '[\\s\\S]'
      return escapeRegex(char)
    })
    .join('')
  return new RegExp(`^${source}$`).test(value)
}

export function normalizePath(input: string): string {
  const normalized = posix.normalize(input.replace(/\\/g, '/'))
  const trimmed = normalized.replace(/^\.\//, '').replace(/\/+$/, '')
  if (trimmed === '.' || trimmed === '') return ''
  return trimmed
}

/** True when `child` is the same as `parent` or lives below it. */
export function withinPath(parent: string, child: string): boolean {
  const p = normalizePath(parent)
  const c = normalizePath(child)
  if (p === '') return true
  return c === p || c.startsWith(`${p}/`)
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function parseJson<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    fail('invalid_json', `Invalid JSON in ${what}`, 422)
  }
}
