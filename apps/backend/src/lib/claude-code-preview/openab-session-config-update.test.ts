import { expect, test } from 'bun:test'

import { deliverOpenAbSessionUpdate } from './openab-acp-updates'

const model = {
  id: 'claude-model',
  name: 'Model',
  category: 'model',
  currentValue: 'opus',
  options: [{ value: 'opus', name: 'Opus' }],
}

function deliver(update: Record<string, unknown>) {
  const session: unknown[] = []
  const prompt: unknown[] = []

  deliverOpenAbSessionUpdate({
    cancelledSessions: new Set(),
    pending: [
      {
        onTextDelta: (text) => prompt.push(text),
        onAgentUpdate: (agentUpdate) => prompt.push(agentUpdate),
      },
    ],
    notify: (id, sessionUpdate) => session.push([id, sessionUpdate]),
    params: { sessionId: 'session', update },
  })

  return { session, prompt }
}

// #3789: the settings a session runs reach the chip while its first turn still runs.
test('the settings a session reports go to the session, not to the prompt in flight', () => {
  expect(deliver({ sessionUpdate: 'config_option_update', configOptions: [model] })).toEqual({
    session: [
      [
        'session',
        {
          kind: 'session-config',
          options: [
            {
              id: 'claude-model',
              name: 'Model',
              kind: 'model',
              currentValue: 'opus',
              options: [{ value: 'opus', name: 'Opus' }],
            },
          ],
        },
      ],
    ],
    prompt: [],
  })
})

test('an update without usable settings changes nothing', () => {
  expect(deliver({ sessionUpdate: 'config_option_update', configOptions: [] })).toEqual({
    session: [],
    prompt: [],
  })
  expect(deliver({ sessionUpdate: 'config_option_update' })).toEqual({ session: [], prompt: [] })
})
