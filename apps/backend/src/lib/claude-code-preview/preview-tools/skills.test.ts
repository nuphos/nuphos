import { describe, expect, test } from 'bun:test'

import { useTeamSkillTools } from '@/lib/test/doubles/tools-team-skills'

import { skillToolSet } from './skills'

import type { PreviewToolContext } from '../preview-tool-context'

let teamToolNames: string[] = ['skill_create', 'skill_upsert']

useTeamSkillTools({
  createTeamSkillTools: () =>
    Promise.resolve(
      Object.fromEntries(
        teamToolNames.map((name) => [
          name,
          { description: name, execute: () => Promise.resolve('ok') },
        ]),
      ),
    ),
})

const ctx: PreviewToolContext = {
  userId: 'user-1',
  teamId: 'team-1',
  sessionId: 'conv-1',
  locale: 'en',
}

describe('skillToolSet', () => {
  test('exposes only team authoring tools', async () => {
    const tools = await skillToolSet(ctx)

    expect(Object.keys(tools).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'skill_create',
      'skill_upsert',
    ])
  })

  test('viewer-role teams get no authoring tools', async () => {
    teamToolNames = []
    try {
      const tools = await skillToolSet(ctx)

      expect(Object.keys(tools)).toEqual([])
    } finally {
      teamToolNames = ['skill_create', 'skill_upsert']
    }
  })
})
