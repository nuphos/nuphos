import { client, must } from './binding-access-scenarios.ts'
import { askOverMcp, mcp, prompt } from './mcp-scenarios.ts'

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

export const mcpNotificationScenarios: Scenario[] = [
  {
    name: 'an MCP client receives completion over SSE and reconnects without replaying unchanged state',
    run: async (_page, stack) => {
      const { tool } = mcp(client(stack.apiUrl, stack.token))
      const sessionId = await askOverMcp(tool, stack.teamId, 'E2E_DELIVERY:mcp-notify-first')
      const url = `${stack.apiUrl}/mcp?session_id=${sessionId}`
      const open = async (last?: string) => {
        const response = await fetch(url, {
          headers: {
            authorization: `Bearer ${stack.token}`,
            ...(last ? { 'Last-Event-ID': last } : {}),
          },
          signal: AbortSignal.timeout(30_000),
        })

        must(response.ok && response.body !== null, 'the authenticated SSE subscription')

        return response.body.getReader()
      }
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
