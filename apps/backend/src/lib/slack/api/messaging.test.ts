import { expect, spyOn, test } from 'bun:test'

import { fetchSlackChannelHistory } from './messaging'

test('channel history forwards bounds and cursor and retains Slack pagination', async () => {
  const requests: URL[] = []
  const fetch = spyOn(globalThis, 'fetch').mockImplementation((input) => {
    requests.push(new URL(input instanceof Request ? input.url : input))

    return Promise.resolve(
      Response.json({
        ok: true,
        messages: [{ ts: '99.1', text: 'Channel discussion outside the thread' }],
        has_more: true,
        response_metadata: { next_cursor: 'next-page' },
      }),
    )
  })

  try {
    const page = await fetchSlackChannelHistory({
      token: 'test-token',
      channel: 'C1',
      oldest: '90.1',
      latest: '100.1',
      cursor: 'current-page',
      limit: 15,
    })

    expect(requests[0]?.pathname).toBe('/api/conversations.history')
    expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({
      channel: 'C1',
      limit: '15',
      oldest: '90.1',
      latest: '100.1',
      cursor: 'current-page',
    })
    expect(page).toEqual({
      messages: [{ ts: '99.1', text: 'Channel discussion outside the thread' }],
      hasMore: true,
      nextCursor: 'next-page',
    })
  } finally {
    fetch.mockRestore()
  }
})
