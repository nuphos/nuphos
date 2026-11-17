import { describe, expect, test } from 'bun:test'

import {
  canCreateDashboard,
  canDeleteDashboard,
  canEditDashboard,
  canReadDashboard,
  canSetVisibility,
} from './visibility'

import type { DashboardViewer } from './visibility'

const owner = 'owner'
const personal = { createdBy: owner, visibility: 'personal' as const }
const team = { createdBy: owner, visibility: 'team' as const }
// Saved before visibility existed: shared with the team.
const legacy = { createdBy: owner }

const as = (userId: string, role: DashboardViewer['role']): DashboardViewer => ({ userId, role })

describe('dashboard visibility', () => {
  test('a personal dashboard is read and edited only by its creator, whatever their role', () => {
    expect(canReadDashboard(personal, as(owner, 'VIEWER'))).toBe(true)
    expect(canEditDashboard(personal, as(owner, 'VIEWER'))).toBe(true)
    for (const role of ['ADMINISTRATOR', 'EDITOR', 'VIEWER'] as const) {
      expect(canReadDashboard(personal, as('other', role))).toBe(false)
      expect(canEditDashboard(personal, as('other', role))).toBe(false)
    }
  })

  test('an Administrator cannot reach a current member’s personal dashboard', () => {
    const admin = as('admin', 'ADMINISTRATOR')

    expect(canReadDashboard(personal, admin)).toBe(false)
    expect(canDeleteDashboard(personal, admin)).toBe(false)
  })

  test('once its creator is no longer in the team, an Administrator takes it over', () => {
    const admin = as('admin', 'ADMINISTRATOR')

    expect(canReadDashboard(personal, admin, false)).toBe(true)
    expect(canEditDashboard(personal, admin, false)).toBe(true)
    expect(canDeleteDashboard(personal, admin, false)).toBe(true)
    expect(canSetVisibility(personal, admin, 'team', false)).toBe(true)
    expect(canReadDashboard(personal, as('editor', 'EDITOR'), false)).toBe(false)
  })

  test('a team dashboard, or one saved without visibility, is read by everyone and edited by write roles', () => {
    for (const dashboard of [team, legacy]) {
      expect(canReadDashboard(dashboard, as('viewer', 'VIEWER'))).toBe(true)
      expect(canEditDashboard(dashboard, as('editor', 'EDITOR'))).toBe(true)
      expect(canEditDashboard(dashboard, as('viewer', 'VIEWER'))).toBe(false)
      expect(canDeleteDashboard(dashboard, as('viewer', 'VIEWER'))).toBe(false)
    }
  })

  test('only the creator changes visibility, and sharing takes a write role', () => {
    expect(canSetVisibility(personal, as(owner, 'EDITOR'), 'team')).toBe(true)
    expect(canSetVisibility(personal, as(owner, 'VIEWER'), 'team')).toBe(false)
    expect(canSetVisibility(team, as(owner, 'EDITOR'), 'personal')).toBe(true)
    expect(canSetVisibility(team, as('admin', 'ADMINISTRATOR'), 'personal')).toBe(false)
  })

  test('any member creates a personal dashboard; a team one takes a write role', () => {
    expect(canCreateDashboard(as('viewer', 'VIEWER'), 'personal')).toBe(true)
    expect(canCreateDashboard(as('viewer', 'VIEWER'), 'team')).toBe(false)
    expect(canCreateDashboard(as('editor', 'EDITOR'), 'team')).toBe(true)
  })
})
