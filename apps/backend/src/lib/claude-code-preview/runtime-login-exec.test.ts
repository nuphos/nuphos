import { expect, test } from 'bun:test'

import { loginFrameReader, readRuntimeLoginSocket } from './runtime-login-exec'

import type { RuntimeLoginFrame } from './runtime-login-exec'

function socketFixture(exit: 'Success' | 'Failure' | 'Disconnected') {
  const requests: { authorization: string | null; protocol: string | null }[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, instance) {
      requests.push({
        authorization: request.headers.get('authorization'),
        protocol: request.headers.get('sec-websocket-protocol'),
      })
      if (instance.upgrade(request, { headers: { 'sec-websocket-protocol': 'v4.channel.k8s.io' } }))
        return

      return new Response(null, { status: 400 })
    },
    websocket: {
      message() {
        /* This is an output-only exec session. */
      },
      open(socket) {
        const send = (channel: number, value: string) =>
          socket.sendBinary(Buffer.concat([Buffer.from([channel]), Buffer.from(value)]))

        send(2, 'sensitive provider stderr must never be surfaced')
        const frame = '{"models":["private-output"]}\n'

        send(1, frame.slice(0, 17))
        send(1, frame.slice(17))
        if (exit === 'Disconnected') socket.close()
        else send(3, JSON.stringify({ status: exit }))
      },
    },
  })

  return { server, requests, url: new URL(`ws://127.0.0.1:${server.port}/exec`) }
}

test('real WebSocket transport negotiates Kubernetes exec, ignores stderr, and requires a successful exit', async () => {
  for (const exit of ['Success', 'Failure', 'Disconnected'] as const) {
    const fixture = socketFixture(exit)
    let output = ''

    try {
      const result = readRuntimeLoginSocket(
        fixture.url,
        { headers: { Authorization: 'Bearer fixture' } },
        (chunk) => {
          output += chunk
        },
        AbortSignal.timeout(500),
      )

      if (exit === 'Success') await result
      else await expect(result).rejects.toThrow('Runtime login stopped')
      expect(fixture.requests).toEqual([
        { authorization: 'Bearer fixture', protocol: 'v4.channel.k8s.io' },
      ])
      expect(output).toBe('{"models":["private-output"]}\n')
    } finally {
      void fixture.server.stop(true)
    }
  }
})

test('archive input uses stdin frames and stdout preserves split UTF-8 characters', async () => {
  const input = Buffer.alloc(150_000, 97)
  const received: Buffer[] = []
  let output = ''
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, instance) {
      if (instance.upgrade(request, { headers: { 'sec-websocket-protocol': 'v4.channel.k8s.io' } }))
        return

      return new Response(null, { status: 400 })
    },
    websocket: {
      message(socket, message) {
        const data = Buffer.from(message)

        expect(data[0]).toBe(0)
        received.push(data.subarray(1))
        if (Buffer.concat(received).length === input.length) {
          const text = Buffer.from('中文檔案')

          socket.sendBinary(Buffer.concat([Buffer.from([1]), text.subarray(0, 2)]))
          socket.sendBinary(Buffer.concat([Buffer.from([1]), text.subarray(2)]))
          socket.sendBinary(Buffer.concat([Buffer.from([3]), Buffer.from('{"status":"Success"}')]))
        }
      },
    },
  })

  try {
    await readRuntimeLoginSocket(
      new URL(`ws://127.0.0.1:${server.port}/exec`),
      { headers: {} },
      (chunk) => {
        output += chunk
      },
      AbortSignal.timeout(1000),
      input,
    )
    expect(Buffer.concat(received)).toEqual(input)
    expect(output).toBe('中文檔案')
  } finally {
    await server.stop(true)
  }
})

test("only Claude's own authorize page reaches the UI, and a runtime's error is ours to word", () => {
  const frames: RuntimeLoginFrame[] = []
  const read = loginFrameReader((frame) => frames.push(frame))
  const url = 'https://claude.com/cai/oauth/authorize?code=true&state=s'

  read(`${JSON.stringify({ type: 'authorize', url })}\n`)
  for (const lookalike of [
    'https://evil.example/oauth/authorize',
    'http://claude.com/cai/oauth/authorize',
    'https://claude.com.evil.example/oauth/authorize',
    'https://claude.ai/login',
  ])
    expect(() => read(`${JSON.stringify({ type: 'authorize', url: lookalike })}\n`)).toThrow(
      'Invalid login response',
    )
  for (const reason of ['input_unavailable', 'failed', 'constructor', 'runtime words'])
    read(`${JSON.stringify({ type: 'error', reason })}\n`)

  expect(frames[0]).toEqual({ type: 'authorize', url })
  const messages = frames.slice(1).map((frame) => (frame.type === 'error' ? frame.message : ''))

  expect(messages[0]).toContain('claude auth login')
  expect(messages[1]).toContain('paste the whole code')
  // Anything the reader does not know gets the fixed message, never the runtime's words.
  expect(messages[2]).toBe(messages[3])
  expect(messages.join()).not.toContain('runtime words')
})
