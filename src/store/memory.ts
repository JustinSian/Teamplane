import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MemoryFragment, State } from '../core/types.js'
import { canonicalJson, fail, parseJson } from '../core/util.js'

interface SealedMemory {
  v: 1
  alg: 'aes-256-gcm'
  iv: string
  tag: string
  data: string
}

function isSealed(value: unknown): value is SealedMemory {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.v === 1 && record.alg === 'aes-256-gcm' && typeof record.iv === 'string' && typeof record.tag === 'string' && typeof record.data === 'string'
}

/**
 * Memory content lives outside the event log so that `events.jsonl` never
 * contains private text. With the signing key present, fragments are sealed
 * with AES-256-GCM before they reach disk. The directory is 0700 and each file
 * is 0600; on Windows those bits are not ACLs.
 */
export class MemoryVault {
  readonly dir: string
  private readonly key: Buffer | null

  constructor(stateDir: string, secret?: string) {
    this.dir = join(stateDir, 'memory')
    this.key = secret
      ? Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from('teamplane.memory.v1'), Buffer.from('vault'), 32))
      : null
  }

  save(fragment: MemoryFragment): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const plain = canonicalJson(fragment)
    let payload = plain
    if (this.key) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', this.key, iv)
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      payload = canonicalJson({
        v: 1,
        alg: 'aes-256-gcm',
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      } satisfies SealedMemory)
    }
    writeFileSync(join(this.dir, `${fragment.id}.json`), `${payload}\n`, { mode: 0o600 })
  }

  load(id: string): MemoryFragment | null {
    const path = join(this.dir, `${id}.json`)
    if (!existsSync(path)) return null
    const parsed = parseJson<unknown>(readFileSync(path, 'utf8'), `memory/${id}.json`)
    if (!isSealed(parsed)) {
      // 0.4.x plaintext fragment: return it and re-seal on the next save.
      const fragment = parsed as MemoryFragment
      if (this.key) this.save(fragment)
      return fragment
    }
    if (!this.key) fail('memory_key_missing', `Memory ${id} is encrypted but the signing key is unavailable.`, 422)
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(parsed.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'))
      const plain = Buffer.concat([decipher.update(Buffer.from(parsed.data, 'base64')), decipher.final()]).toString('utf8')
      return parseJson<MemoryFragment>(plain, `memory/${id}.json`)
    } catch {
      fail('memory_corrupt', `Memory ${id} could not be decrypted.`, 422)
    }
  }

  /** Replace metadata-only projections with their content; migrate legacy text. */
  hydrate(state: State): void {
    for (const id of [...state.memory.keys()]) {
      const existing = state.memory.get(id)
      const fragment = this.load(id)
      if (fragment) state.memory.set(id, fragment)
      else if (existing?.text) this.save(existing)
      else state.memory.delete(id)
    }
  }

  remove(id: string): void {
    const path = join(this.dir, `${id}.json`)
    if (existsSync(path)) unlinkSync(path)
  }

  ids(): string[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
  }
}
