// Session updates a prompt's markers ask for, sent before the turn goes on.
import { randomUUID } from 'node:crypto'

export function scriptedUpdates({ send, sessionId, text }) {
  if (text.includes('E2E_COMMANDS')) listCommands({ send, sessionId })
  if (text.includes('E2E_LONG')) longReply({ send, sessionId })
  const trigger = /E2E_TRIGGER_CARD:([\da-f]{24})/.exec(text)?.[1]

  if (trigger) triggerCard({ send, sessionId, trigger })
}

// E2E_TRIGGER_CARD:<id>: the agent changes that Trigger with the triggers skill's script,
// so the chat shows the Trigger's card (#4293).
function triggerCard({ send, sessionId, trigger }) {
  const toolCallId = randomUUID()
  const update = (fields) =>
    send({ method: 'session/update', params: { sessionId, update: { toolCallId, ...fields } } })

  update({
    sessionUpdate: 'tool_call',
    title: 'Bash',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command: `bash trigger-api.sh team PATCH ${trigger} @trigger.json` },
  })
  update({
    sessionUpdate: 'tool_call_update',
    status: 'completed',
    rawOutput: { stdout: JSON.stringify({ id: trigger, triggerType: 'cron' }) },
  })
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
    const words = Array.from({ length: 100 }, (_, word) => `w${String(n * 100 + word)}`)

    chunk(`${words.join(' ')} `)
  }
  chunk('LONG_END')
}

export function scriptedPlan({ send, sessionId, text }) {
  if (!text.includes('E2E_PLAN_REFERENCE')) return
  const toolCallId = randomUUID()
  const update = (fields) =>
    send({ method: 'session/update', params: { sessionId, update: fields } })

  update({
    sessionUpdate: 'tool_call',
    toolCallId,
    title: 'plan_create',
    status: 'in_progress',
    rawInput: { title: 'E2E plan reference' },
  })
  update({
    sessionUpdate: 'tool_call_update',
    toolCallId,
    status: 'completed',
    rawOutput: { planId: '900' },
  })
}
