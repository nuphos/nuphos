import { expect, spyOn, test } from 'bun:test'

import { fetchSlackChannelMembers } from './users'

// Answers each Slack method from `pages`, one page per call, and records the calls.
function stubSlack(pages: Record<string, object[]>) {
  const calls: string[] = []
  const respond = (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const method = url.pathname.replace('/api/', '')

    calls.push(`${method} ${url.searchParams.get('cursor') ?? '-'}`)

    return Promise.resolve(Response.json({ ok: true, ...pages[method]?.shift() }))
  }

  return {
    calls,
    fetch: spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(respond, { preconnect: globalThis.fetch.preconnect }),
    ),
  }
}

test('names a channel’s members from users.list, paging both lists and skipping deleted users', async () => {
  const { calls, fetch } = stubSlack({
    'conversations.members': [
      { members: ['U1', 'U2'], response_metadata: { next_cursor: 'm2' } },
      { members: ['U3'] },
    ],
    'users.list': [
      {
        members: [
          { id: 'U1', name: 'ada', real_name: 'Ada L', profile: { display_name: 'ada' } },
          { id: 'U9', name: 'outsider' },
        ],
        response_metadata: { next_cursor: 'u2' },
      },
      {
        members: [
          { id: 'U2', name: 'gone', deleted: true },
          { id: 'U3', name: 'bot', is_bot: true, profile: { real_name: 'Deploy Bot' } },
        ],
        response_metadata: { next_cursor: 'u3' },
      },
    ],
  })

  try {
    expect(await fetchSlackChannelMembers({ token: 't', channel: 'C1' })).toEqual({
      members: [
        { id: 'U1', name: 'ada', displayName: 'ada', realName: 'Ada L', isBot: false },
        { id: 'U3', name: 'bot', displayName: '', realName: 'Deploy Bot', isBot: true },
      ],
      truncated: false,
    })
    // users.list stops once every member is named, though Slack has more pages.
    expect(calls).toEqual([
      'conversations.members -',
      'conversations.members m2',
      'users.list -',
      'users.list u2',
    ])
  } finally {
    fetch.mockRestore()
  }
})

test('a member users.list never names makes the list truncated', async () => {
  const { fetch } = stubSlack({
    'conversations.members': [{ members: ['U1', 'UGUEST'] }],
    'users.list': [{ members: [{ id: 'U1', name: 'ada' }] }],
  })

  try {
    expect(await fetchSlackChannelMembers({ token: 't', channel: 'C1' })).toMatchObject({
      members: [{ id: 'U1' }],
      truncated: true,
    })
  } finally {
    fetch.mockRestore()
  }
})
