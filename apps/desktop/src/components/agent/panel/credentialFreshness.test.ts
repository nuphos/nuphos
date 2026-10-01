import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { debounced, hasUnseenCredentials, unseenCredentials } from './credentialFreshness.ts'

import type { AgentCredentialSelection } from '../../../api'

function selection(partial: Partial<AgentCredentialSelection>): AgentCredentialSelection {
  return {
    awsRoleIds: [],
    gcpServiceAccountIds: [],
    linodeAccountIds: [],
    hetznerAccountIds: [],
    tencentAccountIds: [],
    aliyunAccountIds: [],
    volcengineAccountIds: [],
    huaweiAccountIds: [],
    azureAccountIds: [],
    onpremClusterIds: [],
    betterStackIntegrationIds: [],
    uptimeKumaInstanceIds: [],
    linearWorkspaceIds: [],
    jiraSiteIds: [],
    asanaAccountIds: [],
    sentryAccountIds: [],
    tailscaleClientIds: [],
    zeaburIds: [],
    vantaIntegrationIds: [],
    secureframeIntegrationIds: [],
    resendIntegrationIds: [],
    githubInstallationIds: [],
    gitlabBindingIds: [],
    grafanaInstanceIds: [],
    sonarqubeIntegrationIds: [],
    notionIntegrationIds: [],
    upstashAccountIds: [],
    cloudflareAccountIds: [],
    deviceIds: [],
    ...partial,
  }
}

test('flags only options bound after the selection was last saved', () => {
  const seen = selection({ awsRoleIds: ['r1'] })
  const available = selection({ awsRoleIds: ['r1'], gcpServiceAccountIds: ['sa-new'] })
  const unseen = unseenCredentials(available, seen)

  assert.deepEqual(unseen, selection({ gcpServiceAccountIds: ['sa-new'] }))
  assert.equal(hasUnseenCredentials(unseen), true)
})

test('nothing is new before a baseline exists or once everything was seen', () => {
  const available = selection({ awsRoleIds: ['r1'] })

  assert.equal(unseenCredentials(available, undefined), undefined)
  assert.equal(hasUnseenCredentials(unseenCredentials(available, undefined)), false)
  assert.equal(hasUnseenCredentials(unseenCredentials(available, available)), false)
})

test('a key missing from an older baseline counts as entirely new', () => {
  const seen = { ...selection({}) } as Partial<AgentCredentialSelection>

  delete seen.deviceIds
  const unseen = unseenCredentials(
    selection({ deviceIds: ['d1'] }),
    seen as AgentCredentialSelection,
  )

  assert.deepEqual(unseen?.deviceIds, ['d1'])
})

test('debounced collapses a burst of triggers into one trailing call', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    let calls = 0
    const refresh = debounced(() => {
      calls += 1
    }, 1000)

    refresh.trigger()
    mock.timers.tick(500)
    refresh.trigger()
    mock.timers.tick(999)
    assert.equal(calls, 0)
    mock.timers.tick(1)
    assert.equal(calls, 1)

    refresh.trigger()
    refresh.cancel()
    mock.timers.tick(2000)
    assert.equal(calls, 1)
  } finally {
    mock.timers.reset()
  }
})
