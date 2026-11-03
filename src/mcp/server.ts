import { createInterface } from 'node:readline'
import type { McpApi } from './tools.js'
import { findTool, TOOLS } from './tools.js'

export const PROTOCOL_VERSION = '2026-07-28'
export const SERVER_INFO = { name: 'teamplane', version: '0.2.2' }

export interface McpBackendOptions {
  baseUrl: string
  token: string
  mandate?: string
}

export class HttpApi implements McpApi {
  constructor(private readonly options: McpBackendOptions) {}

  private async request(method: string, path: string, body?: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.options.token}`,
      'content-type': 'application/json',
    }
    if (this.options.mandate) headers['x-teamplane-mandate'] = this.options.mandate
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let payload: unknown = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = { raw: text }
    }
    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error: { message?: string } }).error?.message ?? text)
          : text || `HTTP ${response.status}`
      throw new Error(message)
    }
    return payload
  }

  get(path: string): Promise<unknown> {
    return this.request('GET', path)
  }

  post(path: string, body?: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', path, body ?? {})
  }

  del(path: string): Promise<unknown> {
    return this.request('DELETE', path)
  }
}

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export async function handleRpc(message: JsonRpcRequest, api: McpApi): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null
  const method = message.method
  const params = message.params ?? {}

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Teamplane is a deterministic control plane. Acquire a lease before touching a resource, write only inside your mandate, store curated memory instead of transcripts, and submit through tp_submit.',
      },
    }
  }

  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: TOOLS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
      },
    }
  }

  if (method === 'tools/call') {
    const name = String(params.name ?? '')
    const args = (params.arguments as Record<string, unknown> | undefined) ?? {}
    const tool = findTool(name)
    if (!tool) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } }
    }
    try {
      const result = await tool.call(api, args)
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: message }], isError: true },
      }
    }
  }

  if (method === 'resources/list') return { jsonrpc: '2.0', id, result: { resources: [] } }
  if (method === 'prompts/list') return { jsonrpc: '2.0', id, result: { prompts: [] } }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
}

export async function runStdio(api: McpApi): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of rl) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let message: JsonRpcRequest
    try {
      message = JSON.parse(trimmed) as JsonRpcRequest
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`)
      continue
    }
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } })}\n`)
      continue
    }
    const response = await handleRpc(message, api)
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
  }
}
