import { expect, mock, test } from 'bun:test'

const calls: string[] = []

mock.module('../../api', () => ({
  api: {
    agentRemoveConversationParticipant: async (sessionId: string, _team: string, id: string) =>
      calls.push(`remove ${sessionId} ${id}`),
  },
}))
mock.module('../../lib/chatArchiveEvents', () => ({ announceChatArchived: () => null }))
mock.module('../../lib/sessionHistory', () => ({
  forgetSessionVisits: (user: string, team: string, ids: string[]) =>
    calls.push(`forget ${user} ${team} ${ids.join(',')}`),
}))
const { leaveSession } = await import('./channelPeople')

test('leaving a chat takes it out of your recent chats, which would only be refused now', async () => {
  await leaveSession('s1', 't1', 'u1')

  expect(calls).toEqual(['remove s1 u1', 'forget u1 t1 s1'])
})
