import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

test('starting team OAuth forwards the selected sharing scope through IPC', async () => {
  const calls: unknown[][] = []

  mock.module('electron', {
    namedExports: {
      ipcRenderer: {
        invoke: async (...args: unknown[]) => {
          calls.push(args)
        },
      },
    },
  })

  const { teamOAuthApi } = await import('./api-team-oauth.ts')
  const share = { mode: 'members' as const, memberIds: ['member-a'] }

  await teamOAuthApi.atlasStartLinearOAuth('team-a', share)
  await teamOAuthApi.atlasStartGithubInstall('team-a', share)
  await teamOAuthApi.atlasStartCloudflareConnect('team-a', ['dns.read'], share)

  assert.deepEqual(calls, [
    ['atlas:startLinearOAuth', 'team-a', share],
    ['atlas:startGithubInstall', 'team-a', share],
    ['atlas:startCloudflareConnect', 'team-a', ['dns.read'], share],
  ])
})
