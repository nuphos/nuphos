import { afterEach, describe, expect, test } from 'bun:test'

import { config } from '@/config'

import { previewSessionAccess } from './credentials-mcp'
import {
  isAllowedRemoteOpenAbUrl,
  isInternalRuntimeUrl,
  pickPublicBackendUrl,
  pickRuntimeBackendUrl,
} from './runtime-backend-url'

const inCluster = {
  podNamespace: 'production',
  port: 3000,
  backendUrl: 'http://nuphos-backend.production.svc.cluster.local:3000',
  publicBackendUrl: 'https://api.nuphos.ai',
}

describe('runtime backend url', () => {
  test('keeps a managed runtime on the in-cluster Service', () => {
    expect(pickRuntimeBackendUrl(false, inCluster)).toBe(
      'http://nuphos-backend.production.svc:3000',
    )
  })

  test('hands an external runtime the public base, trailing slash trimmed', () => {
    expect(
      pickRuntimeBackendUrl(true, { ...inCluster, publicBackendUrl: 'https://api.nuphos.ai/' }),
    ).toBe('https://api.nuphos.ai')
  })

  test('rejects a cluster-internal or loopback base as the public one', () => {
    expect(pickPublicBackendUrl({ ...inCluster, publicBackendUrl: undefined })).toBeUndefined()
    expect(
      pickPublicBackendUrl({
        ...inCluster,
        publicBackendUrl: undefined,
        backendUrl: 'http://localhost:3000',
      }),
    ).toBeUndefined()
  })

  test('off-cluster, a loopback backend url is the only reachable one', () => {
    const local = { port: 3000, backendUrl: 'http://localhost:3000' }

    expect(pickPublicBackendUrl(local)).toBe('http://localhost:3000')
    expect(pickRuntimeBackendUrl(false, local)).toBe('http://localhost:3000')
  })

  test('ignores a base that is neither https nor a dev loopback', () => {
    expect(
      pickPublicBackendUrl({
        port: 3000,
        publicBackendUrl: 'wss://runtime.example.com/acp',
        backendUrl: 'https://api.nuphos.ai',
      }),
    ).toBe('https://api.nuphos.ai')
  })

  // The bearer that travels to this base vends the team's cloud credentials,
  // the same reason a remote runtime URL must be wss://.
  test('refuses a plaintext public base', () => {
    expect(
      pickPublicBackendUrl({ ...inCluster, publicBackendUrl: 'http://api.nuphos.ai' }),
    ).toBeUndefined()
    expect(
      pickPublicBackendUrl({ ...inCluster, publicBackendUrl: 'http://127.0.0.1:3000' }),
    ).toBeUndefined()
  })
})

describe('isAllowedRemoteOpenAbUrl', () => {
  const localStack = config.localStack

  afterEach(() => {
    config.localStack = localStack
  })

  test('accepts wss anywhere and cleartext ws only inside the cluster', () => {
    expect(isAllowedRemoteOpenAbUrl('wss://openab.example/acp')).toBe(true)
    expect(isAllowedRemoteOpenAbUrl('ws://openab-team-x.openab-runtimes.svc:8080/acp')).toBe(true)
    expect(isAllowedRemoteOpenAbUrl('ws://openab.production.svc.cluster.local:8080/acp')).toBe(true)
    expect(isAllowedRemoteOpenAbUrl('ws://openab.example/acp')).toBe(false)
    expect(isAllowedRemoteOpenAbUrl('http://openab.example/acp')).toBe(false)
    expect(isAllowedRemoteOpenAbUrl('not a url')).toBe(false)
  })

  test('on a local stack, this machine and a compose service host are internal', () => {
    config.localStack = true

    expect(isAllowedRemoteOpenAbUrl('ws://runtime:8080/acp')).toBe(true)
    expect(isAllowedRemoteOpenAbUrl('ws://localhost:18180/acp')).toBe(true)
    expect(isAllowedRemoteOpenAbUrl('ws://127.0.0.1:18180/acp')).toBe(true)
    expect(isInternalRuntimeUrl('ws://runtime:8080/acp')).toBe(true)
    expect(isAllowedRemoteOpenAbUrl('ws://10.0.0.5:8080/acp')).toBe(false)
    expect(isAllowedRemoteOpenAbUrl('ws://openab.example/acp')).toBe(false)
  })

  test('elsewhere, only *.svc hosts may skip wss', () => {
    config.localStack = false

    expect(isAllowedRemoteOpenAbUrl('ws://runtime:8080/acp')).toBe(false)
    expect(isAllowedRemoteOpenAbUrl('ws://localhost:18180/acp')).toBe(false)
    expect(isInternalRuntimeUrl('ws://runtime:8080/acp')).toBe(false)
    expect(isInternalRuntimeUrl('ws://openab.production.svc:8080/acp')).toBe(true)
    expect(isAllowedRemoteOpenAbUrl('wss://runtime:8080/acp')).toBe(true)
  })
})

// The suite runs off-cluster with NUPHOS_PUBLIC_BACKEND_URL seeded and
// NUPHOS_BACKEND_URL unset, so a managed session has no reachable base at all
// and an external one has exactly the public base.
describe('what a self-hosted session is handed', () => {
  const managed = previewSessionAccess('conv-1', 'team-1', 'user-1')
  const external = previewSessionAccess('conv-1', 'team-1', 'user-1', 'user-1', { external: true })

  test('MCP mounts resolve to the public base', () => {
    expect(managed.mcpServers).toEqual([])
    expect(external.mcpServers.map((server) => server.url)).toEqual([
      'https://unit-test.invalid/agent-sessions/conv-1/teams/team-1/mcp',
      'https://unit-test.invalid/agent-sessions/conv-1/teams/team-1/mcp-tools',
    ])
    expect(external.runtimeEnv?.NUPHOS_BACKEND_URL).toBe('https://unit-test.invalid')
  })
})
