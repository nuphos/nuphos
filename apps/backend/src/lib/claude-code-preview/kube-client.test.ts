import { describe, expect, test } from 'bun:test'

import { createKubeClient } from './kube-client'

import type { KubeObject } from './runtime-objects'

const secret: KubeObject = {
  apiVersion: 'v1',
  kind: 'Secret',
  metadata: { name: 'openab-runtime-test', namespace: 'openab-runtimes' },
  stringData: { OPENAB_ACP_AUTH_KEY: 'test-key' },
}

describe('KubeClient.createIfAbsent', () => {
  test('posts to the resource collection and reports a successful create', async () => {
    let request: { url: string; init?: RequestInit } | undefined
    const kube = createKubeClient({
      baseUrl: 'https://kube.example',
      token: 'service-account-token',
      fetchImpl: (url, init) => {
        request = { url, init }

        return Promise.resolve(new Response('{}', { status: 201 }))
      },
    })

    expect(await kube.createIfAbsent(secret)).toBe(true)
    expect(request?.url).toBe('https://kube.example/api/v1/namespaces/openab-runtimes/secrets')
    expect(request?.init?.method).toBe('POST')
  })

  test('reports a concurrent winner on Kubernetes conflict', async () => {
    const kube = createKubeClient({
      baseUrl: 'https://kube.example',
      token: 'service-account-token',
      fetchImpl: () => Promise.resolve(new Response('{}', { status: 409 })),
    })

    expect(await kube.createIfAbsent(secret)).toBe(false)
  })
})

test('PV reads are cluster scoped and deletion carries UID fencing and foreground propagation', async () => {
  const requests: { url: string; init?: RequestInit }[] = []
  const kube = createKubeClient({
    baseUrl: 'https://kube.example',
    token: 'fixture',
    fetchImpl: async (url, init) => {
      requests.push({ url, init })

      return new Response(JSON.stringify({ metadata: { uid: 'volume-uid' } }))
    },
  })

  await kube.getResource!({
    apiVersion: 'v1',
    kind: 'PersistentVolume',
    metadata: { namespace: '', name: 'disk' },
  })
  await kube.delete(
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { namespace: 'runtimes', name: 'agent' },
    },
    'deployment-uid',
  )
  expect(requests[0]?.url).toBe('https://kube.example/api/v1/persistentvolumes/disk')
  expect(JSON.parse(requests[1]?.init?.body as string)).toEqual({
    propagationPolicy: 'Foreground',
    preconditions: { uid: 'deployment-uid' },
  })
})
