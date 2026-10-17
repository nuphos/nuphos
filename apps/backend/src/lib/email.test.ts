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
    provider: 'zsend',
    zsendApiKey: undefined,
    resendApiKey: undefined,
    from: 'Nuphos <noreply@example.com>',
    ...email,
  })
}

describe('isEmailConfigured', () => {
  test('checks the key of the selected provider only', () => {
    configure({ provider: 'resend', zsendApiKey: 'zs_key' })
    expect(isEmailConfigured()).toBe(false)

    configure({ provider: 'resend', resendApiKey: 're_key' })
    expect(isEmailConfigured()).toBe(true)

    configure({ provider: 'zsend', resendApiKey: 're_key' })
    expect(isEmailConfigured()).toBe(false)
  })

  test('requires a sender address', () => {
    configure({ provider: 'resend', resendApiKey: 're_key', from: undefined })
    expect(isEmailConfigured()).toBe(false)
  })
})

describe('sendEmail', () => {
  test('posts to ZSend with the ZSend key by default', async () => {
    configure({ zsendApiKey: 'zs_key', resendApiKey: 're_key' })
    const calls = stubFetch(200)

    await sendEmail(message)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.zeabur.com/api/v1/zsend/emails')
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer zs_key')
  })

  test('posts to Resend with the Resend key when selected', async () => {
    configure({ provider: 'resend', zsendApiKey: 'zs_key', resendApiKey: 're_key' })
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
    configure({ provider: 'resend', resendApiKey: 're_key' })
    stubFetch(422, '{"message":"domain not verified"}')

    await expect(sendEmail(message)).rejects.toThrow(
      'Resend send failed: HTTP 422 — {"message":"domain not verified"}',
    )
  })

  test('names the missing key of the selected provider', async () => {
    configure({ provider: 'resend', zsendApiKey: 'zs_key' })

    await expect(sendEmail(message)).rejects.toThrow('RESEND_API_KEY / NUPHOS_EMAIL_FROM')
  })
})
