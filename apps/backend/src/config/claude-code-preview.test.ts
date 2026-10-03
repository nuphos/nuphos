import { afterEach, describe, expect, test } from 'bun:test'

import { claudeCodePreviewConfig, claudeCodeRuntimeProvisionerConfig } from './claude-code-preview'

const keys = [
  'CODEX_RUNTIME_DEV_URL',
  'CODEX_RUNTIME_DEV_AUTH_KEY',
  'OPENAB_RUNTIME_TOKEN_ENCRYPTION_KEY',
  'CLAUDE_CODE_RUNTIME_PROVISIONER_ENABLED',
  'CLAUDE_CODE_RUNTIME_NAMESPACE',
  'CLAUDE_CODE_RUNTIME_KUBECTL',
  'CLAUDE_CODE_RUNTIME_NODE_SELECTOR',
  'CLAUDE_CODE_RUNTIME_NODE_TOLERATIONS',
  'CLAUDE_CODE_RUNTIME_CPU_LIMIT',
  'CLAUDE_CODE_RUNTIME_DEV_URL',
  'CLAUDE_CODE_RUNTIME_DEV_AUTH_KEY',
  'CLAUDE_CODE_PREVIEW_TOKEN_ENCRYPTION_KEY',
  'NODE_ENV',
  'NUPHOS_LOCAL_STACK',
  'NUPHOS_JWT_SECRET',
] as const
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of keys) {
    const value = previous[key]

    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('claudeCodePreviewConfig', () => {
  test('defaults with no development runtime override', () => {
    for (const key of keys) delete process.env[key]
    expect(claudeCodePreviewConfig()).toEqual({
      tokenEncryptionKey: undefined,
      developmentRuntimeEndpoint: undefined,
    })

    process.env.CLAUDE_CODE_PREVIEW_TOKEN_ENCRYPTION_KEY = 'token-key'
    expect(claudeCodePreviewConfig()).toEqual({
      tokenEncryptionKey: 'token-key',
      developmentRuntimeEndpoint: undefined,
    })
  })

  test('reads the explicit development runtime endpoint outside production', () => {
    process.env.NODE_ENV = 'development'
    process.env.CLAUDE_CODE_RUNTIME_DEV_URL = 'ws://127.0.0.1:18080/acp'
    process.env.CLAUDE_CODE_RUNTIME_DEV_AUTH_KEY = 'local-transport-key'

    expect(claudeCodePreviewConfig().developmentRuntimeEndpoint).toEqual({
      url: 'ws://127.0.0.1:18080/acp',
      authKey: 'local-transport-key',
    })
  })

  test('ignores the development runtime endpoint in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.CLAUDE_CODE_RUNTIME_DEV_URL = 'ws://runtime.example/acp'
    process.env.CLAUDE_CODE_RUNTIME_DEV_AUTH_KEY = 'production-must-ignore-this'

    expect(claudeCodePreviewConfig().developmentRuntimeEndpoint).toBeUndefined()
  })
})

describe('local-stack token encryption key', () => {
  function localStack(nodeEnv: string) {
    for (const key of keys) delete process.env[key]
    process.env.NODE_ENV = nodeEnv
    process.env.NUPHOS_LOCAL_STACK = 'true'
    process.env.NUPHOS_JWT_SECRET = 'local-jwt-secret'
  }

  test('a local stack derives a stable 32-byte key from its JWT secret', () => {
    localStack('development')
    const key = claudeCodePreviewConfig().tokenEncryptionKey

    expect(Buffer.from(key ?? '', 'base64')).toHaveLength(32)
    expect(claudeCodePreviewConfig().tokenEncryptionKey).toBe(key)
  })

  test('production never derives one', () => {
    localStack('production')
    expect(claudeCodePreviewConfig().tokenEncryptionKey).toBeUndefined()
  })

  test('an explicit key wins', () => {
    localStack('development')
    process.env.CLAUDE_CODE_PREVIEW_TOKEN_ENCRYPTION_KEY = 'explicit-key'
    expect(claudeCodePreviewConfig().tokenEncryptionKey).toBe('explicit-key')
  })
})

describe('claudeCodeRuntimeProvisionerConfig', () => {
  test('defaults to disabled with the dedicated namespace', () => {
    for (const key of keys) delete process.env[key]

    expect(claudeCodeRuntimeProvisionerConfig()).toEqual({
      enabled: false,
      namespace: 'openab-runtimes',
      kubectl: false,
      scheduling: { nodeSelector: {}, tolerations: [], cpuLimit: '4' },
    })
  })

  test('parses the enable flag, namespace, and dev kubectl mode', () => {
    process.env.NODE_ENV = 'development'
    process.env.CLAUDE_CODE_RUNTIME_PROVISIONER_ENABLED = 'true'
    process.env.CLAUDE_CODE_RUNTIME_NAMESPACE = 'openab-dev'
    process.env.CLAUDE_CODE_RUNTIME_KUBECTL = 'true'

    expect(claudeCodeRuntimeProvisionerConfig()).toEqual({
      enabled: true,
      namespace: 'openab-dev',
      kubectl: true,
      scheduling: { nodeSelector: {}, tolerations: [], cpuLimit: '4' },
    })
  })

  test('pins runtimes to the isolated pool only when the pool is configured', () => {
    process.env.CLAUDE_CODE_RUNTIME_NODE_SELECTOR = 'cloud.google.com/gke-nodepool=example-pool'
    process.env.CLAUDE_CODE_RUNTIME_NODE_TOLERATIONS = 'nuphos.ai/runtime=true'
    process.env.CLAUDE_CODE_RUNTIME_CPU_LIMIT = '6'

    expect(claudeCodeRuntimeProvisionerConfig().scheduling).toEqual({
      nodeSelector: { 'cloud.google.com/gke-nodepool': 'example-pool' },
      tolerations: [{ key: 'nuphos.ai/runtime', value: 'true' }],
      cpuLimit: '6',
    })
  })

  test('an unconfigured pool leaves placement untouched, and `none` drops the CPU limit', () => {
    for (const key of keys) delete process.env[key]
    process.env.CLAUDE_CODE_RUNTIME_CPU_LIMIT = 'none'

    expect(claudeCodeRuntimeProvisionerConfig().scheduling).toEqual({
      nodeSelector: {},
      tolerations: [],
    })
  })

  test.each(['pool-runtime', ' =true', 'pool=  '])('rejects the malformed entry %j', (entry) => {
    process.env.CLAUDE_CODE_RUNTIME_NODE_SELECTOR = entry

    expect(() => claudeCodeRuntimeProvisionerConfig()).toThrow(/key=value/)
  })

  test.each(['4cores', '-1', '0', 'm'])('rejects the CPU limit %j', (limit) => {
    process.env.CLAUDE_CODE_RUNTIME_CPU_LIMIT = limit

    expect(() => claudeCodeRuntimeProvisionerConfig()).toThrow(/CPU quantity/)
  })

  test.each(['4', '500m', '2.5'])('accepts the CPU limit %j', (limit) => {
    process.env.CLAUDE_CODE_RUNTIME_CPU_LIMIT = limit

    expect(claudeCodeRuntimeProvisionerConfig().scheduling.cpuLimit).toBe(limit)
  })

  test('never uses the kubectl client in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.CLAUDE_CODE_RUNTIME_KUBECTL = 'true'

    expect(claudeCodeRuntimeProvisionerConfig().kubectl).toBe(false)
  })
})

test('Codex has an independent loopback override, ignored in production', () => {
  process.env.NODE_ENV = 'development'
  process.env.CODEX_RUNTIME_DEV_URL = 'ws://127.0.0.1:18081/acp'
  process.env.CODEX_RUNTIME_DEV_AUTH_KEY = 'codex-transport-key'
  expect(claudeCodePreviewConfig().codexDevelopmentRuntimeEndpoint?.url).toBe(
    'ws://127.0.0.1:18081/acp',
  )
  process.env.NODE_ENV = 'production'
  expect(claudeCodePreviewConfig().codexDevelopmentRuntimeEndpoint).toBeUndefined()
})
