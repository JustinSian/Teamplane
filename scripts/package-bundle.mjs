import { mkdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

mkdirSync('dist', { recursive: true })
const result = spawnSync('git', ['bundle', 'create', 'dist/teamplane.bundle', '--all'], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
const size = statSync('dist/teamplane.bundle').size
console.log(`dist/teamplane.bundle  ${(size / 1024).toFixed(1)} KiB`)
