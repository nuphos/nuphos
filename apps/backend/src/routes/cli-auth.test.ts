import { afterEach, expect, test } from 'bun:test'

import { config } from '@/config'
import { useDb } from '@/lib/test/doubles/db'

import { createCliAuthRoutes } from './cli-auth'
import { DEVICE_PAGE_PATH } from './device-approval'

const savedBase = config.auth.publicBaseUrl
const savedOidc = { ...config.auth.oidc }
let inserted = 0

useDb({
  db: () => ({
    collection: () => ({
      insertOne: () => {
        inserted++

        return Promise.resolve({})
      },
    }),
  }),
})
const routes = createCliAuthRoutes(() => Promise.resolve(true))

afterEach(() => {
  config.auth.publicBaseUrl = savedBase
  Object.assign(config.auth.oidc, savedOidc)
})

test('a self-hosted device request uses its own approval page without OIDC', async () => {
  config.auth.publicBaseUrl = 'https://backend.example.test'
  config.auth.oidc.issuer = ''
  const response = await routes.request('/device', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientName: 'test CLI' }),
  })
  const body = (await response.json()) as {
    verificationUri: string
    userCode: string
    deviceCode: string
  }

  expect(response.status).toBe(200)
  expect(body.verificationUri).toBe(`https://backend.example.test${DEVICE_PAGE_PATH}`)
  expect(body.userCode).toMatch(/^[A-Z]{4}-[A-Z]{4}$/)
  expect(body.deviceCode.length).toBeGreaterThan(20)
  expect(inserted).toBeGreaterThan(0)
})
