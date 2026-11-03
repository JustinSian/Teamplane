import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject, loadWorkspace } from '../dist/core/config.js'
import { startServer } from '../dist/server/http.js'

const root = mkdtempSync(join(tmpdir(), 'teamplane-mcp-'))
const tree = join(root, 'repo')
const init = initProject({ root: tree, name: 'mcp-smoke', owner: 'alice', port: 0 })
const workspace = loadWorkspace(tree)
const running = await startServer(workspace, { port: 0, quiet: true })

const child = spawn(process.execPath, ['dist/mcp/stdio-main.js'], {
  env: { ...process.env, TEAMPLANE_URL: running.url, TEAMPLANE_TOKEN: init.token },
  stdio: ['pipe', 'pipe', 'inherit'],
})

const pending = new Map()
let nextId = 1
const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
rl.on('line', (line) => {
  const message = JSON.parse(line)
  const resolve = pending.get(message.id)
  if (resolve) {
    pending.delete(message.id)
    resolve(message)
  }
})

function request(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 5000)
    pending.set(id, (message) => {
      clearTimeout(timer)
      if (message.error) reject(new Error(`${method}: ${message.error.message}`))
      else resolve(message.result)
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
}

try {
  const initialized = await request('initialize', { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } })
  if (!initialized.protocolVersion) throw new Error('no protocolVersion')
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)

  const tools = await request('tools/list', {})
  if (!tools.tools.some((tool) => tool.name === 'tp_whoami')) throw new Error('tp_whoami missing')

  const whoami = await request('tools/call', { name: 'tp_whoami', arguments: {} })
  if (whoami.isError) throw new Error(`tp_whoami failed: ${whoami.content?.[0]?.text}`)

  const httpResponse = await fetch(`${running.url}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${init.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tp_whoami', arguments: {} } }),
  })
  const httpBody = await httpResponse.json()
  if (httpResponse.status !== 200 || httpBody.result?.isError) throw new Error(`HTTP MCP failed: ${JSON.stringify(httpBody)}`)

  console.log(`mcp smoke ok: ${tools.tools.length} tools, stdio + streamable HTTP`)
} finally {
  child.kill()
  await running.close()
  workspace.log.close()
  rmSync(root, { recursive: true, force: true })
}
