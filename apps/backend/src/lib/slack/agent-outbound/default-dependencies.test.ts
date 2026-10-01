import { describe, expect, test } from 'bun:test'

import { postAgentSlackMessage } from '@/lib/slack/agent-message'

const { defaultDependencies } = await import('@/lib/slack/agent-outbound/default-dependencies')

describe('defaultDependencies', () => {
  // slack_post carries the agent's own CommonMark. Wiring it straight to
  // postSlackMessage is what made `**bold**` and `[a](b)` render literally, so
  // pin the seam rather than the symptom.
  test('sends slack_post text through the agent mrkdwn boundary', () => {
    expect(defaultDependencies.postMessage).toBe(postAgentSlackMessage)
  })
})
