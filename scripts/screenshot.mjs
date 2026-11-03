/**
 * Deterministic screenshots through the Chrome DevTools Protocol.
 * Usage: node scripts/screenshot.mjs --url <url> --out <file> [--width 1440] [--height 1000] [--wait 2000]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}

const url = arg('url')
const out = arg('out')
const width = Number(arg('width', '1440'))
const height = Number(arg('height', '1000'))
const wait = Number(arg('wait', '2500'))
if (!url || !out) {
  console.error('usage: node scripts/screenshot.mjs --url <url> --out <file>')
  process.exit(2)
}

const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const port = 9333
const profile = mkdtempSync(join(tmpdir(), 'teamplane-cdp-'))
const browser = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' })

async function waitForJson(path, method = 'GET', timeoutMs = 15000) {
  const started = Date.now()
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method })
      if (response.ok) return await response.json()
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > timeoutMs) throw new Error('DevTools endpoint did not start')
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

function cdp(ws) {
  let next = 1
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(`${message.error.message}`))
      else resolve(message.result)
    }
  })
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = next++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
}

try {
  await waitForJson('/json/version')
  const target = await waitForJson(`/json/new?${encodeURIComponent(url)}`, 'PUT')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  const send = cdp(ws)
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url })
  await new Promise((resolve) => setTimeout(resolve, wait))
  if (process.env.DEBUG_SCREENSHOT) {
    const info = await send('Runtime.evaluate', {
      expression:
        "JSON.stringify({appHidden: document.querySelector('#app')?.hidden, gateHidden: document.querySelector('#gate')?.hidden, error: document.querySelector('#gate-error')?.textContent, tasks: document.querySelector('#stat-tasks')?.textContent, url: location.href})",
      returnByValue: true,
    })
    console.log(info.result?.value)
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(`wrote ${out} (${width}x${height})`)
  ws.close()
} finally {
  browser.kill()
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    /* the temporary browser profile can stay locked for a moment */
  }
}
