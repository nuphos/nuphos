import { describe, expect, test } from 'bun:test'

import { renderAgentCredentialPrompt } from './agent'

const TEAM_ID = '69e989027ab63e8d6a0ffcb6'

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
          serviceAccountEmail: `zeabur-connector@${projectId}.iam.gserviceaccount.com`,
        },
      ],
    } as unknown as Parameters<typeof renderAgentCredentialPrompt>[1],
    TEAM_ID,
  )
}

describe('GCP credentials in the agent prompt', () => {
  const prompt = promptFor('zeabur-dedicated-servers')
  const line =
    prompt.split('\n').find((l) => l.startsWith('- projectId=zeabur-dedicated-servers')) ?? ''

  test('names the Compute Engine endpoint, like every other compute provider', () => {
    expect(line).toContain(
      `gceInstancesEndpoint="/teams/${TEAM_ID}/gcp-projects/zeabur-dedicated-servers/gce-instances"`,
    )
  })

  test('names the VPC and firewall endpoints too', () => {
    expect(line).toContain(
      `vpcsEndpoint="/teams/${TEAM_ID}/gcp-projects/zeabur-dedicated-servers/vpcs"`,
    )
    expect(line).toContain(
      `firewallsEndpoint="/teams/${TEAM_ID}/gcp-projects/zeabur-dedicated-servers/firewalls"`,
    )
  })

  test('still names the cluster endpoint and the setup command', () => {
    expect(line).toContain(
      `clustersEndpoint="/teams/${TEAM_ID}/gcp-projects/zeabur-dedicated-servers/clusters"`,
    )
    expect(line).toContain(
      `setupCommand="bash skills/gcloud/scripts/setup-credentials.sh ${TEAM_ID} zeabur-dedicated-servers sa-1"`,
    )
  })

  test('carries a GUI link for the instance list and an SSH template', () => {
    expect(line).toContain(
      `guiLinks={gceInstances:"https://nuphos.ai/teams/${TEAM_ID}/infra/gcp/zeabur-dedicated-servers/gce-instances"}`,
    )
    expect(line).toContain('gceSsh:"https://nuphos.ai/teams/')
    expect(line).toContain('/gce/<region>/instances/<instanceName>/ssh"')
  })

  test('percent-encodes a project id in the GUI links', () => {
    const encoded =
      promptFor('a b')
        .split('\n')
        .find((l) => l.startsWith('- projectId=a b')) ?? ''

    expect(encoded).toContain('/infra/gcp/a%20b/gce-instances')
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

  test('links to the shared Kubernetes resource UI', () => {
    expect(prompt).toContain(
      `https://nuphos.ai/teams/${TEAM_ID}/k8s/onprem/${clusterId}/onprem/${clusterId}/workloads/pods`,
    )
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
