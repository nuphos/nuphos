import { expect, spyOn, test } from 'bun:test'

import { downloadSlackFile } from './misc'

function withFetch() {
  const requests: { url: string; authorization: string | null }[] = []
  const respond = (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ) => {
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      authorization: new Headers(init?.headers).get('authorization'),
    })

    return Promise.resolve(
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    )
  }
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(respond, { preconnect: globalThis.fetch.preconnect }),
  )

  return { requests, fetch }
}

const download = (urlPrivate: string) =>
  downloadSlackFile({ token: 'test-token', urlPrivate, maxBytes: 1024 })

test('a file on a Slack host is fetched with the bot token', async () => {
  const { requests, fetch } = withFetch()

  try {
    for (const url of [
      'https://files.slack.com/files-pri/T1-F1/shot.png',
      'https://acme.enterprise.slack.com/files-pri/T1-F1/shot.png',
    ]) {
      const file = await download(url)

      expect(file?.contentType).toBe('image/png')
      expect(file?.bytes.byteLength).toBe(3)
    }
    expect(requests.map((request) => request.authorization)).toEqual([
      'Bearer test-token',
      'Bearer test-token',
    ])
  } finally {
    fetch.mockRestore()
  }
})

test('any other host is refused without a request', async () => {
  const { requests, fetch } = withFetch()

  try {
    for (const url of [
      'https://files.example.com/shot.png',
      'https://notslack.com/shot.png',
      'https://files.slack.com.example.com/shot.png',
      'http://files.slack.com/shot.png',
      'not a url',
    ]) {
      expect(await download(url)).toBeNull()
    }
    expect(requests).toEqual([])
  } finally {
    fetch.mockRestore()
  }
})
