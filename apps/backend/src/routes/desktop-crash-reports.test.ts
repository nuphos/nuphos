import { describe, expect, test } from 'bun:test'

import { crashReportMetadata, crashReportObjects, ipQuotaKey } from '@/lib/crash-reports'
import { createCrashReportRoutes } from '@/routes/desktop-crash-reports'

import type { CrashReportMetadata } from '@/lib/crash-reports'

const DEVICE = 'a'.repeat(32)

function setup(
  ipResult: 'allowed' | 'limited' | 'unavailable' = 'allowed',
  deviceResult: 'allowed' | 'limited' | 'unavailable' = 'allowed',
) {
  const consumed: string[] = []
  const saved: { dump: Uint8Array; metadata: CrashReportMetadata }[] = []
  const routes = createCrashReportRoutes({
    consumeIp: (ip) => {
      consumed.push(`ip:${ip}`)

      return Promise.resolve(ipResult)
    },
    consumeDevice: (device) => {
      consumed.push(`device:${device}`)

      return Promise.resolve(deviceResult)
    },
    save: (dump, metadata) => {
      saved.push({ dump, metadata })

      return Promise.resolve({ id: 'report-1' })
    },
  })

  return { routes, consumed, saved }
}

// The fields Electron's Crashpad uploader sends, plus our own annotations.
function crashForm(dump: Uint8Array = new Uint8Array([0x4d, 0x44, 0x4d, 0x50])) {
  const form = new FormData()

  form.set('upload_file_minidump', new File([dump], 'minidump.dmp'))
  form.set('ver', '43.8.3')
  form.set('_version', '0.91.1')
  form.set('platform', 'darwin')
  form.set('process_type', 'browser')
  form.set('arch', 'arm64')
  form.set('heap_used_mb', '3970')
  form.set('heap_limit_mb', '4096')
  form.set('uptime_s', '1293')
  form.set('device', DEVICE)
  form.set('_productName', 'Nuphos')
  form.set('email', 'someone@example.com')

  return form
}

const post = (routes: ReturnType<typeof setup>['routes'], body: FormData, headers = {}) =>
  routes.request('/', { method: 'POST', body, headers })

describe('POST /desktop/crash-reports', () => {
  test('stores the minidump with allowlisted metadata and returns the report id', async () => {
    const { routes, consumed, saved } = setup()
    const res = await post(routes, crashForm(), { 'X-Forwarded-For': '203.0.113.9' })

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('report-1')
    expect(consumed).toEqual(['ip:203.0.113.9', `device:${DEVICE}`])
    expect([...saved[0]!.dump]).toEqual([0x4d, 0x44, 0x4d, 0x50])
    expect(saved[0]!.metadata).toEqual({
      electronVersion: '43.8.3',
      appVersion: '0.91.1',
      platform: 'darwin',
      arch: 'arm64',
      processType: 'browser',
      heapUsedMb: 3970,
      heapLimitMb: 4096,
      uptimeSeconds: 1293,
    })
  })

  test('rejects a body over the size cap before storing anything', async () => {
    const { routes, saved } = setup()
    const res = await post(routes, crashForm(new Uint8Array(10 * 1024 * 1024 + 1)))

    expect(res.status).toBe(413)
    expect(saved).toHaveLength(0)
  })

  test('rejects a request without a minidump', async () => {
    const { routes, saved } = setup()
    const form = crashForm()

    form.delete('upload_file_minidump')
    expect((await post(routes, form)).status).toBe(400)
    expect(saved).toHaveLength(0)
  })

  test('a spent IP or global quota answers before the body is read', async () => {
    const limited = setup('limited')
    const down = setup('unavailable')

    expect((await post(limited.routes, crashForm())).status).toBe(429)
    expect((await post(down.routes, crashForm())).status).toBe(503)
    for (const { consumed, saved } of [limited, down]) {
      expect(consumed).toHaveLength(1)
      expect(saved).toHaveLength(0)
    }
  })

  test('a spent device quota answers 429 without storing', async () => {
    const { routes, saved } = setup('allowed', 'limited')

    expect((await post(routes, crashForm())).status).toBe(429)
    expect(saved).toHaveLength(0)
  })

  test('rejects a file that is not a minidump', async () => {
    const { routes, saved } = setup()

    expect(
      (await post(routes, crashForm(new TextEncoder().encode('{"not":"a dump"}')))).status,
    ).toBe(400)
    expect(saved).toHaveLength(0)
  })

  test('a missing or malformed device id shares one "unknown" quota', async () => {
    const { routes, consumed } = setup()
    const form = crashForm()

    form.set('device', 'not-a-hash')
    await post(routes, form)
    expect(consumed[1]).toBe('device:unknown')
  })
})

test('metadata drops unsafe or unknown values', () => {
  expect(
    crashReportMetadata({
      ver: '43.8.3; rm -rf',
      platform: 'darwin',
      heap_used_mb: '-1',
      uptime_s: '12.5',
      guid: 'abc',
    }),
  ).toEqual({ platform: 'darwin' })
})

test('keeps the raw dump only for main-process crashes', () => {
  const dump = new Uint8Array([0x4d, 0x44, 0x4d, 0x50])
  const at = '2026-10-26T03:00:00.000Z'
  const keys = (processType: string) =>
    crashReportObjects('id-1', at, dump, { processType }).map((object) => object.key)

  expect(keys('browser')).toEqual([
    'crash-reports/2026-10-26/id-1.dmp',
    'crash-reports/2026-10-26/id-1.json',
  ])
  expect(keys('renderer')).toEqual(['crash-reports/2026-10-26/id-1.json'])
  expect(JSON.parse(crashReportObjects('id-1', at, dump, {})[0]!.body as string)).toMatchObject({
    dumpKept: false,
  })
})

test('IPv6 addresses share a quota per /64', () => {
  expect(ipQuotaKey('203.0.113.9')).toBe('203.0.113.9')
  expect(ipQuotaKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2')
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- documentation range
  expect(ipQuotaKey('2001:0db8:0001:0002:ffff:1:2:3')).toBe('2001:db8:1:2')
  expect(ipQuotaKey('2001:db8::5')).toBe('2001:db8:0:0')
  expect(ipQuotaKey('::ffff:203.0.113.9')).toBe('203.0.113.9')
})
