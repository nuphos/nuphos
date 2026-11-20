import { describe, expect, test } from 'bun:test'

import { renderAgentCredentialPrompt } from './agent'

const TEAM_ID = '64b5f1c2e4b0a1d2c3e4f5a6'

const EMPTY_OPTIONS = {
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
} as unknown as Parameters<typeof renderAgentCredentialPrompt>[1]

function promptFor(projectId: string): string {
  return renderAgentCredentialPrompt(
    { gcpServiceAccountIds: ['sa-1'] } as unknown as Parameters<
      typeof renderAgentCredentialPrompt
    >[0],
    {
      ...EMPTY_OPTIONS,
      gcpServiceAccounts: [
        {
          serviceAccountId: 'sa-1',
          projectId,
          serviceAccountEmail: `connector@${projectId}.iam.gserviceaccount.com`,
        },
      ],
    } as unknown as Parameters<typeof renderAgentCredentialPrompt>[1],
    TEAM_ID,
  )
}

describe('GCP credentials in the agent prompt', () => {
  const prompt = promptFor('example-project')
  const line = prompt.split('\n').find((l) => l.startsWith('- projectId=example-project')) ?? ''

  test('names the Compute Engine endpoint, like every other compute provider', () => {
    expect(line).toContain(
      `gceInstancesEndpoint="/teams/${TEAM_ID}/gcp-projects/example-project/gce-instances"`,
    )
  })

  test('names the VPC and firewall endpoints too', () => {
    expect(line).toContain(`vpcsEndpoint="/teams/${TEAM_ID}/gcp-projects/example-project/vpcs"`)
    expect(line).toContain(
      `firewallsEndpoint="/teams/${TEAM_ID}/gcp-projects/example-project/firewalls"`,
    )
  })

  test('still names the cluster endpoint and the setup command', () => {
    expect(line).toContain(
      `clustersEndpoint="/teams/${TEAM_ID}/gcp-projects/example-project/clusters"`,
    )
    expect(line).toContain(
      `setupCommand="bash skills/gcloud/scripts/setup-credentials.sh ${TEAM_ID} example-project sa-1"`,
    )
  })

  test('leaves GUI routes to the route catalog, so each account costs no link tokens', () => {
    expect(line).not.toContain('guiLinks')
    expect(line).not.toContain('guiTemplates')
    expect(prompt).not.toContain('https://nuphos.ai/')
  })
})

describe('On-prem Kubernetes credentials in the agent prompt', () => {
  const clusterId = '507f1f77bcf86cd799439011'
  const prompt = renderAgentCredentialPrompt(
    { onpremClusterIds: [clusterId] } as Parameters<typeof renderAgentCredentialPrompt>[0],
    {
      ...EMPTY_OPTIONS,
      onpremClusters: [
        {
          clusterId,
          label: 'acme-dc1',
          contextName: 'onprem/acme-dc1/cluster',
        },
      ],
    },
    TEAM_ID,
  )

  test('points the agent at the get_kubeconfig context, not an injected KUBECONFIG', () => {
    expect(prompt).toContain('contextName=onprem/acme-dc1/cluster')
    expect(prompt).toContain('a context in the kubeconfig `get_kubeconfig` returns')
    expect(prompt).not.toContain('injected')
    expect(prompt).not.toContain('sync-clusters.sh')
  })

  test('leaves its GUI route to the route catalog', () => {
    expect(prompt).not.toContain('https://nuphos.ai/')
  })
})

describe('Zeabur guidance in the agent prompt', () => {
  test('states the zeabur CLI rule only when a Zeabur provider is attached', () => {
    const none = renderAgentCredentialPrompt(
      { zeaburIds: [] } as unknown as Parameters<typeof renderAgentCredentialPrompt>[0],
      EMPTY_OPTIONS,
      TEAM_ID,
    )
    const attached = renderAgentCredentialPrompt(
      { zeaburIds: ['z-1'] } as unknown as Parameters<typeof renderAgentCredentialPrompt>[0],
      {
        ...EMPTY_OPTIONS,
        zeaburProviders: [{ zeaburId: 'z-1', kind: 'zeabur', name: 'prod' }],
      } as unknown as Parameters<typeof renderAgentCredentialPrompt>[1],
      TEAM_ID,
    )

    expect(none).not.toContain('zeabur CLI')
    expect(attached.match(/zeabur CLI/g)).toHaveLength(2)
    expect(attached).toContain('the only use of the zeabur CLI or Zeabur API')
    expect(attached).toContain('setupCommand="bash skills/zeabur/scripts/setup-credentials.sh')
  })
})
