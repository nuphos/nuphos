import { expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

import type { NuphosTeamDoc } from './shared'

const teamId = new ObjectId()
const team: NuphosTeamDoc = {
  _id: teamId,
  name: 'Runtime team',
  avatarUrl: '',
  ownerID: new ObjectId(),
  contactEmails: [],
  members: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  agentRuntime: 'codex',
}

useDb({ db: () => ({ collection: () => ({ findOne: () => Promise.resolve(team) }) }) })
const { getTeamAgentRuntime } = await import('./agent-runtime')
const { mapTeam } = await import('./shared')

test('reads the selected provider and exposes it in the workspace API', async () => {
  team.agentRuntime = 'codex'
  expect(await getTeamAgentRuntime(teamId.toHexString())).toBe('codex')
  expect(mapTeam(team).agentRuntime).toBe('codex')
  team.agentRuntime = 'claude-code'
  expect(await getTeamAgentRuntime(teamId.toHexString())).toBe('claude-code')
})

test('legacy workspaces retain Claude Code and never restore the classic loop', async () => {
  team.agentRuntime = 'nuphos'
  expect(await getTeamAgentRuntime(teamId.toHexString())).toBe('claude-code')
  expect(mapTeam(team).agentRuntime).toBe('claude-code')
  delete team.agentRuntime
  expect(await getTeamAgentRuntime(teamId.toHexString())).toBe('claude-code')
})
