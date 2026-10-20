import { describe, expect, test } from 'bun:test'

import { createCliRoutes } from '@/routes/cli'

describe('GET /cli/latest', () => {
  test('answers the newest version as plain text', async () => {
    const app = createCliRoutes({
      latest: () => Promise.resolve({ version: '0.5.4', url: 'https://x', body: '' }),
    })
    const res = await app.request('/latest')

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('0.5.4\n')
  })

  test('says why when the release feed cannot be read', async () => {
    const res = await createCliRoutes({ latest: () => Promise.resolve(null) }).request('/latest')

    expect(res.status).toBe(503)
    expect(await res.text()).toContain('could not be read')
  })
})
