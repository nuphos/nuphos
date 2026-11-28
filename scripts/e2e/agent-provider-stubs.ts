// Loopback stand-ins for the APIs Codex and Claude Code run on: an Azure OpenAI resource and an
// Anthropic-compatible gateway. Each answers every turn with one line and records what it was sent.
import { createServer } from 'node:http'

import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export type Request = { method: string; url: string; bearer: boolean; model?: string }

/** Desktop sends every Azure resource's requests here instead (desktop.ts). */
export const AZURE_STAND_IN_PORT = 47231

type Stub = { url: string; seen: Request[]; server: Server }

function listen(
  port: number,
  answer: (req: Request, stream: boolean) => [number, string, string?],
) {
  const seen: Request[] = []
  const server = createServer((req, res) => {
    let body = ''

    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      const json = (body ? JSON.parse(body) : {}) as { model?: string; stream?: boolean }
      const request = {
        method: req.method ?? '',
        url: req.url ?? '',
        bearer: /^Bearer \S/u.test(req.headers.authorization ?? ''),
        model: json.model,
      }

      seen.push(request)
      const [status, text, type = 'application/json'] = answer(request, json.stream === true)

      res.writeHead(status, { 'content-type': type }).end(text)
    })
  })

  return new Promise<Stub>((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address() as AddressInfo

      resolve({ url: `http://127.0.0.1:${String(address.port)}`, seen, server })
    })
  })
}

const events = (list: [string, object][]) =>
  list
    .map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
    .join('')

/** An Azure OpenAI resource: its model list, and the Responses API of its v1 API. */
export function azureStub(port: number, text: string) {
  return listen(port, ({ method, url, model }) => {
    if (method === 'GET' && url.startsWith('/openai/models')) return [200, '{"data":[]}']
    if (method !== 'POST' || !url.startsWith('/openai/v1/responses')) return [404, '']
    const item = {
      type: 'message',
      id: 'msg_e2e',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    }
    const usage = {
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    }
    const response = { id: 'resp_e2e', model, output: [item], usage }

    return [
      200,
      events([
        ['response.created', { response: { ...response, status: 'in_progress', output: [] } }],
        ['response.output_item.done', { output_index: 0, item }],
        ['response.completed', { response: { ...response, status: 'completed' } }],
      ]),
      'text/event-stream',
    ]
  })
}

/** An Anthropic-compatible gateway: its model list, and the Messages API. */
export function anthropicStub(text: string) {
  return listen(0, ({ method, url, model }, stream) => {
    if (method === 'GET' && url.startsWith('/v1/models'))
      return [200, JSON.stringify({ data: [{ id: model ?? 'claude-e2e', type: 'model' }] })]
    if (method !== 'POST' || !/^\/v1\/messages(\?|$)/u.test(url)) return [404, '']
    const message = {
      id: 'msg_e2e',
      type: 'message',
      role: 'assistant',
      model,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }

    if (!stream)
      return [
        200,
        JSON.stringify({ ...message, content: [{ type: 'text', text }], stop_reason: 'end_turn' }),
      ]

    return [
      200,
      events([
        ['message_start', { message: { ...message, content: [], stop_reason: null } }],
        ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { index: 0, delta: { type: 'text_delta', text } }],
        ['content_block_stop', { index: 0 }],
        [
          'message_delta',
          { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
        ],
        ['message_stop', {}],
      ]),
      'text/event-stream',
    ]
  })
}
