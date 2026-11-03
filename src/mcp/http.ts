import type { IncomingMessage, ServerResponse } from 'node:http'
import { fail, parseJson } from '../core/util.js'
import { HttpApi, handleRpc, type JsonRpcRequest } from './server.js'

const MAX_BODY = 1024 * 1024

export interface McpHttpOptions {
  baseUrl: string
  token: string
  mandate?: string
}

export async function handleMcpHttp(req: IncomingMessage, res: ServerResponse, options: McpHttpOptions): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Use POST for MCP' } }))
    return
  }

  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY) fail('body_too_large', 'MCP request body exceeds 1 MiB.', 413)
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Empty body' } }))
    return
  }

  const api = new HttpApi(options)
  let payload: JsonRpcRequest | JsonRpcRequest[]
  try {
    payload = parseJson<JsonRpcRequest | JsonRpcRequest[]>(text, 'MCP body')
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }))
    return
  }

  if (Array.isArray(payload)) {
    const responses = []
    for (const message of payload) {
      const response = await handleRpc(message, api)
      if (response) responses.push(response)
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(responses))
    return
  }

  const response = await handleRpc(payload, api)
  if (!response) {
    res.writeHead(202, { 'cache-control': 'no-store' })
    res.end()
    return
  }
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(response))
}
