import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (entry.endsWith('.test.mjs')) out.push(path)
  }
  return out
}

const files = walk('test').sort()
if (files.length === 0) {
  console.error('no test files found')
  process.exit(1)
}
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { stdio: 'inherit' })
process.exit(result.status ?? 1)
