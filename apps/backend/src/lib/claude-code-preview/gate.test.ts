import { describe, expect, test } from 'bun:test'

import { isValidOpenAbTransportKey, resolveDevelopmentRuntimeEndpoint } from './gate'

describe('isValidOpenAbTransportKey', () => {
  test('enforces the WebSocket subprotocol token charset', () => {
    expect(isValidOpenAbTransportKey('a-Perfectly_Fine.Key~123')).toBe(true)
    expect(isValidOpenAbTransportKey('bad key with spaces')).toBe(false)
    expect(isValidOpenAbTransportKey('')).toBe(false)
  })
})

describe('resolveDevelopmentRuntimeEndpoint', () => {
  test('accepts only explicit loopback ACP endpoints', () => {
    expect(resolveDevelopmentRuntimeEndpoint()).toBeUndefined()
    expect(resolveDevelopmentRuntimeEndpoint('ws://127.0.0.1:18080/acp', 'local-key')).toEqual({
      url: 'ws://127.0.0.1:18080/acp',
      authKey: 'local-key',
    })
    expect(resolveDevelopmentRuntimeEndpoint('wss://localhost:18080/acp', 'local-key')).toEqual({
      url: 'wss://localhost:18080/acp',
      authKey: 'local-key',
    })
  })

  test('ignores a partial override so a stray var cannot abort a non-prod boot', () => {
    expect(resolveDevelopmentRuntimeEndpoint('ws://127.0.0.1:18080/acp')).toBeUndefined()
    expect(resolveDevelopmentRuntimeEndpoint(undefined, 'local-key')).toBeUndefined()
  })

  test('rejects remote and malformed overrides when both vars opt in', () => {
    expect(() =>
      resolveDevelopmentRuntimeEndpoint('wss://runtime.example/acp', 'local-key'),
    ).toThrow('loopback WebSocket URL')
    expect(() =>
      resolveDevelopmentRuntimeEndpoint('ws://127.0.0.1:18080/acp?unsafe=true', 'local-key'),
    ).toThrow('loopback WebSocket URL')
    expect(() => resolveDevelopmentRuntimeEndpoint('ws://127.0.0.1:18080/acp', 'bad key')).toThrow(
      'valid WebSocket protocol token',
    )
  })
})
