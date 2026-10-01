import { existsSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, test } from 'bun:test'

import { getBuiltinSkillsDirectory } from '@/lib/agent/skill-store/inject'
import { agentCredentialSelectionSchema } from '@/lib/api/credentials/agent-schemas'
import { emptyConnectorCredentialOptions } from '@/routes/agent/credential-options-connectors'

import {
  CREDENTIAL_LISTERS,
  flattenSelectedCredentials,
  partitionCredentials,
} from './credential-listing'

import type { AgentCredentialOptions } from '@/routes/agent/types'

function emptyOptions(): AgentCredentialOptions {
  return {
    awsRoles: [],
    gcpServiceAccounts: [],
    linodeAccounts: [],
    hetznerAccounts: [],
    tencentAccounts: [],
    aliyunAccounts: [],
    volcengineAccounts: [],
    huaweiAccounts: [],
    azureAccounts: [],
    onpremClusters: [],
    betterStackIntegrations: [],
    uptimeKumaInstances: [],
    linearWorkspaces: [],
    jiraSites: [],
    asanaAccounts: [],
    sentryAccounts: [],
    tailscaleClients: [],
    zeaburProviders: [],
    vantaIntegrations: [],
    secureframeIntegrations: [],
    resendIntegrations: [],
    devices: [],
    ...emptyConnectorCredentialOptions(),
  }
}

const ID = 'id-1'

function oneOfEach(): AgentCredentialOptions {
  const label = 'L'

  return {
    awsRoles: [{ roleId: ID, accountId: '123456789012', accountAlias: null, roleArn: 'arn' }],
    gcpServiceAccounts: [{ serviceAccountId: ID, projectId: 'p', serviceAccountEmail: 'a@b.c' }],
    linodeAccounts: [{ accountId: ID, label }],
    hetznerAccounts: [{ accountId: ID, label }],
    tencentAccounts: [{ accountId: ID, label, roleArn: 'r' }],
    aliyunAccounts: [{ accountId: ID, label, roleArn: 'r' }],
    volcengineAccounts: [{ accountId: ID, label, roleTrn: 'r' }],
    azureAccounts: [{ accountId: ID, label, subscriptionId: 's' }],
    huaweiAccounts: [{ accountId: ID, label, domainId: 'd', idpId: 'i' }],
    onpremClusters: [{ clusterId: ID, label, contextName: 'onprem/L/cluster' }],
    betterStackIntegrations: [
      { integrationId: ID, label, hasUptimeApiToken: true, hasTelemetryApiToken: false },
    ],
    uptimeKumaInstances: [{ instanceId: ID, label, baseUrl: 'https://k', authType: 'token' }],
    linearWorkspaces: [{ workspaceId: ID, label, workspaceName: 'w' }],
    jiraSites: [{ siteId: ID, label, siteUrl: 'https://j' }],
    asanaAccounts: [{ accountId: ID, label, accountEmail: null }],
    sentryAccounts: [{ accountId: ID, label, userEmail: null }],
    tailscaleClients: [{ clientId: ID, label, oauthClientId: 'o' }],
    zeaburProviders: [{ zeaburId: ID, kind: 'team', name: label }],
    vantaIntegrations: [{ integrationId: ID, label, authType: 'oauth' }],
    secureframeIntegrations: [{ integrationId: ID, label, region: 'us' }],
    resendIntegrations: [{ integrationId: ID, label, permission: 'sending_access' }],
    githubInstallations: [{ installationId: ID, accountLogin: 'org', accountType: 'Organization' }],
    gitlabBindings: [{ bindingId: ID, hostUrl: 'https://g', username: 'u' }],
    grafanaInstances: [{ instanceId: ID, name: label, grafanaUrl: 'https://gr' }],
    sonarqubeIntegrations: [{ integrationId: ID, label, baseUrl: 'https://s' }],
    notionIntegrations: [{ integrationId: ID, label, workspaceName: null }],
    upstashAccounts: [{ accountId: ID, label, email: null }],
    posthogIntegrations: [
      {
        integrationId: ID,
        label,
        apiBaseUrl: 'https://us.posthog.com',
        projects: [{ id: 1, name: 'Web' }],
      },
    ],
    cloudflareAccounts: [{ accountId: ID, accountName: label }],
    devices: [{ deviceId: ID, label, platform: 'darwin' }],
  }
}

const VENDED_CLOUDS = [
  'awsRoleIds',
  'gcpServiceAccountIds',
  'linodeAccountIds',
  'hetznerAccountIds',
  'tencentAccountIds',
  'aliyunAccountIds',
  'volcengineAccountIds',
  'azureAccountIds',
  'huaweiAccountIds',
  'cloudflareAccountIds',
  'posthogIntegrationIds',
]

const selectableKeys = [
  ...new Set([
    ...Object.keys(agentCredentialSelectionSchema.shape),
    ...Object.keys(CREDENTIAL_LISTERS),
  ]),
]

describe('list_credentials coverage', () => {
  test('has a lister for every type the selector API accepts', () => {
    expect(Object.keys(CREDENTIAL_LISTERS)).toEqual(
      expect.arrayContaining(Object.keys(agentCredentialSelectionSchema.shape)),
    )
  })

  test.each(selectableKeys)('a selected %s is listed with a way to use it', (key) => {
    const nothingElse = Object.fromEntries(selectableKeys.map((k) => [k, [] as string[]]))
    const entries = flattenSelectedCredentials({ ...nothingElse, [key]: [ID] }, oneOfEach())

    expect(entries).toHaveLength(1)
    expect(entries[0]?.id).toBe(ID)
    expect(Boolean(entries[0]?.credentialPath)).not.toBe(Boolean(entries[0]?.usage))
    if (entries[0]?.hint) expect(entries[0].credentialPath).toBeDefined()
  })

  test.each(VENDED_CLOUDS)('a selected %s account names its skill setup script', (key) => {
    const nothingElse = Object.fromEntries(selectableKeys.map((k) => [k, [] as string[]]))
    const [entry] = flattenSelectedCredentials({ ...nothingElse, [key]: [ID] }, oneOfEach())
    const script = /bash (skills\/[\w-]+\/scripts\/setup-credentials\.sh) \$TEAM /.exec(
      entry?.hint ?? '',
    )?.[1]

    expect(script).toBeDefined()
    expect(existsSync(path.join(getBuiltinSkillsDirectory(), '..', script!))).toBe(true)
  })
})

describe('usage notes', () => {
  test('tell the agent how to use a Huawei account without guessing', () => {
    const [entry] = flattenSelectedCredentials({ huaweiAccountIds: [ID] }, oneOfEach())

    expect(entry).toEqual({
      provider: 'huawei',
      id: ID,
      label: 'L',
      credentialPath: `huawei-accounts/${ID}/credentials`,
      hint: `Use the huawei skill: bash skills/huawei/scripts/setup-credentials.sh $TEAM ${ID} [region] && source ~/.huawei/credentials.env, then call APIs with skills/huawei/scripts/hw-api.py (there is no Huawei CLI); see skills/huawei/SKILL.md.`,
    })
  })

  test('name the PostHog projects and the setup script that loads the key', () => {
    const [entry] = flattenSelectedCredentials({ posthogIntegrationIds: [ID] }, oneOfEach())

    expect(entry).toEqual({
      provider: 'posthog',
      id: ID,
      label: 'L (Web)',
      credentialPath: `posthog-integrations/${ID}/credentials`,
      hint: `Use the posthog skill: bash skills/posthog/scripts/setup-credentials.sh $TEAM ${ID} && source ~/.posthog/nuphos.env; see skills/posthog/SKILL.md.`,
    })
    expect(flattenSelectedCredentials({}, oneOfEach()).map((e) => e.provider)).not.toContain(
      'posthog',
    )
  })

  test('source the exports of scripts that print them', () => {
    const [entry] = flattenSelectedCredentials({ azureAccountIds: [ID] }, oneOfEach())

    expect(entry?.hint).toBe(
      `Use the azure skill: source <(bash skills/azure/scripts/setup-credentials.sh $TEAM ${ID}); see skills/azure/SKILL.md.`,
    )
  })

  test('never embed the user-named cluster context in shell text', () => {
    const options = emptyOptions()
    const contextName = 'onprem/x; rm -rf ~ $(id)/cluster'

    options.onpremClusters = [{ clusterId: 'c1', label: 'x; rm -rf ~ $(id)', contextName }]

    expect(flattenSelectedCredentials({ onpremClusterIds: ['c1'] }, options)).toEqual([
      {
        provider: 'onprem',
        id: 'c1',
        label: 'x; rm -rf ~ $(id)',
        kubeContext: contextName,
        usage:
          'Kubernetes cluster already in ~/.kube/config; select it with the kubeContext value.',
      },
    ])
  })

  test('point skill-backed connectors at their skill', () => {
    const entries = flattenSelectedCredentials(
      {
        githubInstallationIds: [ID],
        gitlabBindingIds: [ID],
        grafanaInstanceIds: [ID],
        sonarqubeIntegrationIds: [ID],
      },
      { ...oneOfEach(), cloudflareAccounts: [], notionIntegrations: [], upstashAccounts: [] },
    )

    expect(entries.map((entry) => [entry.provider, entry.usage])).toEqual([
      ['github', 'No raw value to fetch; use the github skill with this id.'],
      ['gitlab', 'No raw value to fetch; use the gitlab skill with this id.'],
      ['grafana', 'No raw value to fetch; use the grafana skill with this id.'],
      ['sonarqube', 'No raw value to fetch; use the sonarqube skill with this id.'],
    ])
  })
})

describe('flattenSelectedCredentials', () => {
  test('lists a selected local exec device with local_exec usage', () => {
    const options = emptyOptions()

    options.devices = [{ deviceId: 'dev-1', label: 'MacBook', platform: 'darwin' }]

    expect(flattenSelectedCredentials({ deviceIds: ['dev-1'] }, options)).toEqual([
      {
        provider: 'device',
        id: 'dev-1',
        label: 'MacBook (darwin)',
        usage: 'Local machine; run commands on it with the local_exec tool, device=dev-1.',
      },
    ])
  })

  test('surfaces a selected Zeabur provider through its session-scoped vending route', () => {
    const options = emptyOptions()

    options.zeaburProviders = [
      { zeaburId: 'provider-1', kind: 'team', name: 'Production' },
      { zeaburId: 'provider-2', kind: 'user', name: 'Personal' },
    ]

    expect(flattenSelectedCredentials({ zeaburIds: ['provider-1'] }, options)).toEqual([
      {
        provider: 'zeabur',
        id: 'provider-1',
        label: 'Production',
        credentialPath: 'zeabur-providers/provider-1/credentials',
      },
    ])
  })

  test('lists every Cloudflare account when the conversation stores no selection', () => {
    const options = emptyOptions()

    options.cloudflareAccounts = [
      { accountId: 'cf-1', accountName: 'Acme' },
      { accountId: 'cf-2', accountName: '' },
    ]

    expect(flattenSelectedCredentials({}, options)).toEqual([
      {
        provider: 'cloudflare',
        id: 'cf-1',
        label: 'Acme',
        credentialPath: 'cloudflare-accounts/cf-1/credentials',
        hint: 'Use the cloudflare skill: bash skills/cloudflare/scripts/setup-credentials.sh $TEAM cf-1; see skills/cloudflare/SKILL.md.',
      },
      {
        provider: 'cloudflare',
        id: 'cf-2',
        label: 'cf-2',
        credentialPath: 'cloudflare-accounts/cf-2/credentials',
        hint: 'Use the cloudflare skill: bash skills/cloudflare/scripts/setup-credentials.sh $TEAM cf-2; see skills/cloudflare/SKILL.md.',
      },
    ])
  })

  test('narrows Cloudflare to the stored selection once one is present', () => {
    const options = emptyOptions()

    options.cloudflareAccounts = [
      { accountId: 'cf-1', accountName: 'Acme' },
      { accountId: 'cf-2', accountName: 'Other' },
    ]

    expect(flattenSelectedCredentials({ cloudflareAccountIds: ['cf-2'] }, options)).toEqual([
      {
        provider: 'cloudflare',
        id: 'cf-2',
        label: 'Other',
        credentialPath: 'cloudflare-accounts/cf-2/credentials',
        hint: 'Use the cloudflare skill: bash skills/cloudflare/scripts/setup-credentials.sh $TEAM cf-2; see skills/cloudflare/SKILL.md.',
      },
    ])
    expect(flattenSelectedCredentials({ cloudflareAccountIds: [] }, options)).toEqual([])
  })

  test('maps selected non-pilot providers and ignores unavailable ids', () => {
    const options = emptyOptions()

    options.tencentAccounts = [
      { accountId: 'tencent-1', label: 'Tencent prod', roleArn: 'qcs::cam::uin/1:roleName/a' },
    ]
    options.linearWorkspaces = [
      { workspaceId: 'linear-1', label: 'Linear prod', workspaceName: 'Nuphos' },
    ]
    options.resendIntegrations = [
      { integrationId: 'resend-1', label: 'Mail', permission: 'sending_access' },
    ]

    expect(
      flattenSelectedCredentials(
        {
          tencentAccountIds: ['tencent-1'],
          linearWorkspaceIds: ['linear-1'],
          resendIntegrationIds: ['missing', 'resend-1'],
        },
        options,
      ),
    ).toEqual([
      {
        provider: 'tencent',
        id: 'tencent-1',
        label: 'Tencent prod',
        credentialPath: 'tencent-accounts/tencent-1/credentials',
        hint: 'Use the tencent skill: bash skills/tencent/scripts/setup-credentials.sh $TEAM tencent-1 [region]; see skills/tencent/SKILL.md.',
      },
      {
        provider: 'linear',
        id: 'linear-1',
        label: 'Linear prod',
        credentialPath: 'linear-workspaces/linear-1/credentials',
      },
      {
        provider: 'resend',
        id: 'resend-1',
        label: 'Mail',
        credentialPath: 'resend-integrations/resend-1/credentials',
      },
    ])
  })
})

describe('partitionCredentials', () => {
  test('lists usable but unselected credentials with a tick hint and no way to fetch them', () => {
    const options = emptyOptions()

    options.gcpServiceAccounts = [
      { serviceAccountId: 'sa-1', projectId: 'p1', serviceAccountEmail: 'a@p1.iam' },
      { serviceAccountId: 'sa-2', projectId: 'p2', serviceAccountEmail: 'b@p2.iam' },
    ]

    const { selected, unselected } = partitionCredentials(
      { gcpServiceAccountIds: ['sa-1'] },
      options,
    )

    expect(selected.map((entry) => entry.id)).toEqual(['sa-1'])
    expect(unselected).toEqual([
      {
        provider: 'gcp',
        id: 'sa-2',
        label: 'p2 (b@p2.iam)',
        selected: false,
        hint: 'Not enabled for this conversation. Ask the user to tick "p2 (b@p2.iam)" (gcp) in this conversation\'s credential picker, then call list_credentials again.',
      },
    ])
  })

  test('an unset team-wide connector selection leaves nothing unselected', () => {
    const options = emptyOptions()

    options.cloudflareAccounts = [{ accountId: 'cf-1', accountName: 'Acme' }]

    expect(partitionCredentials({}, options).unselected).toEqual([])
    expect(partitionCredentials({ cloudflareAccountIds: [] }, options).unselected).toEqual([
      expect.objectContaining({ provider: 'cloudflare', id: 'cf-1', selected: false }),
    ])
  })
})
