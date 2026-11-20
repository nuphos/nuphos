// Session updates a prompt's markers ask for, sent before the turn goes on.
import { randomUUID } from 'node:crypto'

export function scriptedUpdates({ send, sessionId, text }) {
  if (text.includes('E2E_COMMANDS')) listCommands({ send, sessionId })
  if (text.includes('E2E_LONG')) longReply({ send, sessionId })
  if (text.includes('E2E_SUBAGENT')) subagent({ send, sessionId })
}

// E2E_SUBAGENT: Claude Code runs a native sub-agent, its steps tagged with the call that
// spawned it, and the main agent keeps working meanwhile (#1060).
function subagent({ send, sessionId }) {
  const step = (title, claudeCode, toolCallId = randomUUID()) => {
    const update = (fields) =>
      send({ method: 'session/update', params: { sessionId, update: { toolCallId, ...fields } } })

    update({ sessionUpdate: 'tool_call', title, status: 'in_progress', _meta: { claudeCode } })

    return () => update({ sessionUpdate: 'tool_call_update', status: 'completed' })
  }
  const task = randomUUID()
  const finishTask = step('Survey the billing module', { toolName: 'Task', subagent: true }, task)

  step('Find invoice totals', { toolName: 'Grep', parentToolUseId: task })()
  step('Check the release notes', { toolName: 'Read' })()
  step('Read the tax rules', { toolName: 'Read', parentToolUseId: task })()
  finishTask()
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
