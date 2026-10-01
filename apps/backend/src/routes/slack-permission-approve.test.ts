import { beforeEach, expect, test } from 'bun:test'

import { useObservability } from '@/lib/test/doubles/observability'
import { usePermissionGrantApprove } from '@/lib/test/doubles/permission-grant-approve'
import { useSlackApi } from '@/lib/test/doubles/slack-api'

const messages: Record<string, unknown>[] = []
let approvals = 0

useSlackApi({
  postSlackResponseUrl: async (_url: string, body: Record<string, unknown>) => {
    messages.push(body)
  },
})
useObservability({ logEvent: () => {} })
usePermissionGrantApprove({
  approvePermissionGrantProposal: async () => {
    approvals++
    throw new Error('must never apply')
  },
})
const { handlePermissionGrantInteraction } = await import('./slack/permission-decide')

beforeEach(() => {
  messages.length = 0
  approvals = 0
})

test('historical Slack buttons explain retirement and never execute permission changes', async () => {
  for (const decision of ['approve', 'reject'] as const) {
    await handlePermissionGrantInteraction({
      slackWorkspaceId: 'workspace',
      slackUserId: 'user',
      decision,
      value: JSON.stringify({ proposalId: 'old-proposal', sessionId: 'session' }),
      responseUrl: 'https://hooks.slack.com/actions/test',
    })
  }
  expect(approvals).toBe(0)
  expect(messages).toHaveLength(2)
  for (const message of messages) {
    expect(message.response_type).toBe('ephemeral')
    expect(message.text).toContain('no longer be applied')
    expect(message.text).toContain('local_exec')
  }
})
