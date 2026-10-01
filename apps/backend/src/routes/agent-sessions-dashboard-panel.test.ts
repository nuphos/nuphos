import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { dashboardPanelSessionId, mintDashboardPanelToken } from '@/lib/dashboards/panel-principal'
import { agentSessions } from '@/routes/agent-sessions'

const teamId = new ObjectId().toHexString()
const panelId = new ObjectId().toHexString()
const token = mintDashboardPanelToken({
  userId: new ObjectId().toHexString(),
  teamId,
  panelId,
  ttlSec: 60,
})
const mount = `/${dashboardPanelSessionId(panelId)}/teams/${teamId}`

async function status(path: string, method = 'GET'): Promise<number> {
  const response = await agentSessions.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.status
}

describe('dashboard panel token on the agent-session mount', () => {
  test('cannot reach MCP servers, plans or writes', async () => {
    expect(await status(`${mount}/mcp`, 'POST')).toBe(403)
    expect(await status(`${mount}/mcp-tools`, 'POST')).toBe(403)
    expect(await status(`${mount}/plans`)).toBe(403)
    expect(await status(`${mount}/selected-credentials`)).toBe(403)
    expect(await status(`${mount}/tailscale-clients/c-1/tailnet-sessions`, 'POST')).toBe(403)
  })

  test('is bound to its own panel and team', async () => {
    const otherPanel = dashboardPanelSessionId(new ObjectId().toHexString())

    expect(await status(`/${otherPanel}/teams/${teamId}/aws-accounts/1/credentials`)).toBe(403)
    expect(
      await status(
        `/${dashboardPanelSessionId(panelId)}/teams/${new ObjectId().toHexString()}/aws-accounts/1/credentials`,
      ),
    ).toBe(403)
  })
})
