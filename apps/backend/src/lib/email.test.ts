import { afterEach, describe, expect, test } from 'bun:test'

import { config } from '@/config'

import { isEmailConfigured, sendEmail } from './email'

const realFetch = globalThis.fetch
const realEmail = { ...config.email }
const message = { to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' }

type Captured = { url: string; init: RequestInit }

afterEach(() => {
  globalThis.fetch = realFetch
  Object.assign(config.email, realEmail)
})

function stubFetch(status: number, body = ''): Captured[] {
  const calls: Captured[] = []

  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init })

    return Promise.resolve(new Response(body, { status }))
  }) as unknown as typeof fetch

  return calls
}

function configure(email: Partial<typeof config.email>) {
  Object.assign(config.email, {
    resendApiKey: undefined,
    from: 'Nuphos <noreply@example.com>',
    ...email,
  })
}

describe('isEmailConfigured', () => {
  test('requires the Resend key', () => {
    configure({})
    expect(isEmailConfigured()).toBe(false)

    configure({ resendApiKey: 're_key' })
    expect(isEmailConfigured()).toBe(true)
  })

  test('requires a sender address', () => {
    configure({ resendApiKey: 're_key', from: undefined })
    expect(isEmailConfigured()).toBe(false)
  })
})

describe('sendEmail', () => {
  test('posts to Resend with the Resend key', async () => {
    configure({ resendApiKey: 're_key' })
    const calls = stubFetch(200)

    await sendEmail(message)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.resend.com/emails')
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer re_key')
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      from: 'Nuphos <noreply@example.com>',
      to: ['a@example.com'],
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
    })
  })

  test('names the provider in a failed send', async () => {
    configure({ resendApiKey: 're_key' })
    stubFetch(422, '{"message":"domain not verified"}')

    await expect(sendEmail(message)).rejects.toThrow(
      'Resend send failed: HTTP 422 — {"message":"domain not verified"}',
    )
  })

  test('names the missing key', async () => {
    configure({})

    await expect(sendEmail(message)).rejects.toThrow('RESEND_API_KEY / NUPHOS_EMAIL_FROM')
  })
})
