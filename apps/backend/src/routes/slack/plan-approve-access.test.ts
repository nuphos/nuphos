import { expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentPlans } from '@/lib/test/doubles/agent-plans'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'
import { useSlackInstallations } from '@/lib/test/doubles/slack-installations'
import { useSlackInteractionReplies } from '@/lib/test/doubles/slack-interaction-replies'
import { useSlackUserIdentity } from '@/lib/test/doubles/slack-user-identity'

const rejected: string[] = []
let approvals = 0

useSlackInteractionReplies({
  createInteractionRepliers: () =>
    ({
      reply: () => Promise.resolve(),
      ephemeral: () => Promise.resolve(),
      setBotToken: () => {},
      reject: (reason: string) => {
        rejected.push(reason)

        return Promise.resolve()
      },
    }) as never,
})
useSlackInstallations({
  resolveSlackBotForWorkspace: () => Promise.resolve({ botToken: 'xoxb' } as never),
})
useSlackAgentBot({
  getSlackAgentThreadBySessionId: () =>
    Promise.resolve({ slackWorkspaceId: 'W1', teamId: 'team-1' } as never),
})
useSlackUserIdentity({
  resolveSlackUserMapping: () =>
    Promise.resolve({ mapping: { nuphosUserId: 'viewer' } as never, email: null }),
})
useIdentity({ getTeamMembership: () => Promise.resolve({ role: 'EDITOR' } as never) })
useAgentDb({
  agentConversations: () =>
    ({
      findOne: () =>
        Promise.resolve({
          sessionId: 's1',
          userId: 'owner',
          teamId: 'team-1',
          generalAccess: 'view',
        }),
    }) as never,
})
useAgentPlans({
  getPlan: () =>
    Promise.resolve({ number: 7, status: 'proposed', sourceConversationId: 's1' } as never),
  recordPlanApproval: () => {
    approvals++

    return Promise.resolve({ plan: null, thresholdReached: false } as never)
  },
})

const { handlePlanApproveInteraction } = await import('./plan-approve')

test('a Slack approval needs reply access to the plan conversation', async () => {
  await handlePlanApproveInteraction({
    slackWorkspaceId: 'W1',
    slackUserId: 'U1',
    value: JSON.stringify({ planId: '7', sessionId: 's1' }),
  })

  expect(rejected).toEqual(['plan_access_denied'])
  expect(approvals).toBe(0)
})
