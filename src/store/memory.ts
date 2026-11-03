import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MemoryFragment, State } from '../core/types.js'
import { canonicalJson, parseJson } from '../core/util.js'

/**
 * Memory content lives outside the event log so that `events.jsonl` never
 * contains private text. The vault is still plaintext at rest; its directory
 * is 0700 and each file is 0600. On Windows these bits are not ACLs — run the
 * control plane on a host you trust, or add an explicit ACL.
 */
export class MemoryVault {
  readonly dir: string

  constructor(stateDir: string) {
    this.dir = join(stateDir, 'memory')
  }

  save(fragment: MemoryFragment): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    writeFileSync(join(this.dir, `${fragment.id}.json`), `${canonicalJson(fragment)}\n`, { mode: 0o600 })
  }

  load(id: string): MemoryFragment | null {
    const path = join(this.dir, `${id}.json`)
    if (!existsSync(path)) return null
    try {
      return parseJson<MemoryFragment>(readFileSync(path, 'utf8'), `memory/${id}.json`)
    } catch {
      return null
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
