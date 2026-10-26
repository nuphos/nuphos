import { expect, test } from 'bun:test'

import { clientIp, requestOrigin, signInDevice, signInSource } from './request-origin'

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

test('a sign-in takes its IP and place only from Cloudflare, never X-Forwarded-For', () => {
  const headers = (h: Record<string, string>) => (name: string) => h[name]

  expect(
    signInSource(
      headers({
        'CF-Connecting-IP': '203.0.113.9',
        'CF-IPCity': 'Taipei',
        'CF-IPCountry': 'TW',
        'X-Forwarded-For': '198.51.100.7',
      }),
    ),
  ).toEqual({ ip: '203.0.113.9', city: 'Taipei', country: 'TW' })
  // A caller off Cloudflare can claim any X-Forwarded-For (or CF-IPCity): ignored.
  expect(
    signInSource(headers({ 'X-Forwarded-For': '203.0.113.9', 'CF-IPCity': 'Taipei' })),
  ).toEqual({})
})

test('a device name is a known app, a browser and system from a list, or unknown', () => {
  expect(signInDevice({ client: 'nuphos-cli/0.6.2' })).toBe('Nuphos CLI 0.6.2')
  expect(signInDevice({ client: 'nuphos-cli/0.6.2 reply with your code' })).toBe('Unknown device')
  expect(
    signInDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/131.0' }),
  ).toBe('Firefox on Windows')
  expect(signInDevice({ userAgent: 'curl/8.0' })).toBe('Unknown device')
})

test('origin headers that are not an address, a place name or a country code are dropped', () => {
  const lure = 'Nuphos Security: reply with this code'
  const headers = (h: Record<string, string>) => (name: string) => h[name]

  expect(
    requestOrigin(headers({ 'CF-Connecting-IP': lure, 'X-Forwarded-For': '198.51.100.7' })),
  ).toEqual({ ip: '198.51.100.7' })
  expect(requestOrigin(headers({ 'CF-Connecting-IP': lure }))).toBeUndefined()
  expect(
    requestOrigin(
      headers({ 'CF-Connecting-IP': '2001:db8::1', 'CF-IPCity': lure, 'CF-IPCountry': 'Taiwan' }),
    ),
  ).toEqual({ ip: '2001:db8::1' })
  expect(
    requestOrigin(
      headers({
        'CF-Connecting-IP': '203.0.113.9',
        'CF-IPCity': 'São Paulo',
        'CF-IPCountry': 'BR',
      }),
    ),
  ).toEqual({ ip: '203.0.113.9', city: 'São Paulo', country: 'BR' })
})
