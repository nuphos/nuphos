import { describe, expect, test } from 'bun:test'

import { conversationTeamApiRoute, dashboardPanelTeamApiRoute } from './conversation-api-routes'

describe('conversation member reads', () => {
  test('routes member list and ID reads to canonical handlers', () => {
    expect(conversationTeamApiRoute('GET', '/members')).toBe('canonical')
    expect(conversationTeamApiRoute('GET', '/members/member-1')).toBe('canonical')
  })

  test('denies member writes and unrelated paths', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      for (const path of ['/members', '/members/member-1']) {
        expect(conversationTeamApiRoute(method, path)).toBeNull()
      }
    }
    for (const path of ['/members/', '/members/member-1/role', '/memberships', '/']) {
      expect(conversationTeamApiRoute('GET', path)).toBeNull()
    }
    expect(dashboardPanelTeamApiRoute('GET', '/members/member-1')).toBeNull()
  })
})

describe('dashboardPanelTeamApiRoute', () => {
  test('vends selected credentials through the session handlers', () => {
    expect(dashboardPanelTeamApiRoute('GET', '/aws-accounts/123456789012/credentials')).toBe(
      'session',
    )
    expect(dashboardPanelTeamApiRoute('GET', '/gcp-projects/p-1/credentials')).toBe('session')
  })

  test('reads connector metadata, usage and dashboards canonically', () => {
    expect(dashboardPanelTeamApiRoute('GET', '/aws-accounts')).toBe('canonical')
    expect(dashboardPanelTeamApiRoute('GET', '/usage')).toBe('canonical')
    expect(dashboardPanelTeamApiRoute('GET', '/billing/usage')).toBe('canonical')
    expect(dashboardPanelTeamApiRoute('GET', '/dashboards/dash-1')).toBe('canonical')
    expect(dashboardPanelTeamApiRoute('GET', '/cost-dashboards/dash-1')).toBe('canonical')
  })

  test('denies every write and everything outside the panel read set', () => {
    expect(dashboardPanelTeamApiRoute('POST', '/dashboards')).toBeNull()
    expect(dashboardPanelTeamApiRoute('POST', '/cost-dashboards')).toBeNull()
    expect(dashboardPanelTeamApiRoute('POST', '/tailscale-clients/c-1/tailnet-sessions')).toBeNull()
    expect(dashboardPanelTeamApiRoute('PATCH', '/uptime-kuma-instances/i-1/monitors/1')).toBeNull()
    expect(
      dashboardPanelTeamApiRoute('POST', '/grafana-instances/g-1/proxy/api/ds/query'),
    ).toBeNull()
    expect(dashboardPanelTeamApiRoute('GET', '/knowledge')).toBeNull()
    expect(dashboardPanelTeamApiRoute('GET', '/agent-triggers')).toBeNull()
    expect(dashboardPanelTeamApiRoute('GET', '/billing')).toBeNull()
    expect(dashboardPanelTeamApiRoute('GET', '/members')).toBeNull()
  })
})
