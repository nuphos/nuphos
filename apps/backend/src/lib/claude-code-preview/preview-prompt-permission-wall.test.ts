// Break the pre-existing routes/agent constants ↔ run-pump-helpers init-order
// cycle the composer's imports would otherwise trip (same as the sibling
// preview tests).
import '@/routes/agent'

import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useAgentSessionsShared } from '@/lib/test/doubles/agent-sessions-shared'
import { useCredentialOptions } from '@/lib/test/doubles/credential-options'

const TEAM = new ObjectId()
const ACCOUNT = '123456789012'
const ROLE_ID = new ObjectId().toHexString()

useAgentSessionsShared({
  getAgentCredentialAccess: async () => ({ awsRoleIds: [ROLE_ID] }),
})
useCredentialOptions({
  getAgentCredentialOptions: async () => ({
    awsRoles: [{ roleId: ROLE_ID, accountId: ACCOUNT, roleArn: 'arn', alias: null }],
    gcpServiceAccounts: [],
    azureAccounts: [],
  }),
})

const { buildPreviewSystemPrompt } = await import('./preview-prompt')

describe('buildPreviewSystemPrompt permission-wall section', () => {
  test('guides cloud permission repair through the console or a selected local CLI', async () => {
    const prompt = await buildPreviewSystemPrompt({
      userId: 'user-1',
      teamId: TEAM.toHexString(),
      sessionId: 'conv-1',
      locale: 'en',
    })

    expect(prompt).toContain('## Missing cloud permissions (AWS / GCP / Azure)')
    expect(prompt).toContain('local_exec')
    expect(prompt).toContain('cloud console')
    expect(prompt).not.toContain('propose_permission_grant')
  })
})
