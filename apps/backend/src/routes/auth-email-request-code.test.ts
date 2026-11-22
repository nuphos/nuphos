import { afterAll, afterEach, beforeAll, expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'

import { config } from '@/config'
import { errorHandler } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { useDownloadHandoffRateLimit } from '@/lib/test/doubles/download-handoff-rate-limit'

// The real email client runs here, against a stubbed Resend, so the answer a
// sign-in gets for each provider reply is the one production would send.

useDb({
  db: () => ({
    collection: () => ({
      updateOne: () => Promise.resolve(),
      deleteOne: () => Promise.resolve(),
    }),
  }),
})
useDownloadHandoffRateLimit({ consumePairQuota: () => Promise.resolve('allowed') })

const { auth } = await import('@/routes/auth')
const app = new Hono().route('/auth', auth).onError(errorHandler)

const email = { ...config.email }
let resend: () => Response
const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((() =>
  Promise.resolve(resend())) as unknown as typeof fetch)

beforeAll(() => {
  Object.assign(config.email, { resendApiKey: 're_test', from: 'Nuphos <code@example.com>' })
  config.email.devLogOtp = false
})
afterEach(() => {
  fetchSpy.mockClear()
})
afterAll(() => {
  Object.assign(config.email, email)
  fetchSpy.mockRestore()
})

function resendReply(status: number, message: string): () => Response {
  return () => Response.json({ statusCode: status, name: 'validation_error', message }, { status })
}

async function requestCode(address: string) {
  const res = await app.request('/auth/email/request-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: address }),
  })
  const body = (await res.json()) as { error?: { code: string; message: string } }

  return { status: res.status, error: body.error }
}

const notAnAddress = {
  status: 400,
  error: {
    code: 'invalid_email',
    message: "That email address doesn't look right. Check it and try again.",
  },
}

test.each([
  'name..last@example.com',
  '.name@example.com',
  'name@example.com,',
  'name@exa_mple.com',
])('%s is refused without asking the provider', async (address) => {
  expect(await requestCode(address)).toMatchObject(notAnAddress)
  expect(fetchSpy).not.toHaveBeenCalled()
})

test('the provider refusing the recipient is answered as a bad address', async () => {
  resend = resendReply(
    422,
    'Invalid `to` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.',
  )

  expect(await requestCode('name@example.com')).toMatchObject(notAnAddress)
  expect(fetchSpy).toHaveBeenCalledTimes(1)
})

test('any other provider failure stays a retryable 503', async () => {
  for (const reply of [
    resendReply(500, 'Internal server error'),
    resendReply(422, 'Invalid `from` field.'),
  ]) {
    resend = reply
    expect(await requestCode('name@example.com')).toMatchObject({
      status: 503,
      error: { code: 'otp_send_failed' },
    })
  }
})

test('a well-formed address is sent a code', async () => {
  resend = () => Response.json({ id: 'email_1' })

  expect((await requestCode('first.last+tag@example.co.uk')).status).toBe(200)
  expect(fetchSpy).toHaveBeenCalledTimes(1)
})
