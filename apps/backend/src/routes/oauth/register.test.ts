import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { useOauthStore } from '@/lib/test/doubles/oauth-store'

let registeredName: string | null | undefined

useOauthStore({
  registerClient: (input: { clientName: string | null; redirectUris: string[]; scope: string }) => {
    registeredName = input.clientName

    return Promise.resolve({ _id: 'client-1', ...input } as never)
  },
})

const { registerOauthRegisterRoute } = await import('./register')
const app = new Hono()

registerOauthRegisterRoute(app)

test('trims control characters and caps the client name length', async () => {
  const response = await app.request('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: ['https://client.example/cb'],
      client_name: `Claude‮\u0000${'x'.repeat(300)}`,
    }),
  })

  expect(response.status).toBe(201)
  expect(registeredName?.length).toBe(100)
  expect(registeredName?.startsWith('Claudexxx')).toBe(true)
})
