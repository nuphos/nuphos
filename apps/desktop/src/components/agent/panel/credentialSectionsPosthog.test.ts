import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { posthogStatusLine } from '../../../types/posthog.ts'

import { buildPosthogCredentialSections } from './credentialSectionsB.ts'

describe('PostHog credential sections', () => {
  test('lists each integration with its project names', () => {
    const sections = buildPosthogCredentialSections([
      {
        integrationId: 'a1',
        label: 'Prod analytics',
        apiBaseUrl: 'https://us.posthog.com',
        projects: [
          { id: 1, name: 'Web' },
          { id: 2, name: 'iOS' },
        ],
      },
      {
        integrationId: 'b2',
        label: 'EU analytics',
        apiBaseUrl: 'https://eu.posthog.com',
        projects: [],
      },
    ])

    assert.equal(sections.length, 1)
    assert.equal(sections[0]?.provider, 'posthog')
    assert.deepEqual(sections[0]?.items, [
      { id: 'a1', label: 'Prod analytics', sublabel: 'Web, iOS' },
      { id: 'b2', label: 'EU analytics', sublabel: 'https://eu.posthog.com' },
    ])
  })

  test('renders nothing without integrations', () => {
    assert.deepEqual(buildPosthogCredentialSections([]), [])
  })

  test('summarizes project count and region', () => {
    const base = {
      id: 'x',
      label: 'x',
      apiBaseUrl: 'https://eu.posthog.com',
      userEmail: null,
      requestedScopes: [],
      grantedScopes: [],
      permissions: {},
      missingScopes: [],
      extraScopes: [],
      createdAt: '2026-01-01T00:00:00Z',
    }
    const project = { id: 1, name: 'Web', organizationId: 'o', organizationName: null }

    assert.equal(
      posthogStatusLine({ ...base, region: 'eu', status: 'connected', projects: [project] }),
      '1 project · EU Cloud',
    )
    assert.equal(
      posthogStatusLine({
        ...base,
        region: 'us',
        status: 'connected',
        projects: [project, project],
      }),
      '2 projects · US Cloud',
    )
    assert.equal(
      posthogStatusLine({ ...base, region: 'us', status: 'reconnect_required', projects: [] }),
      'Reconnect required',
    )
  })
})
