import { beforeEach, describe, expect, test } from 'bun:test'

import {
  clearSlackUserNameCache,
  fetchSlackUserName,
  SLACK_USER_NAME_FAILURE_TTL_MS,
} from './user-profile'

import type { SlackApiResponse } from './api'

beforeEach(() => clearSlackUserNameCache())

describe('Slack user display names', () => {
  test('prefers the Slack display name and caches successful lookups', async () => {
    let calls = 0
    const apiGet = async (): Promise<SlackApiResponse> => {
      calls += 1

      return {
        ok: true,
        user: { id: 'U1', profile: { display_name: 'Boyi Zhang', real_name: 'Boyi' } },
      }
    }

    await expect(
      fetchSlackUserName('token', 'T1', 'U1', { apiGet, now: () => 1_000 }),
    ).resolves.toBe('Boyi Zhang')
    await expect(
      fetchSlackUserName('token', 'T1', 'U1', { apiGet, now: () => 2_000 }),
    ).resolves.toBe('Boyi Zhang')
    expect(calls).toBe(1)
  })

  test('retries a failed lookup shortly after Slack is reauthorized', async () => {
    let calls = 0
    const apiGet = async (): Promise<SlackApiResponse> => {
      calls += 1
      if (calls === 1) throw new Error('missing_scope')

      return { ok: true, user: { id: 'U1', real_name: 'Boyi Zhang' } }
    }

    await expect(
      fetchSlackUserName('old-token', 'T1', 'U1', { apiGet, now: () => 1_000 }),
    ).resolves.toBeNull()
    await expect(
      fetchSlackUserName('new-token', 'T1', 'U1', {
        apiGet,
        now: () => 1_000 + SLACK_USER_NAME_FAILURE_TTL_MS - 1,
      }),
    ).resolves.toBeNull()
    await expect(
      fetchSlackUserName('new-token', 'T1', 'U1', {
        apiGet,
        now: () => 1_000 + SLACK_USER_NAME_FAILURE_TTL_MS,
      }),
    ).resolves.toBe('Boyi Zhang')
    expect(calls).toBe(2)
  })
})
