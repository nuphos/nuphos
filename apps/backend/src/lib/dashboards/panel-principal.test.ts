import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { mintPreviewMcpToken, verifyPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'

import {
  dashboardPanelIdFromSessionId,
  dashboardPanelSessionId,
  mintDashboardPanelToken,
  verifyDashboardPanelToken,
} from './panel-principal'

const ids = { userId: new ObjectId().toHexString(), teamId: new ObjectId().toHexString() }
const panelId = new ObjectId().toHexString()

describe('dashboard panel token', () => {
  test('round-trips its team, author and panel', () => {
    const claims = verifyDashboardPanelToken(
      mintDashboardPanelToken({ ...ids, panelId, ttlSec: 60 }),
    )

    expect(claims).toMatchObject({ sub: ids.userId, tid: ids.teamId, pid: panelId })
  })

  test('is not interchangeable with a conversation token', () => {
    const panelToken = mintDashboardPanelToken({ ...ids, panelId, ttlSec: 60 })
    const conversationToken = mintPreviewMcpToken({ ...ids, sessionId: 'session-1' })

    expect(verifyPreviewMcpToken(panelToken)).toBeNull()
    expect(verifyDashboardPanelToken(conversationToken)).toBeNull()
  })

  test('rejects expired and tampered tokens', () => {
    const expired = mintDashboardPanelToken({ ...ids, panelId, ttlSec: -1 })
    const [head, , signature] = mintDashboardPanelToken({ ...ids, panelId, ttlSec: 60 }).split('.')
    const forged = Buffer.from(
      JSON.stringify({
        aud: 'nuphos-dashboard-panel',
        sub: ids.userId,
        tid: ids.teamId,
        pid: panelId,
        exp: 9e9,
      }),
    ).toString('base64url')

    expect(verifyDashboardPanelToken(expired)).toBeNull()
    expect(verifyDashboardPanelToken(`${head}.${forged}.${signature}`)).toBeNull()
  })
})

describe('dashboard panel session ids', () => {
  test('map only well-formed panel ids', () => {
    expect(dashboardPanelIdFromSessionId(dashboardPanelSessionId(panelId))?.toHexString()).toBe(
      panelId,
    )
    expect(dashboardPanelIdFromSessionId('dashboard-panel-not-an-id')).toBeNull()
    expect(dashboardPanelIdFromSessionId('7c0f3d1e-5b1a-4a57-9c1e-9f3d2b1a0c4e')).toBeNull()
  })
})
