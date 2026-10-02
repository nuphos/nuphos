// Stdio MCP server that forwards each JSON-RPC message to one Nuphos MCP
// endpoint (Streamable HTTP, JSON-response mode) and authorizes every request
// with the conversation token OpenAB keeps current in OPENAB_CREDENTIALS_DIR.
import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

// A missing file means OpenAB revoked the credential: send no authorization.
export function currentAuthorization(env) {
  try {
    const token = readFileSync(join(env.OPENAB_CREDENTIALS_DIR, 'NUPHOS_TOKEN'), 'utf8').trim()
    return token ? `Bearer ${token}` : undefined
  } catch {
    return undefined
  }
}

// Decision waits can hold a tool call open for many minutes, so no timeouts.
export function postJson(url, headers, body) {
  const transport = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      { method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(body) } },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        )
        response.on('error', reject)
      },
    )
    request.on('error', reject)
    request.end(body)
  })
}

function requestIds(message) {
  return (Array.isArray(message) ? message : [message])
    .filter((entry) => entry && typeof entry.method === 'string' && entry.id != null)
    .map((entry) => entry.id)
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export async function relay(line, { url, env, post = postJson, write }) {
  const message = parseJson(line)
  if (message === undefined) {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    return
  }
  const fail = (text) => {
    for (const id of requestIds(message))
      write({ jsonrpc: '2.0', id, error: { code: -32000, message: text } })
  }
  const authorization = currentAuthorization(env)
  let response
  try {
    response = await post(
      url,
      {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(authorization ? { authorization } : {}),
      },
      JSON.stringify(message),
    )
  } catch (error) {
    fail(`Nuphos MCP request failed: ${error?.code ?? error?.message ?? 'network error'}`)
    return
  }
  const text = response.text.trim()
  const body = text ? parseJson(text) : undefined
  if (body && (Array.isArray(body) || body.jsonrpc === '2.0')) {
    write(body)
    return
  }
  if (response.status >= 300 || text) {
    fail(`Nuphos MCP HTTP ${String(response.status)}${text ? `: ${text.slice(0, 500)}` : ''}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = new URL(process.argv[2])
  const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
  createInterface({ input: process.stdin }).on('line', (line) => {
    if (line.trim()) void relay(line, { url, env: process.env, write })
  })
}
