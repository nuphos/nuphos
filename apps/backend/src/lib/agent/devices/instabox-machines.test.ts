import { InstaboxError } from '@insforge/instabox-sdk'
import { afterEach, expect, spyOn, test } from 'bun:test'

import { real } from '@/lib/test/doubles/instabox-machines'

const { resizeMachine } = real
const conn = { apiKey: 'key', apiUrl: 'https://instabox.example' }
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | undefined

afterEach(() => {
  fetchSpy?.mockRestore()
})

test('a resize is one PATCH of the machine with only what changes', async () => {
  const sent: [string, RequestInit][] = []

  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
    url: string,
    init: RequestInit,
  ) => {
    sent.push([url, init])

    return new Response('{}', { status: 200 })
  }) as never)
  await resizeMachine(conn, 'm_1', { diskGiB: 50 })
  await resizeMachine(conn, 'm_1', { vcpus: 8, memMiB: 16384 })
  expect(sent.map(([url, init]) => [url, init.method, init.body])).toEqual([
    ['https://instabox.example/v1/machines/m_1', 'PATCH', '{"persistentDiskGiB":50}'],
    ['https://instabox.example/v1/machines/m_1', 'PATCH', '{"vcpus":8,"memMiB":16384}'],
  ])
  expect(new Headers(sent[0]?.[1].headers).get('X-API-Key')).toBe('key')
})

test('a refusal carries instabox’s own code and message', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json(
      { error: { code: 'spec_not_allowed', message: 'Your plan does not offer this size' } },
      { status: 400 },
    ),
  )
  const error = await resizeMachine(conn, 'm_1', { vcpus: 64, memMiB: 131072 }).catch(
    (e: unknown) => e,
  )

  expect(error).toBeInstanceOf(InstaboxError)
  expect(error).toMatchObject({
    status: 400,
    code: 'spec_not_allowed',
    message: 'Your plan does not offer this size',
  })
})
