import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useByosAws } from '@/lib/test/doubles/byos-aws'
import { useByosGcp } from '@/lib/test/doubles/byos-gcp'
import { useByosHandles } from '@/lib/test/doubles/byos-handles'
import { useByosTencent } from '@/lib/test/doubles/byos-tencent'

import type { ClusterResult } from '@/lib/byos/types'
import type { AwsRoleBinding, GcpServiceAccountBinding, TencentAccountBinding } from '@/models'

const eksCalls: string[] = []
const tkeKubeconfigCalls: string[] = []
const state: {
  eksClusters: ClusterResult[]
  gkeClusters: ClusterResult[]
  tkeClusters: ClusterResult[]
} = { eksClusters: [], gkeClusters: [], tkeClusters: [] }

const RELAYED = [
  'apiVersion: v1',
  'clusters:',
  '  - name: tke',
  '    cluster:',
  '      server: https://tke.example.com',
  '      certificate-authority-data: VEtFLUNB',
  'users:',
  '  - name: tke-user',
  '    user:',
  '      client-certificate-data: Q0VSVA==',
  '      client-key-data: S0VZ',
].join('\n')

// Handle kept so the sts-failure case below can swap listEksClusters for one test.
const installAws = useByosAws({
  listEksClusters: async (roleArn: string) => {
    eksCalls.push(roleArn)

    return { clusters: state.eksClusters, errors: [] }
  },
})

useByosGcp({
  listGkeClusters: async () => ({ clusters: state.gkeClusters, errors: [] }),
})
useByosTencent({
  listTkeClusters: async () => ({ clusters: state.tkeClusters, errors: [] }),
  generateTkeKubeconfig: async (_handle: unknown, _region: string, clusterId: string) => {
    tkeKubeconfigCalls.push(clusterId)

    return { kubeconfig: RELAYED, expiresAt: new Date() }
  },
})
useByosHandles({
  tencentHandleFor: async () => ({ secretId: 'id', secretKey: 'key', token: 't', site: 'china' }),
})

const {
  renderAgentKubeconfig,
  collectAgentClusterContexts,
  clearAgentClusterContextCache,
  selectAgentK8sBindings,
  parseRelayedKubeconfig,
  withRelayProxies,
  SKILLS_DIR_PLACEHOLDER,
} = await import('@/lib/byos/agent-kubeconfig')

type AgentK8sBindings = Parameters<typeof collectAgentClusterContexts>[0]['bindings']

function k8sBindings(overrides?: Partial<AgentK8sBindings>): AgentK8sBindings {
  return {
    aws: [],
    gcp: [],
    tencent: [],
    aliyun: [],
    linode: [],
    volcengine: [],
    azure: [],
    onprem: [],
    ...overrides,
  }
}

const TEAM = '69e989027ab63e8d6a0ffcb6'
const USER = '62e6289482f5f9d9408f1a79'

function awsBinding(overrides?: Partial<AwsRoleBinding>): AwsRoleBinding {
  return {
    id: new ObjectId(),
    roleArn: 'arn:aws:iam::123456789012:role/nuphos-connector',
    createdAt: new Date(),
    ...overrides,
  }
}

function gcpBinding(overrides?: Partial<GcpServiceAccountBinding>): GcpServiceAccountBinding {
  return {
    id: new ObjectId(),
    serviceAccountEmail: 'agent@my-project.iam.gserviceaccount.com',
    projectId: 'my-project',
    createdAt: new Date(),
    ...overrides,
  }
}

function tencentBinding(label: string): TencentAccountBinding {
  return {
    id: new ObjectId(),
    label,
    roleArn: 'qcs::cam::uin/123456789:roleName/Nuphos',
    providerId: 'nuphos',
    createdAt: new Date(),
  }
}

function eksCluster(name: string, overrides?: Partial<ClusterResult>): ClusterResult {
  return {
    provider: 'aws',
    name,
    region: 'us-east-1',
    endpoint: `https://${name}.eks.example.com`,
    caBase64: 'Q0EtREFUQQ==',
    ...overrides,
  }
}

beforeEach(() => {
  clearAgentClusterContextCache()
  eksCalls.length = 0
  tkeKubeconfigCalls.length = 0
  state.eksClusters = []
  state.gkeClusters = []
  state.tkeClusters = []
})

describe('renderAgentKubeconfig', () => {
  const contexts = [
    {
      contextName: 'aws/123456789012/prod',
      endpoint: 'https://prod.eks.example.com',
      caBase64: 'Q0EtREFUQQ==',
      execArgs: ['aws', TEAM, '123456789012', 'prod', 'us-east-1'],
    },
    {
      contextName: 'gcp/my-project/staging',
      endpoint: 'https://34.1.2.3',
      caBase64: 'R0NQLUNB',
      execArgs: ['gcp', TEAM, 'my-project', 'staging', 'us-central1'],
    },
  ]

  test('renders one cluster/context/user entry per context with an exec stanza', () => {
    const yaml = renderAgentKubeconfig(contexts)

    expect(yaml).toContain('"aws/123456789012/prod"')
    expect(yaml).toContain('"gcp/my-project/staging"')
    expect(yaml).toContain('server: "https://prod.eks.example.com"')
    expect(yaml).toContain('certificate-authority-data: "Q0EtREFUQQ=="')
    expect(yaml).toContain('apiVersion: client.authentication.k8s.io/v1')
    expect(yaml).toContain('command: bash')
    expect(yaml).toContain(`"${SKILLS_DIR_PLACEHOLDER}/kubectl/scripts/get-credential.sh"`)
    expect(yaml).toContain('interactiveMode: Never')
  })

  test('routes an on-prem cluster through the relay with proxy-url', () => {
    const yaml = renderAgentKubeconfig([
      {
        contextName: 'onprem/acme-dc1/cluster',
        // Only routable inside the customer's network — reaching it at all depends
        // on the proxy-url below.
        endpoint: 'https://10.0.0.1:6443',
        caBase64: 'T05QUkVN',
        relayClusterKey: 'abc123',
        proxyUrl: 'https://nr1_token:x@relay.nuphos.ai:8443',
        user: { token: 'sa-token' },
      },
    ])

    expect(yaml).toContain('server: "https://10.0.0.1:6443"')
    expect(yaml).toContain('proxy-url: "https://nr1_token:x@relay.nuphos.ai:8443"')
  })

  test('omits proxy-url for clusters we can reach directly', () => {
    expect(renderAgentKubeconfig(contexts)).not.toContain('proxy-url')
  })

  test('embeds no token and sets no current-context', () => {
    const yaml = renderAgentKubeconfig(contexts)

    expect(yaml).not.toContain('token')
    expect(yaml).not.toContain('current-context')
  })
})

describe('selectAgentK8sBindings', () => {
  test('keeps only session-selected, allow-listed, non-permission-admin bindings', () => {
    const selectedAws = awsBinding()
    const unselectedAws = awsBinding()
    const breakGlassAws = awsBinding({ purpose: 'permission-admin' })
    const allowListedOut = awsBinding({
      access: { memberAllowList: ['someone-else'], updatedAt: new Date(), updatedBy: USER },
    })
    const selectedGcp = gcpBinding()

    const result = selectAgentK8sBindings({
      bindings: {
        awsRoles: [selectedAws, unselectedAws, breakGlassAws, allowListedOut],
        gcpServiceAccounts: [selectedGcp],
      },
      selected: {
        awsRoleIds: [selectedAws, breakGlassAws, allowListedOut].map((b) => b.id.toHexString()),
        gcpServiceAccountIds: [selectedGcp.id.toHexString()],
      },
      userId: USER,
    })

    expect(result.aws).toEqual([selectedAws])
    expect(result.gcp).toEqual([selectedGcp])
  })

  test('gates every provider, not just AWS and GCP', () => {
    const selected = tencentBinding('prod')
    const unselected = tencentBinding('staging')

    const result = selectAgentK8sBindings({
      bindings: { tencentAccounts: [selected, unselected] },
      selected: { tencentAccountIds: [selected.id.toHexString()] },
      userId: USER,
    })

    expect(result.tencent).toEqual([selected])
  })

  test('tolerates missing binding arrays and a session with no selection', () => {
    const result = selectAgentK8sBindings({ bindings: null, selected: undefined, userId: USER })

    expect(Object.values(result).every((list) => list.length === 0)).toBe(true)
  })
})

describe('collectAgentClusterContexts', () => {
  test('builds sorted contexts across providers and skips clusters missing endpoint or CA', async () => {
    state.eksClusters = [
      eksCluster('prod'),
      eksCluster('no-ca', { caBase64: undefined }),
      eksCluster('no-endpoint', { endpoint: undefined }),
    ]
    state.gkeClusters = [
      {
        provider: 'gcp',
        name: 'staging',
        region: 'us-central1',
        endpoint: '34.1.2.3',
        caBase64: 'R0NQLUNB',
      },
    ]

    const contexts = await collectAgentClusterContexts({
      teamId: TEAM,
      bindings: k8sBindings({ aws: [awsBinding()], gcp: [gcpBinding()] }),
    })

    expect(contexts.map((ctx) => ctx.contextName)).toEqual([
      'aws/123456789012/prod',
      'gcp/my-project/staging',
    ])
    expect(contexts[0]!.execArgs).toEqual(['aws', TEAM, '123456789012', 'prod', 'us-east-1'])
    // GKE endpoints come back as bare IPs; the kubeconfig needs a URL.
    expect(contexts[1]!.endpoint).toBe('https://34.1.2.3')
    expect(contexts[1]!.execArgs).toEqual(['gcp', TEAM, 'my-project', 'staging', 'us-central1'])
  })

  test('enumerates an account once even with multiple roles bound to it', async () => {
    state.eksClusters = [eksCluster('prod')]
    const contexts = await collectAgentClusterContexts({
      teamId: TEAM,
      bindings: k8sBindings({
        aws: [awsBinding(), awsBinding({ roleArn: 'arn:aws:iam::123456789012:role/other-role' })],
      }),
    })

    expect(eksCalls).toHaveLength(1)
    expect(contexts).toHaveLength(1)
  })

  test('caches enumeration per team + binding set', async () => {
    state.eksClusters = [eksCluster('prod')]
    const opts = { teamId: TEAM, bindings: k8sBindings({ aws: [awsBinding()] }) }

    await collectAgentClusterContexts(opts)
    await collectAgentClusterContexts(opts)
    expect(eksCalls).toHaveLength(1)

    clearAgentClusterContextCache()
    await collectAgentClusterContexts(opts)
    expect(eksCalls).toHaveLength(2)
  })

  test('fresh bypasses the cache', async () => {
    state.eksClusters = [eksCluster('prod')]
    const opts = { teamId: TEAM, bindings: k8sBindings({ aws: [awsBinding()] }) }

    await collectAgentClusterContexts(opts)
    await collectAgentClusterContexts({ ...opts, fresh: true })
    expect(eksCalls).toHaveLength(2)
  })

  test('a failing provider is skipped, not fatal', async () => {
    state.gkeClusters = [
      {
        provider: 'gcp',
        name: 'staging',
        region: 'us-central1',
        endpoint: '34.1.2.3',
        caBase64: 'R0NQLUNB',
      },
    ]
    const boom = awsBinding()
    const originalEks = state.eksClusters

    installAws({
      listEksClusters: async () => {
        throw new Error('sts is down')
      },
    })
    try {
      const contexts = await collectAgentClusterContexts({
        teamId: TEAM,
        bindings: k8sBindings({ aws: [boom], gcp: [gcpBinding()] }),
      })

      expect(contexts.map((ctx) => ctx.contextName)).toEqual(['gcp/my-project/staging'])
    } finally {
      state.eksClusters = originalEks
      // The next assertion in this test must not see the fault.
      installAws()
    }
  })
})

describe('a fresh sweep that supersedes an in-flight one', () => {
  type Gate = {
    entered: Promise<void>
    reached: () => void
    answer: Promise<ClusterResult[]>
    answerWith: (clusters: ClusterResult[]) => void
  }

  function gate(): Gate {
    let reached!: () => void
    let answerWith!: (clusters: ClusterResult[]) => void
    const entered = new Promise<void>((resolve) => {
      reached = resolve
    })
    const answer = new Promise<ClusterResult[]>((resolve) => {
      answerWith = resolve
    })

    return { entered, reached, answer, answerWith }
  }

  // Each sweep parks in listEksClusters until its own gate answers, so the
  // interleaving below is fixed by construction rather than by timing.
  function installGatedEks(gates: Gate[]) {
    let call = 0

    installAws({
      listEksClusters: async (roleArn: string) => {
        eksCalls.push(roleArn)
        const current = gates[call++]!

        current.reached()

        return { clusters: await current.answer, errors: [] }
      },
    })
  }

  const names = (contexts: Awaited<ReturnType<typeof collectAgentClusterContexts>>) =>
    contexts.map((ctx) => ctx.contextName)

  // One binding set, so every call below lands on the same cache key.
  let opts: { teamId: string; bindings: AgentK8sBindings }

  beforeEach(() => {
    opts = { teamId: TEAM, bindings: k8sBindings({ aws: [awsBinding()] }) }
  })

  test('the superseded sweep does not overwrite the fresh result in the cache', async () => {
    const [superseded, live] = [gate(), gate()]

    installGatedEks([superseded, live])

    const stale = collectAgentClusterContexts(opts)

    await superseded.entered
    const fresh = collectAgentClusterContexts({ ...opts, fresh: true })

    await live.entered

    live.answerWith([eksCluster('fresh')])
    expect(names(await fresh)).toEqual(['aws/123456789012/fresh'])

    superseded.answerWith([eksCluster('stale')])
    await stale

    expect(names(await collectAgentClusterContexts(opts))).toEqual(['aws/123456789012/fresh'])
    expect(eksCalls).toHaveLength(2)
  })

  test('the superseded sweep does not evict the fresh sweep from the inflight map', async () => {
    const [superseded, live, extra] = [gate(), gate(), gate()]

    // Answered up front: if a third sweep opens at all, it must resolve rather
    // than hang, so the failure reads as a wrong answer instead of a timeout.
    extra.answerWith([eksCluster('third-sweep')])
    installGatedEks([superseded, live, extra])

    const stale = collectAgentClusterContexts(opts)

    await superseded.entered
    const fresh = collectAgentClusterContexts({ ...opts, fresh: true })

    await live.entered

    superseded.answerWith([eksCluster('stale')])
    await stale

    const joiner = collectAgentClusterContexts(opts)

    live.answerWith([eksCluster('fresh')])

    expect(names(await joiner)).toEqual(['aws/123456789012/fresh'])
    expect(names(await fresh)).toEqual(['aws/123456789012/fresh'])
    expect(eksCalls).toHaveLength(2)
  })
})

describe('relayed-credential contexts', () => {
  test('parses endpoint, CA, and the user block', () => {
    const parsed = parseRelayedKubeconfig(RELAYED)

    expect(parsed?.endpoint).toBe('https://tke.example.com')
    expect(parsed?.caBase64).toBe('VEtFLUNB')
    expect(parsed?.user).toEqual({
      'client-certificate-data': 'Q0VSVA==',
      'client-key-data': 'S0VZ',
    })
  })

  test('rejects a kubeconfig whose credential needs an exec binary we do not ship', () => {
    // AAD-integrated AKS relays a kubelogin stanza; a context that cannot
    // authenticate is worse than no context at all.
    const aad = RELAYED.replace(
      '      client-certificate-data: Q0VSVA==\n      client-key-data: S0VZ',
      '      exec:\n        command: kubelogin',
    )

    expect(parseRelayedKubeconfig(aad)).toBeNull()
  })

  test('renders embedded credentials and exec stanzas side by side', () => {
    const yaml = renderAgentKubeconfig([
      {
        contextName: 'aws/123456789012/prod',
        endpoint: 'https://prod.eks.example.com',
        caBase64: 'Q0E=',
        execArgs: ['aws', 'team1', '123456789012', 'prod', 'us-east-1'],
      },
      {
        contextName: 'tencent/acct/cls-123',
        endpoint: 'https://tke.example.com',
        caBase64: 'VEtFLUNB',
        user: { 'client-certificate-data': 'Q0VSVA==' },
      },
    ])

    expect(yaml).toContain('get-credential.sh')
    expect(yaml).toContain('client-certificate-data: Q0VSVA==')
    expect(yaml).not.toContain('current-context')
    // The embedded block must sit under its own user entry, not leak into the
    // exec one. Anchor inside `users:` — the context name also appears in the
    // earlier `clusters:` block, so comparing against its first occurrence
    // would pass no matter where the credential landed.
    const [execUser, embeddedUser] = yaml
      .slice(yaml.indexOf('\nusers:'))
      .split('  - name: ')
      .slice(1)

    expect(execUser).toContain('get-credential.sh')
    expect(execUser).not.toContain('client-certificate-data')
    expect(embeddedUser).toContain('client-certificate-data')
    expect(embeddedUser).not.toContain('get-credential.sh')
  })

  test('enumerates a relayed provider with its credential embedded', async () => {
    state.tkeClusters = [
      { provider: 'tencent', name: 'web', region: 'ap-guangzhou', tencentClusterId: 'cls-aaa' },
    ]

    const contexts = await collectAgentClusterContexts({
      teamId: TEAM,
      bindings: k8sBindings({ tencent: [tencentBinding('Prod Account')] }),
    })

    expect(tkeKubeconfigCalls).toEqual(['cls-aaa'])
    expect(contexts).toHaveLength(1)
    expect(contexts[0]!.contextName).toBe('tencent/prod-account/web')
    expect(contexts[0]!.endpoint).toBe('https://tke.example.com')
    expect(contexts[0]!.user).toEqual({
      'client-certificate-data': 'Q0VSVA==',
      'client-key-data': 'S0VZ',
    })
    // Nothing to renew, so no exec plugin.
    expect(contexts[0]!.execArgs).toBeUndefined()
  })

  test('disambiguates same-named clusters by region instead of dropping one', async () => {
    state.tkeClusters = [
      { provider: 'tencent', name: 'web', region: 'ap-guangzhou', tencentClusterId: 'cls-aaa' },
      { provider: 'tencent', name: 'web', region: 'ap-shanghai', tencentClusterId: 'cls-bbb' },
    ]

    const contexts = await collectAgentClusterContexts({
      teamId: TEAM,
      bindings: k8sBindings({ tencent: [tencentBinding('prod')] }),
    })

    expect(contexts.map((ctx) => ctx.contextName)).toEqual([
      'tencent/prod/web',
      'tencent/prod/web@ap-shanghai',
    ])
  })

  test('falls back to the binding id when two accounts share a label', async () => {
    const first = tencentBinding('prod')
    const second = tencentBinding('prod')

    state.tkeClusters = [
      { provider: 'tencent', name: 'web', region: 'ap-guangzhou', tencentClusterId: 'cls-aaa' },
    ]

    const contexts = await collectAgentClusterContexts({
      teamId: TEAM,
      bindings: k8sBindings({ tencent: [first, second] }),
    })

    expect(contexts.map((ctx) => ctx.contextName).sort((a, b) => a.localeCompare(b))).toEqual([
      `tencent/${first.id.toHexString()}/web`,
      `tencent/${second.id.toHexString()}/web`,
    ])
  })
})

describe('withRelayProxies', () => {
  const direct = { contextName: 'aws/1/prod', endpoint: 'https://eks.example', caBase64: 'Q0E=' }
  const relayed = {
    contextName: 'onprem/acme-dc1/cluster',
    endpoint: 'https://10.0.0.1:6443',
    caBase64: 'Q0E=',
    relayClusterKey: 'cluster-key',
  }

  test('stamps a per-session proxy on relayed contexts and leaves direct ones alone', () => {
    const [stamped, untouched] = withRelayProxies([relayed, direct], 'session-1')

    // Asserted by shape, not by host: a local .env can point the dev backend at
    // a different relay, and the contract is the credential, not the address.
    expect(stamped!.proxyUrl).toMatch(/^https?:\/\/nr1_[\w.-]+:x@/)
    expect(untouched!.proxyUrl).toBeUndefined()

    // Two sessions must never share a token, which is the whole reason this
    // runs outside the team-level enumeration cache.
    const [other] = withRelayProxies([relayed], 'session-2')

    expect(other!.proxyUrl).not.toBe(stamped!.proxyUrl)
  })
})

describe('on-prem clusters in an agent session', () => {
  test('a cluster whose stored kubeconfig cannot be decrypted is skipped, not fatal', async () => {
    // A healthy cluster alongside it: one unreadable on-prem binding must not
    // cost the session everything else it could reach.
    state.eksClusters = [eksCluster('prod')]
    const contexts = await collectAgentClusterContexts({
      teamId: TEAM,
      bindings: k8sBindings({
        onprem: [
          {
            id: new ObjectId(),
            label: 'acme-dc1',
            clusterKey: 'cluster-key',
            endpoint: 'https://10.0.0.1:6443',
            // Sealed with a key this backend does not have: decryption throws,
            // and one unreadable cluster must not cost the session the others.
            encryptedKubeconfig: {
              v: 1,
              alg: 'A256GCM',
              keyId: 'some-other-key',
              iv: 'AAAAAAAAAAAAAAAA',
              authTag: 'AAAAAAAAAAAAAAAAAAAAAA==',
              ciphertext: 'AAAA',
            },
            createdAt: new Date(),
            tokenIssuedAt: new Date(),
          },
        ] as never,
        aws: [awsBinding()],
      }),
    })

    expect(contexts.map((ctx) => ctx.contextName)).not.toContain('onprem/acme-dc1/cluster')
    expect(contexts.some((ctx) => ctx.contextName.startsWith('aws/'))).toBe(true)
  })

  test('a cluster with no credential yet never reaches a session', async () => {
    const contexts = await collectAgentClusterContexts({
      teamId: TEAM,
      bindings: k8sBindings({
        onprem: [
          {
            id: new ObjectId(),
            label: 'acme-dc2',
            clusterKey: 'cluster-key-2',
            createdAt: new Date(),
            tokenIssuedAt: new Date(),
          },
        ] as never,
      }),
    })

    expect(contexts).toEqual([])
  })
})
