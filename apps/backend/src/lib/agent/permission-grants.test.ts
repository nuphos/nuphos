import { describe, expect, test } from 'bun:test'

import { getProposalChanges, proposalDecisions, proposalSummaryLabel } from './permission-grants'

import type { PermissionGrantProposal } from './permission-grants'

function proposal(overrides: Partial<PermissionGrantProposal>): PermissionGrantProposal {
  return {
    teamId: 't1',
    sessionId: 's1',
    createdByUserId: 'u1',
    provider: 'aws',
    permissionAdminBindingId: 'b1',
    permissionAdminLabel: 'nuphos-permission-admin',
    reason: 'hit a wall',
    status: 'proposed',
    createdAt: new Date('2026-07-25T00:00:00Z'),
    ...overrides,
  }
}

describe('getProposalChanges', () => {
  test('synthesizes a change from legacy single-change fields', () => {
    const p = proposal({
      action: 'revoke',
      grantLabel: 'AmazonS3FullAccess',
      targetRoleArn: 'arn:aws:iam::1:role/op',
      policyArn: 'arn:aws:iam::aws:policy/AmazonS3FullAccess',
    })

    expect(getProposalChanges(p)).toEqual([
      {
        action: 'revoke',
        grantLabel: 'AmazonS3FullAccess',
        targetRoleArn: 'arn:aws:iam::1:role/op',
        policyArn: 'arn:aws:iam::aws:policy/AmazonS3FullAccess',
        targetServiceAccountEmail: undefined,
        role: undefined,
      },
    ])
  })
})

describe('proposalSummaryLabel', () => {
  test('single create-custom change', () => {
    const p = proposal({
      changes: [{ action: 'create-custom', grantLabel: 'nuphos-s3-uploads-read' }],
    })

    expect(proposalSummaryLabel(p)).toBe('Create nuphos-s3-uploads-read')
  })

  test('mixed batch counts grants, creates, and revokes', () => {
    const p = proposal({
      changes: [
        { action: 'grant', grantLabel: 'a' },
        { action: 'create-custom', grantLabel: 'b' },
        { action: 'revoke', grantLabel: 'c' },
      ],
    })

    expect(proposalSummaryLabel(p)).toBe('3 permission changes (grant 1, create 1, revoke 1)')
  })
})

describe('proposalDecisions', () => {
  test('aws create-custom renders the actual statements, not just the label', () => {
    const p = proposal({
      accountId: '123456789012',
      changes: [
        {
          action: 'create-custom',
          grantLabel: 'nuphos-s3-uploads-read',
          targetRoleArn: 'arn:aws:iam::1:role/op',
          inlinePolicyName: 'nuphos-s3-uploads-read',
          policyDocument: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              { Effect: 'Allow', Action: ['s3:GetObject'], Resource: ['arn:aws:s3:::uploads/*'] },
              { Effect: 'Allow', Action: 's3:ListBucket', Resource: 'arn:aws:s3:::uploads' },
            ],
          }),
        },
      ],
    })
    const rows = proposalDecisions(p)

    expect(rows).toEqual([
      {
        label: 'Create policy',
        value: 'nuphos-s3-uploads-read (inline) on arn:aws:iam::1:role/op',
      },
      { label: 'Allow', value: 's3:GetObject on arn:aws:s3:::uploads/*' },
      { label: 'Allow', value: 's3:ListBucket on arn:aws:s3:::uploads' },
      { label: 'AWS account', value: '123456789012' },
      { label: 'Via permission-admin', value: 'nuphos-permission-admin' },
    ])
  })

  test('aws revoke of an inline policy renders as a delete', () => {
    const p = proposal({
      accountId: '123456789012',
      changes: [
        {
          action: 'revoke',
          grantLabel: 'nuphos-s3-uploads-read',
          targetRoleArn: 'arn:aws:iam::1:role/op',
          inlinePolicyName: 'nuphos-s3-uploads-read',
        },
      ],
    })

    expect(proposalDecisions(p)[0]).toEqual({
      label: 'Delete policy',
      value: 'nuphos-s3-uploads-read (inline) from arn:aws:iam::1:role/op',
    })
  })

  test('gcp create-custom renders the permission list', () => {
    const p = proposal({
      provider: 'gcp',
      projectId: 'proj-1',
      changes: [
        {
          action: 'create-custom',
          grantLabel: 'Nuphos uploads reader',
          targetServiceAccountEmail: 'op@proj-1.iam.gserviceaccount.com',
          customRoleId: 'nuphos_uploads_reader',
          permissions: ['storage.objects.get', 'storage.objects.list'],
        },
      ],
    })
    const rows = proposalDecisions(p)

    expect(rows[0]).toEqual({
      label: 'Create role',
      value: 'nuphos_uploads_reader — grant to op@proj-1.iam.gserviceaccount.com',
    })
    expect(rows[1]).toEqual({
      label: 'Permissions',
      value: 'storage.objects.get, storage.objects.list',
    })
  })

  test('azure create-custom renders actions and data actions', () => {
    const p = proposal({
      provider: 'azure',
      subscriptionId: 'sub-1',
      changes: [
        {
          action: 'create-custom',
          grantLabel: 'Nuphos storage reader',
          targetClientId: 'client-1',
          customRoleName: 'Nuphos storage reader',
          actions: ['Microsoft.Storage/storageAccounts/read'],
          dataActions: ['Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'],
        },
      ],
    })
    const rows = proposalDecisions(p)

    expect(rows[0]).toEqual({
      label: 'Create role',
      value: 'Nuphos storage reader — grant to app client-1',
    })
    expect(rows[1]).toEqual({ label: 'Actions', value: 'Microsoft.Storage/storageAccounts/read' })
    expect(rows[2]).toEqual({
      label: 'Data actions',
      value: 'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read',
    })
  })

  test('grant/revoke rendering is unchanged', () => {
    const p = proposal({
      provider: 'azure',
      subscriptionId: 'sub-1',
      changes: [
        {
          action: 'grant',
          grantLabel: 'Reader',
          targetClientId: 'client-1',
          roleDefinitionId: 'guid-1',
        },
      ],
    })

    expect(proposalDecisions(p)[0]).toEqual({
      label: 'Grant',
      value: 'Reader [roleDefinitionId guid-1] to app client-1',
    })
  })
})
