import { afterEach, describe, expect, test } from 'bun:test'

import { coreConfig } from './core'

const keys = [
  'NODE_ENV',
  'NUPHOS_DEV_HTTP_PORT',
  'NUPHOS_DEV_EMAIL_OTP_LOG',
  'NUPHOS_LOCAL_STACK',
] as const
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of keys) {
    const value = previous[key]

    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('local-stack switches', () => {
  test('apply outside production', () => {
    process.env.NODE_ENV = 'development'
    process.env.NUPHOS_DEV_HTTP_PORT = '3818'
    process.env.NUPHOS_DEV_EMAIL_OTP_LOG = 'true'
    process.env.NUPHOS_LOCAL_STACK = 'true'

    const config = coreConfig()

    expect(config.server.devHttpPort).toBe(3818)
    expect(config.email.devLogOtp).toBe(true)
    expect(config.localStack).toBe(true)
  })

  test('are ignored in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.NUPHOS_DEV_HTTP_PORT = '3818'
    process.env.NUPHOS_DEV_EMAIL_OTP_LOG = 'true'
    process.env.NUPHOS_LOCAL_STACK = 'true'

    const config = coreConfig()

    expect(config.server.devHttpPort).toBe(0)
    expect(config.email.devLogOtp).toBe(false)
    expect(config.localStack).toBe(false)
  })
})
