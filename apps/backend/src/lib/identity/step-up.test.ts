import { describe, expect, test } from 'bun:test'

import { isStepUpRoute } from '@/lib/identity/step-up'
import routeAccess from '@/routes/route-access.json'

// Run with: cd apps/backend && bun test src/lib/identity/step-up.test.ts

const SENSITIVE = [
  'POST /teams/:teamId/aws-accounts',
  'POST /teams/:teamId/gcp-projects',
  'POST /teams/:teamId/cloudflare-accounts/start-oauth',
  'PATCH /teams/:teamId/betterstack-integrations/:integrationId',
  'PUT /teams/:teamId/google-oauth-client',
  'POST /teams/:teamId/connector-oauth/:state/complete',
  'POST /personal-credentials/:provider/start',
  'POST /personal-credentials/:provider/complete',
  'POST /auth/cli-tokens',
  'POST /auth/device/approve',
  'POST /agent/devices/join-tokens',
  'DELETE /teams/:teamId',
  'PATCH /teams/:teamId/members/:memberId',
  'POST /teams/:teamId/transfer-ownership',
  'POST /auth/account-deletion',
]

const ORDINARY = [
  'GET /teams/:teamId/aws-accounts',
  'DELETE /teams/:teamId/aws-accounts/:accountId',
  'PATCH /teams/:teamId',
  'GET /auth/cli-tokens',
  'DELETE /auth/cli-tokens/:id',
  'POST /auth/mfa/reauth',
  'POST /auth/mfa/totp/setup',
  'POST /teams/:teamId/database-connections/test',
  'DELETE /teams/:teamId/members/:memberId',
]

const concrete = (key: string) => {
  const [method, path] = key.split(' ') as [string, string]

  return [method, path.replace(/:\w+/g, '64b7f0c2a1b2c3d4e5f60718')] as const
}

describe('isStepUpRoute', () => {
  test.each(SENSITIVE)('%s needs a recent check', (key) => {
    expect(Object.keys(routeAccess)).toContain(key)
    expect(isStepUpRoute(...concrete(key))).toBe(true)
  })

  test.each(ORDINARY)('%s does not', (key) => {
    expect(isStepUpRoute(...concrete(key))).toBe(false)
  })

  test('no read anywhere needs one', () => {
    const reads = Object.keys(routeAccess).filter((key) => key.startsWith('GET '))

    expect(reads.filter((key) => isStepUpRoute(...concrete(key)))).toEqual([])
  })
})
