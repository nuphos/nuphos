import { expect, test } from 'bun:test'

import { clientIp, requestOrigin } from './request-origin'

const headers = (values: Record<string, string>) => (name: string) => values[name]

test("the client IP is Cloudflare's, else the right-most forwarded hop", () => {
  expect(clientIp('203.0.113.1', '198.51.100.9, 198.51.100.2')).toBe('203.0.113.1')
  expect(clientIp(undefined, '198.51.100.9, 198.51.100.2')).toBe('198.51.100.2')
  expect(clientIp(undefined, undefined)).toBeUndefined()
})

test('a request origin carries city and country only when Cloudflare names them', () => {
  expect(
    requestOrigin(
      headers({ 'CF-Connecting-IP': '203.0.113.1', 'CF-IPCity': 'Taipei', 'CF-IPCountry': 'TW' }),
    ),
  ).toEqual({ ip: '203.0.113.1', city: 'Taipei', country: 'TW' })
  expect(
    requestOrigin(headers({ 'X-Forwarded-For': '198.51.100.2', 'CF-IPCountry': 'XX' })),
  ).toEqual({
    ip: '198.51.100.2',
  })
  expect(requestOrigin(headers({}))).toBeUndefined()
})
