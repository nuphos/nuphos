import assert from 'node:assert/strict'
import test from 'node:test'

import { createServer } from 'vite'

import type * as Mention from '../../lib/atlasLinkMention.ts'
import type * as MentionNavigation from '../mentionNavigation.ts'
import type * as LinkNavigation from './linkNavigation.ts'

// The link parser pulls in browser-only modules, so this goes through Vite's
// SSR pipeline, as atlasLinkMention.test.ts does.
const server = await createServer({ appType: 'custom', server: { middlewareMode: true } })

test.after(async () => {
  await server.close()
})

const load = async <T>(path: string) =>
  (await server.ssrLoadModule(path).catch(async (err: unknown) => {
    await server.close()
    throw err
  })) as T

const { navigationForLink } = await load<typeof LinkNavigation>(
  '/src/app/workspace/linkNavigation.ts',
)
const { parseAtlasLink } = await load<typeof Mention>('/src/lib/atlasLinkMention.ts')
const { navigationFromMentionTarget } = await load<typeof MentionNavigation>(
  '/src/app/mentionNavigation.ts',
)

const CHAT = 'https://nuphos.ai/teams/team-1/agent/56c88cb7-1906-4bcf-bd66-13e68de21b45'

test('a conversation link keeps the artifact it names', () => {
  const navigation = navigationForLink(new URL(`${CHAT}?artifact=usage-report&version=2`))

  assert.equal(navigation?.active, 'team.agent')
  assert.equal(navigation?.agentSessionId, '56c88cb7-1906-4bcf-bd66-13e68de21b45')
  assert.deepEqual(navigation?.agentArtifact, { artifactId: 'usage-report', version: 2 })
})

test('a plain conversation link leads where its mention did', () => {
  const target = parseAtlasLink(CHAT)

  assert.equal(target?.type, 'agent-session')
  assert.deepEqual(navigationForLink(new URL(CHAT)), target && navigationFromMentionTarget(target))
})
