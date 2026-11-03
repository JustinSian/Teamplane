/**
 * What does a file-level lease actually buy?
 *
 * Generates concurrent branch pairs against one base and measures two gates:
 *   1. a textual merge (`git merge-tree`)
 *   2. a file-level lease (`file:<path>`) acquired by the first writer
 *
 * The point is not to "prove" leases are free. They are conservative: a lease
 * blocks every same-file edit, including clean ones. This script quantifies
 * that trade-off so the docs can state it honestly.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TRIALS = Number(process.env.TRIALS ?? 30)
const FILES = 10
const LINES = 40
const root = mkdtempSync(join(tmpdir(), 'teamplane-bench-'))

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function must(args) {
  const result = git(args)
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

function writeLines(file, edits) {
  const lines = Array.from({ length: LINES }, (_, index) => `line ${index}`)
  for (const [index, value] of Object.entries(edits)) lines[Number(index)] = value
  writeFileSync(join(root, file), `${lines.join('\n')}\n`)
}

mkdirSync(root, { recursive: true })
must(['init', '-b', 'main'])
must(['config', 'user.name', 'Teamplane Bench'])
must(['config', 'user.email', 'bench@teamplane.dev'])
for (let file = 0; file < FILES; file += 1) writeLines(`f${file}.txt`, {})
must(['add', '.'])
must(['commit', '-m', 'base'])

const modes = ['same-line', 'other-line', 'other-file']
const results = Object.fromEntries(modes.map((mode) => [mode, { conflicts: 0, leaseBlocks: 0, gateBlocks: 0 }]))

for (const mode of modes) {
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const fileA = `f${trial % FILES}.txt`
    const fileB = mode === 'other-file' ? `f${(trial + 1) % FILES}.txt` : fileA

    must(['checkout', '-q', '-B', 'a', 'main'])
    writeLines(fileA, mode === 'same-line' ? { 5: 'A same line' } : { 30: 'A other line' })
    must(['add', '.'])
    must(['commit', '-m', 'a'])

    must(['checkout', '-q', '-B', 'b', 'main'])
    writeLines(fileB, mode === 'same-line' ? { 5: 'B same line' } : { 5: 'B other file line' })
    must(['add', '.'])
    must(['commit', '-m', 'b'])

    const merge = git(['merge-tree', '--write-tree', '--name-only', 'a', 'b'])
    const textual = merge.code !== 0
    const sameFile = fileA === fileB
    const lease = sameFile // an exclusive file: lease on fileA conflicts with any write by B to fileB
    const gate = textual // the merge gate rejects exactly the textual conflicts

    if (textual) results[mode].conflicts += 1
    if (lease) results[mode].leaseBlocks += 1
    if (gate) results[mode].gateBlocks += 1

    must(['checkout', '-q', 'main'])
    must(['branch', '-D', 'a'])
    must(['branch', '-D', 'b'])
  }
}

function pct(value) {
  return `${((value / TRIALS) * 100).toFixed(0)}%`
}

const lines = []
lines.push('# Why a file-level lease is conservative')
lines.push('')
lines.push(`Trials per mode: **${TRIALS}**. Repository: ${FILES} files, ${LINES} lines each.`)
lines.push('')
lines.push('| Concurrent edits | Textual conflict | `file:` lease blocks | Merge gate blocks |')
lines.push('|---|---|---|---|')
for (const mode of modes) {
  const row = results[mode]
  lines.push(`| ${mode} | ${row.conflicts}/${TRIALS} (${pct(row.conflicts)}) | ${row.leaseBlocks}/${TRIALS} (${pct(row.leaseBlocks)}) | ${row.gateBlocks}/${TRIALS} (${pct(row.gateBlocks)}) |`)
}
lines.push('')
lines.push('**Reading it:** a file-level lease catches every conflict, but it also blocks every clean same-file edit (`other-line`). That is the price of a decidable, cheap lock. The merge gate is the precise check; the lease is the cheap early signal. Symbol- or hunk-level leases would reduce the false positives, at the cost of a harder conflict predicate.')
lines.push('')
lines.push('Reproduce: `node bench/conflict-replay.mjs`. Set `TRIALS` to change the sample.')
lines.push('')

const report = lines.join('\n')
writeFileSync(new URL('./RESULTS.md', import.meta.url), report)
process.stdout.write(report)
rmSync(root, { recursive: true, force: true })
