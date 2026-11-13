import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { config } from '@/config'
import * as composioClient from '@/lib/composio'

import {
  executeTrelloTool,
  trelloConnectLink,
  trelloToolArguments,
  verifyTrelloConnection,
} from './trello'

const ID = '000000000000000000000001'
const realFetch = globalThis.fetch
const saved = { ...config.byos.composio }
const account = {
  status: 'ACTIVE',
  user_id: 'team:member',
  toolkit: { slug: 'trello' },
  auth_config: { id: 'ac_trello' },
}
let calls: { url: string; init?: RequestInit }[]
const authConfigSpy = spyOn(composioClient, 'composioAuthConfigId').mockResolvedValue('ac_trello')

afterAll(() => authConfigSpy.mockRestore())

beforeEach(() => {
  calls = []
  Object.assign(config.byos.composio, { apiKey: 'fixture-key' })
})
afterEach(() => {
  globalThis.fetch = realFetch
  Object.assign(config.byos.composio, saved)
})
function respond(body: unknown, status = 200) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url instanceof Request ? url.url : url.toString(), init })

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
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
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
  test('names the Composio log of a failed tool call without its error text', async () => {
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: '', init })

      return new Response(
        JSON.stringify(
          calls.length === 1
            ? account
            : { successful: false, data: {}, error: 'fixture-secret-token', log_id: 'log_fixture' },
        ),
      )
    }) as typeof fetch
    const error = await executeTrelloTool(
      'ca_fixture',
      'team:member',
      'TRELLO_GET_BOARDS_BY_ID_BOARD',
      {
        idBoard: ID,
      },
    ).catch((e: unknown) => e)

    expect(String(error)).toContain('Composio log log_fixture')
    expect(String(error)).not.toContain('fixture-secret-token')
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
      calls.push({ url: url instanceof Request ? url.url : url.toString(), init })

      return new Response(
        JSON.stringify(
          calls.length === 1 ? account : { successful: true, data: { id: 'fixture-card' } },
        ),
      )
    }) as typeof fetch
    await executeTrelloTool('ca_fixture', 'team:member', 'TRELLO_ADD_CARDS', {
      name: 'Fixture',
      idList: '000000000000000000000001',
    })
    expect(JSON.parse(calls[1]?.init?.body as string)).toEqual({
      connected_account_id: 'ca_fixture',
      user_id: 'team:member',
      arguments: { name: 'Fixture', idList: '000000000000000000000001' },
      version: '20261104_00',
    })
  })
})

describe('bounded Trello reads', () => {
  test('adds a bounded page size and preserves the before cursor', () => {
    expect(
      trelloToolArguments('TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD', {
        idBoard: '000000000000000000000001',
        before: '000000000000000000000002',
      }),
    ).toMatchObject({
      idBoard: '000000000000000000000001',
      before: '000000000000000000000002',
      limit: '100',
    })
    expect(
      trelloToolArguments('TRELLO_GET_LISTS_CARDS_BY_ID_LIST', {
        idList: '000000000000000000000001',
        limit: 20,
      }),
    ).toMatchObject({ idList: '000000000000000000000001', limit: '20' })
  })
  test.each([0, 101, '100', 1.5])('rejects an invalid page size', (limit) => {
    expect(() =>
      trelloToolArguments('TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD', { idBoard: ID, limit }),
    ).toThrow('Unsupported Trello tool arguments')
  })
  test('prevents nested token exports and caller-supplied URL fields', () => {
    expect(() =>
      trelloToolArguments('TRELLO_GET_MEMBERS_BY_ID_MEMBER', { idMember: 'me', tokens: 'all' }),
    ).toThrow('Unsupported Trello tool arguments')
    expect(() => trelloToolArguments('TRELLO_ADD_CARDS', { url: 'https://evil.example' })).toThrow(
      'Unsupported Trello tool arguments',
    )
    expect(
      trelloToolArguments('TRELLO_GET_MEMBERS_BY_ID_MEMBER', { idMember: 'me' }),
    ).toMatchObject({ idMember: 'me', fields: 'id,username' })
  })
})

describe('Trello argument values', () => {
  test.each([
    'me/tokens',
    '../tokens',
    'x/../../members/me/tokens',
    'x?fields=tokens',
    'x%2Ftokens',
  ])('rejects path/query injection before any Composio call', async (value) => {
    respond(account)
    for (const [tool, key] of [
      ['TRELLO_GET_MEMBERS_BY_ID_MEMBER', 'idMember'],
      ['TRELLO_GET_BOARDS_BY_ID_BOARD', 'idBoard'],
      ['TRELLO_GET_LISTS_CARDS_BY_ID_LIST', 'idList'],
      ['TRELLO_GET_CARDS_BY_ID_CARD', 'idCard'],
    ])
      await expect(
        executeTrelloTool('ca_fixture', 'team:member', tool!, { [key!]: value }),
      ).rejects.toThrow('Unsupported Trello tool arguments')
    expect(calls).toHaveLength(0)
  })
  test('allows only bounded scalar values and fixed query selectors', () => {
    for (const value of [null, {}, [], true, 12])
      expect(() => trelloToolArguments('TRELLO_GET_CARDS_BY_ID_CARD', { idCard: value })).toThrow()
    for (const fields of ['all', 'tokens', 'id,tokens', 'id?tokens=all', ['id'], {}])
      expect(() =>
        trelloToolArguments('TRELLO_GET_CARDS_BY_ID_CARD', { idCard: ID, fields }),
      ).toThrow()
    expect(() =>
      trelloToolArguments('TRELLO_GET_BOARDS_LISTS_BY_ID_BOARD', {
        idBoard: ID,
        filter: 'open?tokens=all',
      }),
    ).toThrow()
    expect(() =>
      trelloToolArguments('TRELLO_UPDATE_CARDS_BY_ID_CARD', { idCard: ID, closed: 'false' }),
    ).toThrow()
    expect(() =>
      trelloToolArguments('TRELLO_ADD_CARDS', { idList: ID, name: 'x'.repeat(1025) }),
    ).toThrow()
    expect(() =>
      trelloToolArguments('TRELLO_ADD_CARDS_ACTIONS_COMMENTS_BY_ID_CARD', {
        idCard: ID,
        text: 'x'.repeat(16385),
      }),
    ).toThrow()
    expect(() =>
      trelloToolArguments('TRELLO_UPDATE_CARDS_BY_ID_CARD', { idCard: ID, pos: 'top?tokens=all' }),
    ).toThrow()
    expect(() =>
      trelloToolArguments('TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD', {
        idBoard: ID,
        before: '../tokens',
      }),
    ).toThrow()
  })
  test('accepts valid ids, timestamps, booleans, positions and text', () => {
    expect(
      trelloToolArguments('TRELLO_UPDATE_CARDS_BY_ID_CARD', {
        idCard: ID,
        closed: false,
        pos: 12.5,
        desc: '',
      }),
    ).toEqual({ idCard: ID, closed: 'false', pos: '12.5', desc: '' })
    expect(
      trelloToolArguments('TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD', {
        idBoard: ID,
        before: '2026-11-11T00:00:00Z',
      }),
    ).toMatchObject({ before: '2026-11-11T00:00:00Z', limit: '100' })
  })
})
