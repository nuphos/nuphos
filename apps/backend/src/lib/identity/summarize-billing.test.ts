import { expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { mapTeam } from './shared'

import type { NuphosTeamDoc } from './shared'

test('all teams have free access regardless of persisted payment state', () => {
  for (const billing of [
    undefined,
    {},
    { subscription: { status: 'canceled' } },
    {
      subscription: { status: 'unpaid' },
      entitlementOverrides: { maxMembers: 0, maxEnvironments: 0, auditRetentionDays: 0 },
    },
    { awsMarketplace: { status: 'failed' }, overagePaused: true },
  ]) {
    const team: NuphosTeamDoc = {
      _id: new ObjectId(),
      ownerID: new ObjectId(),
      name: 'Free',
      avatarUrl: '',
      contactEmails: [],
      members: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      billing,
    }

    expect(mapTeam(team).billing).toEqual({ activated: true, active: true })
  }
})
