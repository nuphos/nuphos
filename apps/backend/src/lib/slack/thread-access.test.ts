import { describe, expect, test } from 'bun:test'

import { getAgentNotificationReplyAccess, getSlackThreadTurnIdentity } from './thread-access'

describe('getAgentNotificationReplyAccess', () => {
  test('allows the Watch owner to continue a channel incident', () => {
    expect(
      getAgentNotificationReplyAccess({
        slackChannelId: 'C123',
        conversationOwnerUserId: 'owner',
        senderUserId: 'owner',
        senderIsTeamMember: true,
      }),
    ).toEqual({ allowed: true })
  })

  test('allows another current teammate to continue a channel incident', () => {
    expect(
      getAgentNotificationReplyAccess({
        slackChannelId: 'C123',
        conversationOwnerUserId: 'owner',
        senderUserId: 'teammate',
        senderIsTeamMember: true,
      }),
    ).toEqual({ allowed: true })
  })

  test('rejects a stale mapping whose user is no longer on the team', () => {
    expect(
      getAgentNotificationReplyAccess({
        slackChannelId: 'C123',
        conversationOwnerUserId: 'owner',
        senderUserId: 'former-member',
        senderIsTeamMember: false,
      }),
    ).toEqual({ allowed: false, reason: 'not_team_member' })
  })

  test('keeps proactive DMs restricted to their intended recipient', () => {
    expect(
      getAgentNotificationReplyAccess({
        slackChannelId: 'D123',
        conversationOwnerUserId: 'owner',
        senderUserId: 'teammate',
        senderIsTeamMember: true,
      }),
    ).toEqual({ allowed: false, reason: 'dm_recipient_only' })

    expect(
      getAgentNotificationReplyAccess({
        slackChannelId: 'D123',
        conversationOwnerUserId: 'owner',
        senderUserId: 'owner',
        senderIsTeamMember: true,
      }),
    ).toEqual({ allowed: true })
  })
})

test('a Slack reply keeps the conversation owner separate from the turn actor', () => {
  expect(getSlackThreadTurnIdentity({ agentUserId: 'owner' }, 'teammate')).toEqual({
    conversationOwnerUserId: 'owner',
    actorUserId: 'teammate',
  })
})
