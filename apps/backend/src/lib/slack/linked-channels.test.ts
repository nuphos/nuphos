import { describe, expect, test } from 'bun:test'

import { summarizeSlackLinkedChannels } from './linked-channels'

import type { SlackChannelMapping } from './agent-bot'

const now = new Date('2026-09-10T05:23:00.000Z')
const mapping = (
  slackWorkspaceId: string,
  slackChannelId: string,
  enabled = true,
): SlackChannelMapping => ({
  slackWorkspaceId,
  slackChannelId,
  teamId: 'team-a',
  enabled,
  createdBy: 'test',
  createdAt: now,
  updatedAt: now,
})

const installed = new Map([
  ['T-own', 'Own Workspace'],
  ['T-other', 'Other Workspace'],
])
const resolve = (id: string) => Promise.resolve(installed.get(id) ?? null)

describe('summarizeSlackLinkedChannels', () => {
  test('ignores mappings whose workspace no one has installed', async () => {
    const summary = await summarizeSlackLinkedChannels(
      [mapping('T-gone', 'C1'), mapping('T-gone', 'C2'), mapping('T-other', 'C3')],
      null,
      resolve,
    )

    expect(summary).toEqual({
      count: 1,
      grantWorkspaces: [{ id: 'T-other', name: 'Other Workspace' }],
    })
  })

  test('yields no row at all after the only workspace was uninstalled', async () => {
    await expect(
      summarizeSlackLinkedChannels([mapping('T-gone', 'C1')], null, resolve),
    ).resolves.toEqual({ count: 0, grantWorkspaces: [] })
  })

  test('counts own-workspace mappings without listing them as grants', async () => {
    const summary = await summarizeSlackLinkedChannels(
      [mapping('T-own', 'C1'), mapping('T-other', 'C2'), mapping('T-other', 'C3', false)],
      { slackTeamId: 'T-own', slackTeamName: 'Own Workspace' },
      async (id) => {
        if (id === 'T-own') throw new Error('own workspace must not be looked up')

        return await resolve(id)
      },
    )

    expect(summary).toEqual({
      count: 2,
      grantWorkspaces: [{ id: 'T-other', name: 'Other Workspace' }],
    })
  })
})
