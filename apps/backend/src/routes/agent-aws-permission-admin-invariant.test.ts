// The invariant this whole feature is built around: widening what an agent may
// DRAFT must not widen what an agent may HOLD. A managed-principal registration
// and a permissions-boundary allowlist are authorization records, not
// identities — neither may ever appear in the credential selection.
import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

const TEAM = new ObjectId()
const ACCOUNT = '123456789012'
const BOUNDARY = `arn:aws:iam::${ACCOUNT}:policy/NuphosSubIdentityBoundary`

const byosDoc = {
  _id: TEAM,
  awsRoles: [
    {
      id: new ObjectId(),
      roleArn: `arn:aws:iam::${ACCOUNT}:role/nuphos-operator`,
      createdAt: new Date(),
      allowedBoundaryArns: [BOUNDARY],
    },
    {
      id: new ObjectId(),
      roleArn: `arn:aws:iam::${ACCOUNT}:role/nuphos-breakglass`,
      createdAt: new Date(),
      purpose: 'permission-admin' as const,
      allowedBoundaryArns: [BOUNDARY],
    },
  ],
  awsManagedPrincipals: [
    {
      id: new ObjectId(),
      principalArn: `arn:aws:iam::${ACCOUNT}:user/nuphos-monitoring/vps-1`,
      label: 'vps-1 monitoring',
      allowedBoundaryArns: [BOUNDARY],
      createdAt: new Date(),
      createdByUserId: 'admin-1',
    },
  ],
  gcpServiceAccounts: [],
  azureAccounts: [],
}

useDb({
  db: () => ({
    collection: () => ({
      findOne: () => Promise.resolve(byosDoc),
      find: () => ({ toArray: () => Promise.resolve([]) }),
    }),
  }),
})

const { getAgentCredentialOptions } = await import('./agent/credential-options')

describe('permission-admin stays out of the agent credential surface', () => {
  test('a permission-admin role is never offered as a credential', async () => {
    const options = await getAgentCredentialOptions(TEAM.toHexString(), 'u1')

    expect(options.awsRoles.map((r) => r.roleArn)).toEqual([
      `arn:aws:iam::${ACCOUNT}:role/nuphos-operator`,
    ])
  })

  test('a registered managed principal is never offered as a credential', async () => {
    const options = await getAgentCredentialOptions(TEAM.toHexString(), 'u1')
    const serialized = JSON.stringify(options)

    expect(serialized).not.toContain('nuphos-monitoring/vps-1')
  })
})
