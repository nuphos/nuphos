// How the fixture agent asks its client to allow a call, as a runtime does before it runs one.
import { randomUUID } from 'node:crypto'

// Requests waiting for the client's answer. OpenAB reads ids as numbers.
const asked = new Map()
let nextRequest = 1_000_000

/** Hands the client's answer to the request waiting on it. */
export function answerPermission(id, result) {
  asked.get(id)?.(result)
  asked.delete(id)
}

/** Asks to allow a command, or `toolCall` (an MCP tool, say); resolves to the answer. */
export async function askPermission(
  { send, log },
  sessionId,
  marker,
  toolCall = { title: 'echo e2e', kind: 'execute' },
) {
  const id = nextRequest++
  const answered = new Promise((resolve) => asked.set(id, resolve))
  const started = Date.now()

  log({ sessionId, marker, event: 'permission-asked' })
  send({
    id,
    method: 'session/request_permission',
    params: {
      sessionId,
      toolCall: { toolCallId: randomUUID(), status: 'pending', ...toolCall },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    },
  })
  const outcome = (await answered)?.outcome
  const answer = outcome?.optionId ?? outcome?.outcome ?? 'none'

  log({
    sessionId,
    marker,
    event: `permission-${answer}`,
    ...(toolCall.kind === 'execute' ? {} : { detail: toolCall.title, ms: Date.now() - started }),
  })

  return answer
}
