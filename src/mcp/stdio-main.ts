import { runMcpStdio } from './stdio.js'

runMcpStdio().catch((error) => {
  process.stderr.write(`teamplane-mcp: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
