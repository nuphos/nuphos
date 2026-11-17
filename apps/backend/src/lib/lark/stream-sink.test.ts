import { describe, expect, test } from 'bun:test'

import { LarkAgentRunSink } from './stream-sink'

import type { LarkCardStream } from './stream'

const frame = (payload: Record<string, unknown>) => `data: ${JSON.stringify(payload)}\n\n`

describe('LarkAgentRunSink', () => {
  // The agent's own call is the question's card: in Lark it is a step titled by its label,
  // never a form.
  test("a question asking for a form's details is a step titled by its label", async () => {
    const cards: Record<string, unknown>[] = []
    const show = (card: Record<string, unknown>) => cards.push(card)
    const stream = { render: show, finalize: show }
    const sink = new LarkAgentRunSink(stream as unknown as LarkCardStream, 'session')

    sink.frame(
      frame({
        type: 'tool-input-available',
        toolCallId: 't1',
        toolName: 'request_user_decision',
        input: {
          label: 'Ask for the lookup details',
          category: 'credential',
          question: 'The lookup form needs these details.',
          secretName: 'CLINIC_LOOKUP',
          fields: [{ name: 'NATIONAL_ID', label: 'National ID number' }],
          site: 'www.clinic.example',
        },
      }),
    )
    await sink.settle()
    const shown = JSON.stringify(cards.at(-1))

    expect(shown).toContain('Ask for the lookup details')
    expect(shown).not.toMatch(/CLINIC_LOOKUP|NATIONAL_ID|clinic\.example/)
  })
})
