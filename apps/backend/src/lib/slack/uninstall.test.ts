import { describe, expect, test } from 'bun:test'

import { deleteSlackWorkspaceMappings, revokeSlackBotAccess } from './uninstall'

function recorder(fail = new Set<string>()) {
  const calls: string[] = []
  const call = (_token: string, method: string) => {
    calls.push(method)

    return fail.has(method) ? Promise.reject(new Error(`${method} failed`)) : Promise.resolve({})
  }

  return { calls, call }
}

describe('revokeSlackBotAccess', () => {
  test('uninstalls the app when client credentials are configured', async () => {
    const { calls, call } = recorder()

    expect(
      await revokeSlackBotAccess('xoxb', { clientId: 'id', clientSecret: 'secret', call }),
    ).toBe('uninstall')
    expect(calls).toEqual(['apps.uninstall'])
  })

  test('falls back to revoking the token when uninstall fails', async () => {
    const { calls, call } = recorder(new Set(['apps.uninstall']))
    const failures: string[] = []

    expect(
      await revokeSlackBotAccess('xoxb', {
        clientId: 'id',
        clientSecret: 'secret',
        call,
        onFailure: (step) => failures.push(step),
      }),
    ).toBe('revoke')
    expect(calls).toEqual(['apps.uninstall', 'auth.revoke'])
    expect(failures).toEqual(['uninstall'])
  })

  test('only revokes without client credentials, and reports a total failure', async () => {
    const ok = recorder()

    expect(await revokeSlackBotAccess('xoxb', { clientId: null, clientSecret: null, ...ok })).toBe(
      'revoke',
    )
    expect(ok.calls).toEqual(['auth.revoke'])

    const bad = recorder(new Set(['auth.revoke']))

    expect(
      await revokeSlackBotAccess('xoxb', { clientId: null, clientSecret: null, call: bad.call }),
    ).toBeNull()
  })
})

type Row = { teamId: string; slackWorkspaceId: string; enabled: boolean }

function fakeCollection(initial: Row[]) {
  const state = { rows: initial }

  return {
    state,
    deleteMany: (filter: { teamId: string; slackWorkspaceId: string }) => {
      const keep = state.rows.filter(
        (row) => row.teamId !== filter.teamId || row.slackWorkspaceId !== filter.slackWorkspaceId,
      )
      const deletedCount = state.rows.length - keep.length

      state.rows = keep

      return Promise.resolve({ deletedCount })
    },
  }
}

const row = (teamId: string, slackWorkspaceId: string, enabled = true): Row => ({
  teamId,
  slackWorkspaceId,
  enabled,
})

describe('deleteSlackWorkspaceMappings', () => {
  test("deletes only this team's mappings for the uninstalled workspace", async () => {
    const channels = fakeCollection([
      row('team-a', 'T1'),
      row('team-a', 'T1', false),
      row('team-a', 'T2'),
      row('team-b', 'T1'),
    ])
    const users = fakeCollection([
      row('team-a', 'T1'),
      row('team-a', 'T1', false),
      row('team-b', 'T1'),
    ])

    expect(await deleteSlackWorkspaceMappings('team-a', 'T1', { channels, users })).toEqual({
      channels: 2,
      users: 2,
    })
    expect(channels.state.rows).toEqual([row('team-a', 'T2'), row('team-b', 'T1')])
    expect(users.state.rows).toEqual([row('team-b', 'T1')])
  })
})
