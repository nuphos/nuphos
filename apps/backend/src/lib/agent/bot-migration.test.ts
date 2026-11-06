import { describe, expect, test } from 'bun:test'

import { derivedAvatar, pinnedSessionId, planBotMigration } from './bot-migration'

const A = '00000000-0000-4000-8000-000000000000'
const B = 'b2f1c9d4-3a5e-4c7b-9f10-2d3e4f5a6b7c'
const TEAM = '0123456789abcdef01234567'
const OWNER = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb'

describe('derivedAvatar', () => {
  test('matches the face Desktop derives from the same id', () => {
    // Vectors computed with apps/desktop/src/lib/botAvatars.ts derivedBotAvatar.
    expect(derivedAvatar(A)).toBe('10-van-gogh')
    expect(derivedAvatar(B)).toBe('09-frida')
  })
})

describe('pinnedSessionId', () => {
  test('reads every key an agent can be pinned under', () => {
    expect(pinnedSessionId({ key: `agent-session:${A}` })).toBe(A)
    expect(pinnedSessionId({ key: `fav-href:/teams/${TEAM}/agent/${A}` })).toBe(A)
    expect(pinnedSessionId({ href: `/teams/${TEAM}/agent/${A}?tab=files` })).toBe(A)
  })

  test('ignores favorites that are not conversations', () => {
    expect(pinnedSessionId({ href: `/teams/${TEAM}/infra/aws` })).toBeNull()
    expect(pinnedSessionId({ key: 'agent-session:' })).toBeNull()
  })
})

describe('planBotMigration', () => {
  const conversations = new Map([
    [A, { sessionId: A, userId: OWNER, teamId: TEAM }],
    [B, { sessionId: B, userId: OWNER, teamId: TEAM, avatar: '05-rembrandt' }],
  ])

  test('promotes owner pins without an avatar to their derived face, once', () => {
    const plan = planBotMigration(
      [
        {
          userId: OWNER,
          teamId: TEAM,
          entries: [{ key: `agent-session:${A}` }, { href: `/teams/${TEAM}/agent/${A}` }],
        },
      ],
      conversations,
    )

    expect([...plan.promote]).toEqual([[A, '10-van-gogh']])
    expect(plan.counts).toMatchObject({ agentPins: 2, toPromote: 1 })
  })

  test("keeps a picked avatar and never promotes someone else's pin", () => {
    const plan = planBotMigration(
      [
        { userId: OWNER, teamId: TEAM, entries: [{ key: `agent-session:${B}` }] },
        { userId: OTHER, teamId: TEAM, entries: [{ key: `agent-session:${A}` }] },
      ],
      conversations,
    )

    expect(plan.promote.size).toBe(0)
    expect(plan.counts).toMatchObject({ alreadyBots: 1, pinnedByNonOwner: 1 })
  })

  test('counts pins of channels and of missing conversations without promoting', () => {
    const plan = planBotMigration(
      [
        {
          userId: OWNER,
          teamId: TEAM,
          entries: [{ key: `agent-session:${A}` }, { key: `agent-session:${B}` }],
        },
      ],
      new Map([[A, { sessionId: A, userId: OWNER, teamId: TEAM, kind: 'channel' as const }]]),
    )

    expect(plan.promote.size).toBe(0)
    expect(plan.counts).toMatchObject({ pinnedChannels: 1, missing: 1 })
  })
})

test('leaves an archived pin a Task: a stale bookmark is not a living Bot', () => {
  const plan = planBotMigration(
    [{ userId: OWNER, teamId: TEAM, entries: [{ key: `agent-session:${A}` }] }],
    new Map([[A, { sessionId: A, userId: OWNER, teamId: TEAM, archivedAt: new Date() }]]),
  )

  expect(plan.promote.size).toBe(0)
  expect(plan.counts).toMatchObject({ archived: 1, toPromote: 0 })
})
