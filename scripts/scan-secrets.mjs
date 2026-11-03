/**
 * Dependency-free secret scan for tracked files.
 *
 * It is deliberately conservative: it reports the file, line and pattern name,
 * never the matched value. Known test fixtures are allowlisted by file.
 *
 * Usage:
 *   node scripts/scan-secrets.mjs            # tracked working tree
 *   node scripts/scan-secrets.mjs --history  # every added line in git history
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const PATTERNS = [
  { name: 'aws_access_key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'github_token', re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'github_pat', re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'openai_key', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'slack_token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'google_api_key', re: /AIza[0-9A-Za-z_-]{35}/ },
]

const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|zip|gz|tgz|bundle|asar|pdf)$/i

// Files that intentionally contain a pattern as a fixture or documentation.
const ALLOW = new Map([
  ['test/integration/service.test.mjs', new Set(['aws_access_key'])],
  ['scripts/scan-secrets.mjs', new Set(PATTERNS.map((pattern) => pattern.name))],
  ['src/domain/service.ts', new Set(['aws_access_key', 'github_token', 'openai_key', 'private_key'])],
  ['docs/threat-model.md', new Set(['private_key'])],
  ['docs/security.md', new Set(['private_key'])],
])

function allowed(file, pattern) {
  return ALLOW.get(file)?.has(pattern) ?? false
}

function scanText(file, text, addedOnly = false) {
  const findings = []
  const lines = text.split(String.fromCharCode(10))
  for (const [index, line] of lines.entries()) {
    if (addedOnly && !line.startsWith('+')) continue
    for (const pattern of PATTERNS) {
      if (allowed(file, pattern.name)) continue
      if (pattern.re.test(line)) findings.push({ file, line: index + 1, pattern: pattern.name })
    }
  }
  return findings
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'buffer' })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
}

const findings = []
const history = process.argv.includes('--history')

if (history) {
  const log = execFileSync('git', ['log', '--all', '-p', '--pretty=format:COMMIT %h %s'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  let file = '(unknown)'
  for (const line of log.split(String.fromCharCode(10))) {
    if (line.startsWith('COMMIT ')) continue
    if (line.startsWith('+++ b/')) {
      file = line.slice(6)
      continue
    }
    if (!line.startsWith('+')) continue
    for (const pattern of PATTERNS) {
      if (allowed(file, pattern.name)) continue
      if (pattern.re.test(line)) findings.push({ file, line: 0, pattern: pattern.name })
    }
  }
} else {
  for (const file of trackedFiles()) {
    if (BINARY.test(file)) continue
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    findings.push(...scanText(file, text))
  }
}

if (findings.length === 0) {
  console.log(history ? 'secret scan (history): clean' : 'secret scan: clean')
  process.exit(0)
}

console.error(`secret scan: ${findings.length} finding(s)`)
for (const finding of findings) {
  console.error(`  ${finding.file}${finding.line ? `:${finding.line}` : ''}  ${finding.pattern}`)
}
process.exit(1)
