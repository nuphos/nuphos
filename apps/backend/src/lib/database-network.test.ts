import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import {
  assertDatabaseNetworkConfiguration,
  isDatabaseDialerLoopbackHost,
} from '@/lib/database-network'

describe('database private network configuration', () => {
  const tailscale = {
    bindingId: new ObjectId('507f1f77bcf86cd799439011'),
    tag: 'tag:nuphos-database',
  }

  test('accepts a direct public connection without private network metadata', () => {
    expect(() => assertDatabaseNetworkConfiguration('public', undefined)).not.toThrow()
  })

  test('requires an explicit Tailscale binding and advertised tag selection', () => {
    expect(() => assertDatabaseNetworkConfiguration('tailscale', undefined)).toThrow(
      'Select a Tailscale OAuth binding and tag',
    )
    expect(() => assertDatabaseNetworkConfiguration('tailscale', tailscale)).not.toThrow()
  })

  test('rejects Tailscale metadata on the public execution path', () => {
    expect(() => assertDatabaseNetworkConfiguration('public', tailscale)).toThrow(
      'Tailscale configuration is only valid in tailscale network mode',
    )
  })

  test('keeps cluster relay unavailable until its execution plane exists', () => {
    expect(() => assertDatabaseNetworkConfiguration('cluster-relay', undefined)).toThrow(
      'Cluster relay database connectivity is not available yet',
    )
  })

  test('accepts only literal loopback addresses for the credential-bearing dialer', () => {
    expect(isDatabaseDialerLoopbackHost('127.0.0.1')).toBe(true)
    expect(isDatabaseDialerLoopbackHost('127.255.255.254')).toBe(true)
    expect(isDatabaseDialerLoopbackHost('::1')).toBe(true)
    expect(isDatabaseDialerLoopbackHost('[::1]')).toBe(true)
    expect(isDatabaseDialerLoopbackHost('localhost')).toBe(false)
    expect(isDatabaseDialerLoopbackHost('127.attacker.example')).toBe(false)
    expect(isDatabaseDialerLoopbackHost('127.0.0.999')).toBe(false)
  })
})
