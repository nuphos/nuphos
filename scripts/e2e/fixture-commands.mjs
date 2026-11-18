// Session updates a prompt's markers ask for, sent before the turn goes on.
import { randomUUID } from 'node:crypto'

export function scriptedUpdates({ send, sessionId, text }) {
  if (text.includes('E2E_COMMANDS')) listCommands({ send, sessionId })
  if (text.includes('E2E_LONG')) longReply({ send, sessionId })
}

// E2E_COMMANDS: the agent lists a slash command once, then changes its turn's state,
// so the run's later snapshots leave the unchanged list out (#3090).
function listCommands({ send, sessionId }) {
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

// E2E_LONG: a reply already long when its chat is opened, as a turn that has run a while,
// sent as a model does, in many small chunks.
function longReply({ send, sessionId }) {
  const chunk = (text) =>
    send({
      method: 'session/update',
      params: {
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
      },
    })

  chunk('LONG_START ')
  for (let n = 0; n < 30; n++) {
    const words = Array.from({ length: 100 }, (_, word) => 'w' + String(n * 100 + word))

    chunk(words.join(' ') + ' ')
  }
  chunk('LONG_END')
}
