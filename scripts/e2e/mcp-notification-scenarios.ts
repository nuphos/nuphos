import { rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { agentEvents } from './agent-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { askOverMcp, mcp, prompt } from './mcp-scenarios.ts'
import { until } from './processes.ts'

import type { Scenario } from './ui.ts'

/** Reads SSE frames in wire order, preserving partial frames between chunks. */
function notifications(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder()
  let buffer = ''

  return async () => {
    for (;;) {
      const boundary = buffer.indexOf('\n\n')

      if (boundary >= 0) {
        const frame = buffer.slice(0, boundary)

        buffer = buffer.slice(boundary + 2)
        const data = /^data: (.+)$/m.exec(frame)?.[1]
        const id = /^id: (.+)$/m.exec(frame)?.[1]

        if (data && id)
          return { id, body: JSON.parse(data) as { params: { status: string; answer?: string } } }
        continue
      }
      const next = await reader.read()

      must(!next.done, 'the subscription to stay open until the notification')
      buffer += decoder.decode(next.value, { stream: true })
    }
  }
}

async function subscribe(
  stack: { apiUrl: string; token: string },
  sessionId: string,
  last?: string,
) {
  const response = await fetch(`${stack.apiUrl}/mcp?session_id=${sessionId}`, {
    headers: { authorization: `Bearer ${stack.token}`, ...(last ? { 'Last-Event-ID': last } : {}) },
    signal: AbortSignal.timeout(30_000),
  })

  must(response.ok && response.body !== null, 'the authenticated SSE subscription')

  return response.body.getReader()
}

/** Observes a settled stream for three keepalives, counting actual completed notifications. */
async function completionCount(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
  lastId: string,
  alreadyCompleted = false,
) {
  const decoder = new TextDecoder()
  let buffer = '',
    count = 0,
    keepalives = 0,
    completedId = lastId

  while (keepalives < 3) {
    const next = await reader.read()

    must(!next.done, 'the resumed connection to stay open')
    buffer += decoder.decode(next.value, { stream: true })
    let boundary = buffer.indexOf('\n\n')

    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary)

      buffer = buffer.slice(boundary + 2)
      if (frame.startsWith(': keepalive') && (count > 0 || alreadyCompleted)) keepalives++
      const data = /^data: (.+)$/m.exec(frame)?.[1]
      const id = /^id: (.+)$/m.exec(frame)?.[1]

      if (data && id) {
        must(id !== lastId, 'Last-Event-ID to suppress a snapshot already delivered')
        const event = JSON.parse(data) as { params: { status: string; answer?: string } }

        if (event.params.status === 'completed' && event.params.answer?.includes(`ACK ${marker}`)) {
          count++
          completedId = id
        }
      }
      boundary = buffer.indexOf('\n\n')
    }
  }

  return { count, completedId }
}

export const mcpNotificationScenarios: Scenario[] = [
  {
    name: 'MCP subscription slots reject excess streams and allow reconnect after disconnect',
    expected: /"method":"GET","path":"\/mcp","status":429/,
    run: async (_page, stack) => {
      const { tool } = mcp(client(stack.apiUrl, stack.token))
      const sessionId = await askOverMcp(tool, stack.teamId, 'E2E_DELIVERY:mcp-subscription-limit')
      const readers = await Promise.all(
        Array.from({ length: 3 }, () => subscribe(stack, sessionId)),
      )

      try {
        const first = await Promise.all(readers.map((reader) => notifications(reader)()))
        const extra = await fetch(`${stack.apiUrl}/mcp?session_id=${sessionId}`, {
          headers: { authorization: `Bearer ${stack.token}` },
        })

        must(
          extra.status === 429 && extra.headers.get('retry-after') === '5',
          'the fourth stream to be limited',
        )
        await readers[0]!.cancel()
        let resumed: ReadableStreamDefaultReader<Uint8Array> | undefined

        await until('a disconnected subscription slot to be released', async () => {
          const response = await fetch(`${stack.apiUrl}/mcp?session_id=${sessionId}`, {
            headers: { authorization: `Bearer ${stack.token}`, 'Last-Event-ID': first[0]!.id },
          })

          if (!response.ok || !response.body) return false
          resumed = response.body.getReader()

          return true
        })
        await resumed?.cancel()
      } finally {
        await Promise.all(readers.map((reader) => reader.cancel()))
      }
    },
  },
  {
    name: 'an MCP client drops SSE mid-turn, resumes by Last-Event-ID, and receives completion once',
    run: async (_page, stack) => {
      const { tool } = mcp(client(stack.apiUrl, stack.token))
      const sessionId = await askOverMcp(tool, stack.teamId, 'E2E_DELIVERY:mcp-midturn-before')
      const release = join(dirname(stack.acpLog), 'release')
      const marker = 'E2E_DELIVERY:mcp-midturn'

      rmSync(release, { force: true })
      const reader = await subscribe(stack, sessionId)
      const next = notifications(reader)
      let running = await next()

      must(running.body.params.status === 'completed', 'the initial stored result')

      try {
        await tool('nuphos_ask', {
          team_id: stack.teamId,
          session_id: sessionId,
          wait: false,
          prompt: `E2E_WAIT_RELEASE ${prompt(marker)}`,
        })
        await until('the fixture turn to start and remain in flight', async () =>
          agentEvents(stack).includes(`start ${marker}`),
        )
        do {
          running = await next()
        } while (running.body.params.status !== 'running')
      } finally {
        await reader.cancel()
      }
      const resumed = await subscribe(stack, sessionId, running.id)
      let completedId: string

      try {
        must(
          !agentEvents(stack).includes(`finish ${marker}`),
          'reconnect to happen before the turn finishes',
        )
        writeFileSync(release, '')
        const received = await completionCount(resumed, marker, running.id)

        must(
          received.count === 1,
          'the resumed client to receive the final completed state exactly once',
        )
        completedId = received.completedId
      } finally {
        await resumed.cancel()
        rmSync(release, { force: true })
      }
      const settled = await subscribe(stack, sessionId, completedId)

      try {
        const received = await completionCount(settled, marker, completedId, true)

        must(received.count === 0, 'a further reconnect not to replay the completed state')
      } finally {
        await settled.cancel()
      }
    },
  },
  {
    name: 'an MCP client receives completion over SSE and reconnects without replaying unchanged state',
    run: async (_page, stack) => {
      const { tool } = mcp(client(stack.apiUrl, stack.token))
      const sessionId = await askOverMcp(tool, stack.teamId, 'E2E_DELIVERY:mcp-notify-first')
      const open = (last?: string) => subscribe(stack, sessionId, last)
      const reader = await open()
      const next = notifications(reader)
      let completed = await next()

      must(completed.body.params.status === 'completed', 'a stored result on initial subscription')
      try {
        await tool('nuphos_ask', {
          team_id: stack.teamId,
          session_id: sessionId,
          wait: false,
          prompt: prompt('E2E_DELIVERY:mcp-notify-second'),
        })
        do {
          completed = await next()
        } while (!completed.body.params.answer?.includes('ACK E2E_DELIVERY:mcp-notify-second'))
        must(
          completed.body.params.status === 'completed',
          'a completion push without nuphos_check polling',
        )
      } finally {
        await reader.cancel()
      }
      const resumed = await open(completed.id)
      const changed = notifications(resumed)

      try {
        await tool('nuphos_ask', {
          team_id: stack.teamId,
          session_id: sessionId,
          wait: false,
          prompt: prompt('E2E_DELIVERY:mcp-notify-third'),
        })
        let event = await changed()

        must(event.id !== completed.id, 'Last-Event-ID to suppress unchanged state')
        while (!event.body.params.answer?.includes('ACK E2E_DELIVERY:mcp-notify-third'))
          event = await changed()
        must(event.body.params.status === 'completed', 'the next completed turn after reconnect')
      } finally {
        await resumed.cancel()
      }
    },
  },
]
