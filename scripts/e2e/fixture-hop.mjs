// E2E_HOP: start a thread here, move it to the other agent, then message it there.
import { randomUUID } from 'node:crypto'

const threadIdOf = (message) =>
  /threadId[\\"]*:[\\"]*([0-9a-f-]{36})/.exec(JSON.stringify(message))?.[1]

/** Calls a Nuphos tool and reports it to the client as Claude Code does, so its card shows. */
async function shown({ call, send, sessionId }, name, args) {
  const toolCallId = randomUUID()
  const update = (fields) =>
    send({ method: 'session/update', params: { sessionId, update: { toolCallId, ...fields } } })

  update({
    sessionUpdate: 'tool_call',
    title: `mcp__nuphos-tools__${name}`,
    status: 'in_progress',
    rawInput: args,
  })
  const message = await call(sessionId, name, args)

  update({
    sessionUpdate: 'tool_call_update',
    status: 'completed',
    rawOutput: message.result?.content,
  })

  return message
}

export async function hop({ call, send, log, sessionId, child }) {
  const tools = { call, send, sessionId }
  const listed = await call(sessionId, 'list_agent_runtimes', { label: 'List the agents' })
  const other = listed.result?.structuredContent?.runtimes?.find((runtime) => !runtime.current)
  const threadId = threadIdOf(
    await shown(tools, 'create_thread', {
      label: 'Start a thread here',
      title: 'E2E hop',
      prompt: `${child} E2E_DELIVERY:hop-child`,
    }),
  )

  // Its first turn ends before it moves.
  await new Promise((resolve) => setTimeout(resolve, 4_000))
  const moved = await call(sessionId, 'update_thread', {
    label: 'Move the thread',
    threadId,
    runtimeId: other?.runtimeId,
  })
  const sent = await shown(tools, 'send_message_to_thread', {
    label: 'Message the moved thread',
    threadId,
    prompt: `${child} E2E_DELIVERY:hop-again`,
  })

  const receipt = JSON.parse(sent.result?.content?.[0]?.text ?? '{}')

  log({
    sessionId,
    event: 'hopped',
    detail: JSON.stringify({
      moved: moved.error ?? moved.result?.isError ?? false,
      agentRuntime: receipt.agentRuntime,
      runtimeLabel: receipt.runtimeLabel,
    }),
  })
}
