import { afterEach, describe, expect, it } from 'bun:test'

import { readOnpremAccess, summarizeRules } from '@/lib/byos/onprem-access'

const KUBECONFIG = `apiVersion: v1
kind: Config
clusters:
  - name: onprem
    cluster:
      server: https://10.0.0.1:6443
      certificate-authority-data: ${Buffer.from('-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----').toString('base64')}
users:
  - name: nuphos
    user:
      token: sa-token
`

type Handler = (url: string, init: RequestInit & { proxy?: string }) => Response
const realFetch = globalThis.fetch

function stubFetch(handler: Handler): {
  calls: { url: string; proxy?: string; auth?: string }[]
} {
  const calls: { url: string; proxy?: string; auth?: string }[] = []

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit & { proxy?: string },
  ) => {
    const url = input instanceof Request ? input.url : String(input)

    calls.push({
      url,
      proxy: init?.proxy,
      auth: new Headers(init?.headers).get('authorization') ?? undefined,
    })

    return handler(url, init ?? {})
  }) as typeof fetch

  return { calls }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('summarizeRules', () => {
  it('groups resources by verb set and flags anything beyond reading', () => {
    const { summary, canWrite } = summarizeRules([
      { verbs: ['get', 'list', 'watch'], resources: ['pods', 'services'] },
      { verbs: ['list', 'watch', 'get'], resources: ['configmaps'] },
    ])

    expect(summary).toEqual(['get, list, watch on configmaps, pods, services'])
    expect(canWrite).toBe(false)
  })

  it('treats a wildcard verb as write', () => {
    expect(summarizeRules([{ verbs: ['*'], resources: ['pods'] }]).canWrite).toBe(true)
    expect(summarizeRules([{ verbs: ['get', 'delete'], resources: ['pods'] }]).canWrite).toBe(true)
  })

  it('does not treat official Kubernetes self-review creation as write access', () => {
    const { summary, canWrite } = summarizeRules([
      {
        apiGroups: ['authorization.k8s.io'],
        verbs: ['create'],
        resources: ['selfsubjectaccessreviews', 'selfsubjectrulesreviews'],
      },
      {
        apiGroups: ['authentication.k8s.io'],
        verbs: ['create'],
        resources: ['selfsubjectreviews'],
      },
    ])

    expect(canWrite).toBe(false)
    expect(summary).toEqual([
      'create on selfsubjectaccessreviews, selfsubjectreviews, selfsubjectrulesreviews',
    ])
  })

  it('only exempts self-review creation in the matching official API group', () => {
    expect(
      summarizeRules([
        {
          apiGroups: ['example.com'],
          verbs: ['create'],
          resources: ['selfsubjectaccessreviews'],
        },
      ]).canWrite,
    ).toBe(true)
    expect(
      summarizeRules([
        {
          apiGroups: ['authorization.k8s.io'],
          verbs: ['create'],
          resources: ['selfsubjectaccessreviews', 'deployments'],
        },
      ]).canWrite,
    ).toBe(true)
  })

  it('drops rules that name no resource, which would render as an empty line', () => {
    expect(
      summarizeRules([
        { verbs: ['get'], resources: [] },
        { verbs: [], resources: ['pods'] },
      ]).summary,
    ).toEqual([])
  })
})

describe('readOnpremAccess', () => {
  it('reports identity, permissions and namespaces, all through the relay proxy', async () => {
    const { calls } = stubFetch((url) => {
      if (url.endsWith('/version')) return json({ gitVersion: 'v1.31.2' })
      if (url.includes('selfsubjectreviews')) {
        return json({
          status: {
            userInfo: { username: 'system:serviceaccount:nuphos-relay:nuphos', groups: ['view'] },
          },
        })
      }
      if (url.includes('selfsubjectrulesreviews')) {
        return json({
          status: {
            resourceRules: [
              { verbs: ['get', 'list', 'watch'], resources: ['pods'] },
              {
                apiGroups: ['authorization.k8s.io'],
                verbs: ['create'],
                resources: ['selfsubjectaccessreviews', 'selfsubjectrulesreviews'],
              },
              {
                apiGroups: ['authentication.k8s.io'],
                verbs: ['create'],
                resources: ['selfsubjectreviews'],
              },
            ],
          },
        })
      }
      if (url.includes('/api/v1/namespaces')) {
        return json({ items: [{ metadata: { name: 'default' } }, { metadata: { name: 'data' } }] })
      }

      return json({}, 404)
    })

    const readout = await readOnpremAccess({
      kubeconfig: KUBECONFIG,
      proxyUrl: 'https://nr1_token:x@relay.nuphos.ai:8443',
      teamId: 'team-1',
    })

    expect(readout.reachable).toBe(true)
    expect(readout.serverVersion).toBe('v1.31.2')
    expect(readout.identity?.username).toBe('system:serviceaccount:nuphos-relay:nuphos')
    expect(readout.permissions).toMatchObject({ canWrite: false, namespace: 'default' })
    expect(readout.namespaces).toMatchObject({ denied: false, count: 2 })

    // Every call is tunnelled and carries the kubeconfig credential; none of them
    // reach the API server address directly.
    expect(calls).toHaveLength(4)
    for (const call of calls) {
      expect(call.proxy).toBe('https://nr1_token:x@relay.nuphos.ai:8443')
      expect(call.auth).toBe('Bearer sa-token')
      expect(call.url.startsWith('https://10.0.0.1:6443')).toBe(true)
    }
  })

  it('still answers when the cluster is too old for SelfSubjectReview', async () => {
    stubFetch((url) => {
      if (url.endsWith('/version')) return json({ gitVersion: 'v1.24.0' })
      if (url.includes('selfsubjectreviews')) return json({ message: 'not found' }, 404)
      if (url.includes('selfsubjectrulesreviews')) {
        return json({ status: { resourceRules: [{ verbs: ['*'], resources: ['*'] }] } })
      }

      return json({ message: 'forbidden' }, 403)
    })

    const readout = await readOnpremAccess({
      kubeconfig: KUBECONFIG,
      proxyUrl: 'https://t:x@relay:8443',
      teamId: 't',
    })

    expect(readout.reachable).toBe(true)
    expect(readout.identity).toBeUndefined()
    expect(readout.permissions?.canWrite).toBe(true)
    expect(readout.namespaces).toEqual({ denied: true })
  })

  it('will not call a partial evaluation read-only', async () => {
    stubFetch((url) => {
      if (url.endsWith('/version')) return json({ gitVersion: 'v1.31.2' })
      if (url.includes('selfsubjectrulesreviews')) {
        // A webhook authorizer that could not be consulted: the rules that came
        // back are real, but the ones missing could include write access.
        return json({
          status: {
            resourceRules: [{ verbs: ['get', 'list'], resources: ['pods'] }],
            incomplete: true,
            evaluationError: 'webhook authorizer did not respond',
          },
        })
      }

      return json({}, 404)
    })

    const readout = await readOnpremAccess({
      kubeconfig: KUBECONFIG,
      proxyUrl: 'https://t:x@relay:8443',
      teamId: 't',
    })

    expect(readout.permissions?.canWrite).toBeNull()
    expect(readout.permissions?.incompleteReason).toContain('webhook authorizer')
    expect(readout.permissions?.summary).toEqual(['get, list on pods'])
  })

  it('still reports write access from a partial evaluation, which a grant does prove', async () => {
    stubFetch((url) => {
      if (url.endsWith('/version')) return json({ gitVersion: 'v1.31.2' })
      if (url.includes('selfsubjectrulesreviews')) {
        return json({
          status: { resourceRules: [{ verbs: ['create'], resources: ['pods'] }], incomplete: true },
        })
      }

      return json({}, 404)
    })

    const readout = await readOnpremAccess({
      kubeconfig: KUBECONFIG,
      proxyUrl: 'https://t:x@relay:8443',
      teamId: 't',
    })

    expect(readout.permissions?.canWrite).toBe(true)
  })

  it('translates a disconnected agent into something an operator can act on', async () => {
    stubFetch(() => {
      throw new Error('fetch failed: proxy returned 503')
    })
    const readout = await readOnpremAccess({
      kubeconfig: KUBECONFIG,
      proxyUrl: 'https://t:x@relay:8443',
      teamId: 't',
    })

    expect(readout.reachable).toBe(false)
    expect(readout.unreachableReason).toContain('relay agent in the cluster is not connected')
  })

  it('does not claim reachability when the credential is refused', async () => {
    stubFetch(() => json({ message: 'Unauthorized' }, 401))
    const readout = await readOnpremAccess({
      kubeconfig: KUBECONFIG,
      proxyUrl: 'https://t:x@relay:8443',
      teamId: 't',
    })

    expect(readout.reachable).toBe(false)
    expect(readout.unreachableReason).toContain('401')
  })

  it('refuses a stored kubeconfig that no longer parses', async () => {
    const readout = await readOnpremAccess({
      kubeconfig: 'not: [a',
      proxyUrl: 'https://t:x@relay:8443',
      teamId: 't',
    })

    expect(readout.reachable).toBe(false)
    expect(readout.unreachableReason).toContain('Re-enrol')
  })
})
