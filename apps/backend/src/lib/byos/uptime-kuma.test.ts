import { describe, expect, test } from 'bun:test'

import {
  blockedUptimeKumaHostReason,
  normalizeUptimeKumaBaseUrl,
  sanitizeUptimeKumaMonitor,
} from './uptime-kuma'

describe('normalizeUptimeKumaBaseUrl', () => {
  test('strips all trailing slashes', () => {
    expect(normalizeUptimeKumaBaseUrl('https://status.example.com///')).toBe(
      'https://status.example.com',
    )
    expect(normalizeUptimeKumaBaseUrl('https://status.example.com/path///')).toBe(
      'https://status.example.com/path',
    )
  })
})

describe('blockedUptimeKumaHostReason', () => {
  test('allows ordinary public HTTP(S) Uptime Kuma URLs', () => {
    expect(blockedUptimeKumaHostReason('https://status.example.com')).toBeNull()
    expect(blockedUptimeKumaHostReason('http://status.example.com:3001')).toBeNull()
  })

  test('rejects embedded credentials and non-HTTP protocols', () => {
    expect(blockedUptimeKumaHostReason('https://user:pass@status.example.com')).toContain(
      'embedded credentials',
    )
    expect(blockedUptimeKumaHostReason('ftp://status.example.com')).toContain('http:// or https://')
  })

  test('rejects localhost and private/reserved literal addresses', () => {
    const blocked = [
      'http://localhost:3001',
      'http://service.local:3001',
      'http://127.0.0.1:3001',
      'http://10.1.2.3:3001',
      'http://172.16.0.1:3001',
      'http://192.168.0.1:3001',
      'http://169.254.169.254',
      'http://100.64.0.1:3001',
      'http://[::1]:3001',
      'http://[fd00::1]:3001',
      'http://[fe80::1]:3001',
      'http://[::ffff:127.0.0.1]:3001',
    ]

    for (const url of blocked) {
      expect(typeof blockedUptimeKumaHostReason(url), url).toBe('string')
    }
  })

  test('rejects non-Uptime-Kuma destination ports', () => {
    expect(blockedUptimeKumaHostReason('https://status.example.com:6379')).toContain('port')
  })
})

describe('sanitizeUptimeKumaMonitor', () => {
  test('keeps public hierarchy/display fields and drops raw secret fields', () => {
    const monitor = sanitizeUptimeKumaMonitor({
      id: '7',
      name: 'API',
      type: 'http',
      url: 'https://api.example.com/health',
      active: true,
      interval: 60,
      retryInterval: 30,
      parent: 3,
      childrenIDs: ['8'],
      weight: 10,
      pathName: 'Production / API',
      status: 'up',
      tags: [{ name: 'prod' }],
      headers: 'Authorization: Bearer secret',
      basic_auth_pass: 'secret',
      pushToken: 'secret',
      mqttPassword: 'secret',
    })

    expect(monitor).toEqual({
      id: 7,
      name: 'API',
      type: 'http',
      url: 'https://api.example.com/health',
      active: true,
      interval: 60,
      retryInterval: 30,
      parent: 3,
      childrenIDs: ['8'],
      weight: 10,
      pathName: 'Production / API',
      status: 'up',
      tags: [{ name: 'prod' }],
    })
    expect('headers' in monitor).toBe(false)
    expect('basic_auth_pass' in monitor).toBe(false)
    expect('pushToken' in monitor).toBe(false)
    expect('mqttPassword' in monitor).toBe(false)
  })
})
