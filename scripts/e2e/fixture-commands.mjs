// E2E_COMMANDS: the agent lists a slash command once, then changes its turn's state,
// so the run's later snapshots leave the unchanged list out (#3090).
import { randomUUID } from 'node:crypto'

export function listCommands({ send, sessionId }) {
  const update = (fields) =>
    send({ method: 'session/update', params: { sessionId, update: fields } })

  update({
    sessionUpdate: 'available_commands_update',
    availableCommands: [{ name: 'e2e-review', description: 'Review the change' }],
  })
  update({
    sessionUpdate: 'tool_call',
    toolCallId: randomUUID(),
    title: 'E2E long step',
    status: 'in_progress',
  })
}
