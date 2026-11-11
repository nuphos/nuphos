import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { config } from '@/config'

import {
  executeTrelloTool,
  trelloConnectLink,
  trelloToolArguments,
  verifyTrelloConnection,
} from './trello'

const realFetch = globalThis.fetch
const saved = { ...config.byos.composio }
const account = {
  status: 'ACTIVE',
  user_id: 'team:member',
  toolkit: { slug: 'trello' },
  auth_config: { id: 'ac_trello' },
}
let calls: { url: string; init?: RequestInit }[]

beforeEach(() => {
  calls = []
  Object.assign(config.byos.composio, { apiKey: 'fixture-key', trelloAuthConfigId: 'ac_trello' })
})
afterEach(() => {
  globalThis.fetch = realFetch
  Object.assign(config.byos.composio, saved)
})
function respond(body: unknown, status = 200) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })

    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
}

describe('Trello Composio authorization', () => {
  test('creates a managed Connect Link without provider credentials', async () => {
    respond({
      redirect_url: 'https://connect.composio.dev/link/fixture',
      connected_account_id: 'ca_fixture',
    })
    expect(
      (await trelloConnectLink('team:member', 'https://app.example/trello-app/setup?state=fixture'))
        .accountId,
    ).toBe('ca_fixture')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      auth_config_id: 'ac_trello',
      user_id: 'team:member',
      callback_url: 'https://app.example/trello-app/setup?state=fixture',
    })
    expect(calls[0]?.init?.redirect).toBe('error')
  })
  test.each([
    'https://evil.example/link',
    'http://connect.composio.dev/link',
    'https://connect.composio.dev.evil.example/link',
  ])('rejects a redirect to %s', async (url) => {
    respond({ redirect_url: url, connected_account_id: 'ca_fixture' })
    await expect(trelloConnectLink('team:member', 'https://app.example/callback')).rejects.toThrow(
      'Invalid Trello connection link',
    )
  })
  test.each([
    { ...account, status: 'EXPIRED' },
    { ...account, user_id: 'other-team:member' },
    { ...account, toolkit: { slug: 'gmail' } },
    { ...account, auth_config: { id: 'ac_other' } },
  ])('fails closed for inactive or mismatched connected accounts', async (body) => {
    respond(body)
    await expect(verifyTrelloConnection('ca_fixture', 'team:member')).rejects.toThrow(
      'inactive or does not match',
    )
  })
  test('does not forward upstream error bodies or retry rate limits/403', async () => {
    for (const status of [403, 429]) {
      calls = []
      respond({ error: { message: 'fixture-secret-token' } }, status)
      const error = await verifyTrelloConnection('ca_fixture', 'team:member').catch(
        (e: unknown) => e,
      )

      expect(String(error)).not.toContain('fixture-secret-token')
      expect(calls).toHaveLength(1)
    }
  })
  test('refuses arbitrary and deprecated tools before network access', async () => {
    respond(account)
    await expect(
      executeTrelloTool('ca_fixture', 'team:member', 'TRELLO_DELETE_CARDS_BY_ID_CARD', {}),
    ).rejects.toThrow('Unsupported Trello tool')
    expect(calls).toHaveLength(0)
  })
  test('executes only with the verified account and pinned tool version', async () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })

      return new Response(
        JSON.stringify(
          calls.length === 1 ? account : { successful: true, data: { id: 'fixture-card' } },
        ),
      )
    }) as typeof fetch
    await executeTrelloTool('ca_fixture', 'team:member', 'TRELLO_ADD_CARDS', {
      name: 'Fixture',
      idList: 'fixture-list',
    })
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      connected_account_id: 'ca_fixture',
      user_id: 'team:member',
      arguments: { name: 'Fixture', idList: 'fixture-list' },
      version: '20261104_00',
    })
  })
})

describe('bounded Trello reads', () => {
  test('adds a bounded page size and preserves the before cursor', () => {
    expect(
      trelloToolArguments('TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD', {
        idBoard: 'fixture',
        before: 'cursor',
      }),
    ).toEqual({ idBoard: 'fixture', before: 'cursor', limit: 100 })
    expect(
      trelloToolArguments('TRELLO_GET_LISTS_CARDS_BY_ID_LIST', { idList: 'fixture', limit: 20 }),
    ).toEqual({ idList: 'fixture', limit: 20 })
  })
  test.each([0, 101, '100', 1.5])('rejects an invalid page size', (limit) => {
    expect(() => trelloToolArguments('TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD', { limit })).toThrow(
      '1–100',
    )
  })
  test('prevents nested token exports and caller-supplied URL fields', () => {
    expect(() =>
      trelloToolArguments('TRELLO_GET_MEMBERS_BY_ID_MEMBER', { idMember: 'me', tokens: 'all' }),
    ).toThrow('Unsupported Trello tool arguments')
    expect(() => trelloToolArguments('TRELLO_ADD_CARDS', { url: 'https://evil.example' })).toThrow(
      'Unsupported Trello tool arguments',
    )
    expect(
      trelloToolArguments('TRELLO_GET_MEMBERS_BY_ID_MEMBER', { idMember: 'me', fields: 'all' }),
    ).toEqual({ idMember: 'me', fields: 'id,username' })
  })
})
