import { describe, expect, test } from 'bun:test'

import { crashReportMetadata } from '@/lib/crash-reports'
import { createCrashReportRoutes } from '@/routes/desktop-crash-reports'

import type { CrashReportMetadata } from '@/lib/crash-reports'

const DEVICE = 'a'.repeat(32)

function setup(result: 'allowed' | 'limited' | 'unavailable' = 'allowed') {
  const consumed: { device: string; ip: string }[] = []
  const saved: { dump: Uint8Array; metadata: CrashReportMetadata }[] = []
  const routes = createCrashReportRoutes({
    consume: async (input) => {
      consumed.push(input)

      return result
    },
    save: async (dump, metadata) => {
      saved.push({ dump, metadata })

      return { id: 'report-1' }
    },
  })

  return { routes, consumed, saved }
}

// The fields Electron's Crashpad uploader sends, plus our own annotations.
function crashForm(dump: BlobPart = new Uint8Array([0x4d, 0x44, 0x4d, 0x50])) {
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

const post = (routes: ReturnType<typeof setup>['routes'], body: BodyInit, headers = {}) =>
  routes.request('/', { method: 'POST', body, headers })

describe('POST /desktop/crash-reports', () => {
  test('stores the minidump with allowlisted metadata and returns the report id', async () => {
    const { routes, consumed, saved } = setup()
    const res = await post(routes, crashForm(), { 'X-Forwarded-For': '203.0.113.9' })

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('report-1')
    expect(consumed).toEqual([{ device: DEVICE, ip: '203.0.113.9' }])
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

  test('answers 429 when the device or IP quota is spent, 503 when the limiter is down', async () => {
    const limited = setup('limited')
    const down = setup('unavailable')

    expect((await post(limited.routes, crashForm())).status).toBe(429)
    expect((await post(down.routes, crashForm())).status).toBe(503)
    expect(limited.saved).toHaveLength(0)
    expect(down.saved).toHaveLength(0)
  })

  test('a missing or malformed device id shares one "unknown" quota', async () => {
    const { routes, consumed } = setup()
    const form = crashForm()

    form.set('device', 'not-a-hash')
    await post(routes, form)
    expect(consumed[0]?.device).toBe('unknown')
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
