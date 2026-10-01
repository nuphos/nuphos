import { beforeEach, describe, expect, test } from 'bun:test'

import { resolveSlackSelfMapping } from './self-mapping'

import type { SlackUserMapping } from './agent-bot'
import type { SlackSelfMappingDependencies } from './self-mapping'

const now = new Date('2026-07-15T00:00:00.000Z')
const mapping = (overrides: Partial<SlackUserMapping> = {}): SlackUserMapping => ({
  slackWorkspaceId: 'T1',
  slackUserId: 'U1',
  teamId: 'team-1',
  nuphosUserId: 'user-1',
  enabled: true,
  createdBy: 'test',
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

let existing: SlackUserMapping | null
let claimResult: SlackUserMapping | null
let lookupResult: string | null
let lookupEmail: string | null
let claimInput: Parameters<SlackSelfMappingDependencies['claim']>[0] | null

const dependencies: SlackSelfMappingDependencies = {
  getExisting: async () => existing,
  getMembers: async () => [{ id: 'user-1', email: ' Person@Example.com ' }],
  lookupByEmail: async (_token, email) => {
    lookupEmail = email

    return lookupResult
  },
  claim: async (input) => {
    claimInput = input

    return claimResult
  },
}

const args = {
  botToken: 'secret-token',
  slackWorkspaceId: 'T1',
  teamId: 'team-1',
  nuphosUserId: 'user-1',
}

beforeEach(() => {
  existing = null
  claimResult = mapping()
  lookupResult = 'U1'
  lookupEmail = null
  claimInput = null
})

describe('Slack self mapping', () => {
  test('returns an existing mapping without looking up Slack', async () => {
    existing = mapping()
    await expect(resolveSlackSelfMapping(args, dependencies)).resolves.toEqual(existing)
    expect(lookupEmail).toBeNull()
  })

  test('auto-links the same normalized email when the Slack identity is unclaimed', async () => {
    await expect(resolveSlackSelfMapping(args, dependencies)).resolves.toEqual(
      expect.objectContaining({ slackUserId: 'U1', nuphosUserId: 'user-1' }),
    )
    expect(lookupEmail).toBe('person@example.com')
    expect(claimInput).toEqual({
      slackWorkspaceId: 'T1',
      slackUserId: 'U1',
      teamId: 'team-1',
      nuphosUserId: 'user-1',
      createdBy: 'auto:nuphos-email',
    })
  })

  test('never overwrites a Slack identity lost to a concurrent claimant', async () => {
    claimResult = null
    await expect(resolveSlackSelfMapping(args, dependencies)).resolves.toBeNull()
    expect(claimInput).toEqual(expect.objectContaining({ slackUserId: 'U1' }))
  })

  test('keeps DM unavailable when Slack has no user with the same email', async () => {
    lookupResult = null
    await expect(resolveSlackSelfMapping(args, dependencies)).resolves.toBeNull()
    expect(claimInput).toBeNull()
  })
})
