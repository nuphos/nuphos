import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { UptimeKumaApiError } from '@/lib/byos/uptime-kuma-core'
import { errorHandler } from '@/lib/errors'
import { useAgentSessionsShared } from '@/lib/test/doubles/agent-sessions-shared'
import { useByosUptimeKuma } from '@/lib/test/doubles/byos-uptime-kuma'
import { useModels } from '@/lib/test/doubles/models'

import type { AgentUptimeKumaVars } from '@/routes/agent-sessions/shared'

const TEAM_ID = new ObjectId()
const USER_ID = new ObjectId().toHexString()
const INSTANCE_ID = new ObjectId()

let monitorError: Error | null = null

useModels({
  teamByosBindings: () => ({
    findOne: async () => ({
      _id: TEAM_ID,
      uptimeKumaInstances: [
        {
          id: INSTANCE_ID,
          label: 'Status',
          baseUrl: 'https://status.example.com',
          authType: 'password',
          username: 'ops',
          access: { memberAllowList: ['*'], updatedAt: new Date(), updatedBy: USER_ID },
        },
      ],
    }),
  }),
})

useAgentSessionsShared({
  getAgentCredentialAccess: async () => ({ uptimeKumaInstanceIds: [INSTANCE_ID.toHexString()] }),
})

useByosUptimeKuma({
  getUptimeKumaMonitor: async () => {
    if (monitorError) throw monitorError

    return { id: 7, name: 'API' } as never
  },
})

const { uptimeKumaScoped } = await import('@/routes/agent-sessions/uptime-kuma')

async function getMonitor(): Promise<{ status: number; code?: string }> {
  const outer = new Hono<{ Variables: AgentUptimeKumaVars }>()

  outer.onError(errorHandler)
  outer.use('*', async (c, next) => {
    c.set('teamId', TEAM_ID.toHexString())
    c.set('userId', USER_ID)
    c.set('agent', { userId: USER_ID, sessionId: 's-1' } as AgentUptimeKumaVars['agent'])
    await next()
  })
  outer.route('/uptime-kuma-instances/:instanceId', uptimeKumaScoped)
  const res = await outer.request(`/uptime-kuma-instances/${INSTANCE_ID.toHexString()}/monitors/7`)
  const body = (await res.json()) as { error?: { code: string } }

  return { status: res.status, code: body.error?.code }
}

// Agent conversations reach Uptime Kuma through this route, not the team one,
// so it must map errors the same way.
describe('GET uptime-kuma-instances/:id/monitors/:monitorId (session)', () => {
  test('a missing monitor is 404 monitor_not_found', async () => {
    monitorError = new UptimeKumaApiError(404, 'Uptime Kuma monitor 7 does not exist')

    expect(await getMonitor()).toEqual({ status: 404, code: 'monitor_not_found' })
  })

  test('a real upstream failure is still 503', async () => {
    monitorError = new UptimeKumaApiError(502, 'SQLITE_BUSY: database is locked')

    expect(await getMonitor()).toEqual({ status: 503, code: 'uptime_kuma_api_error' })
  })
})
