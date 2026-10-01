import { beforeEach, describe, expect, test } from 'bun:test'

import {
  filterVisibleSlackChannels,
  getJoinedSlackChannel,
  listJoinedSlackChannels,
} from './destinations'

import type { SlackApiResponse } from '@/lib/slack/api'

const calls: { method: string; params: Record<string, string | number | undefined> }[] = []
let responses: SlackApiResponse[] = []

const apiGet = async (
  _token: string,
  method: string,
  params: Record<string, string | number | undefined>,
) => {
  calls.push({ method, params })
  const response = responses.shift()

  if (!response) throw new Error('missing test response')

  return response
}

beforeEach(() => {
  calls.length = 0
  responses = []
})

describe('Slack notification destinations', () => {
  test('hides private names and ids from members but preserves them for administrators', () => {
    const channels = [
      { id: 'C1', name: 'ops', isPrivate: false },
      { id: 'G1', name: 'executive-incidents', isPrivate: true },
    ]

    expect(filterVisibleSlackChannels(channels, false)).toEqual([channels[0]!])
    expect(filterVisibleSlackChannels(channels, true)).toEqual(channels)
  })

  test('lists only joined, active channels across pages and sorts by name', async () => {
    responses = [
      {
        ok: true,
        channels: [
          { id: 'C2', name: 'z-ops', is_member: true },
          { id: 'C1', name: 'general', is_member: false },
          { id: 'C3', name: 'archived', is_member: true, is_archived: true },
        ],
        response_metadata: { next_cursor: 'next' },
      },
      {
        ok: true,
        channels: [{ id: 'G1', name: 'private-alerts', is_member: true, is_private: true }],
        response_metadata: { next_cursor: '' },
      },
    ]

    await expect(listJoinedSlackChannels('token', apiGet)).resolves.toEqual([
      { id: 'G1', name: 'private-alerts', isPrivate: true },
      { id: 'C2', name: 'z-ops', isPrivate: false },
    ])
    expect(calls).toHaveLength(2)
    expect(calls[1]?.params.cursor).toBe('next')
  })

  test('continues past five pages until Slack exhausts the cursor', async () => {
    responses = Array.from({ length: 7 }, (_, index) => ({
      ok: true,
      channels: [{ id: `C${String(index)}`, name: `channel-${String(index)}`, is_member: true }],
      response_metadata: { next_cursor: index < 6 ? `cursor-${String(index + 1)}` : '' },
    }))

    const channels = await listJoinedSlackChannels('token', apiGet)

    expect(channels).toHaveLength(7)
    expect(calls).toHaveLength(7)
    expect(calls[6]?.params.cursor).toBe('cursor-6')
  })

  test('fails instead of looping when Slack repeats a pagination cursor', async () => {
    responses = [
      { ok: true, channels: [], response_metadata: { next_cursor: 'same' } },
      { ok: true, channels: [], response_metadata: { next_cursor: 'same' } },
    ]

    await expect(listJoinedSlackChannels('token', apiGet)).rejects.toThrow(
      /repeated pagination cursor/,
    )
  })

  test('revalidates membership before returning a send target', async () => {
    responses = [
      {
        ok: true,
        channel: { id: 'C2', name: 'ops', is_member: true, is_private: false },
      },
    ]
    await expect(getJoinedSlackChannel('token', 'C2', apiGet)).resolves.toEqual({
      id: 'C2',
      name: 'ops',
      isPrivate: false,
    })
    expect(calls[0]).toEqual({ method: 'conversations.info', params: { channel: 'C2' } })
  })

  test('rejects a visible channel the bot has not joined', async () => {
    responses = [{ ok: true, channel: { id: 'C2', name: 'ops', is_member: false } }]
    await expect(getJoinedSlackChannel('token', 'C2', apiGet)).rejects.toThrow(
      /Invite the Nuphos bot/,
    )
  })
})
