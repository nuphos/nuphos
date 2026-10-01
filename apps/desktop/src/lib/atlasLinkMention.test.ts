import assert from 'node:assert/strict'
import test from 'node:test'

import { createServer } from 'vite'

// atlasLinkMention pulls in browser-only modules, so it needs Vite's SSR
// pipeline rather than plain `node --experimental-strip-types`.
const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
})

test.after(async () => {
  await server.close()
})

// A load failure must still close the server, or its watcher keeps the test
// process alive forever.
const { parseAtlasLink } = await server
  .ssrLoadModule('/src/lib/atlasLinkMention.ts')
  .catch(async (err: unknown) => {
    await server.close()
    throw err
  })

const BASE = 'https://nuphos.ai/teams/team-1/k8s'

test('parses canonical Kubernetes cluster links as cluster mentions', () => {
  assert.deepEqual(parseAtlasLink(`${BASE}/aws/account-1/us-east-1/prod/overview`), {
    type: 'cluster',
    teamId: 'team-1',
    provider: 'aws',
    parentId: 'account-1',
    region: 'us-east-1',
    clusterName: 'prod',
  })
})

test('parses canonical Kubernetes resource links as resource mentions', () => {
  assert.deepEqual(
    parseAtlasLink(
      `${BASE}/gcp/project-1/us-central1/prod/workloads/pods/namespaces/default/resources/pod/api?namespace=default`,
    ),
    {
      type: 'k8s-resource',
      teamId: 'team-1',
      provider: 'gcp',
      parentId: 'project-1',
      region: 'us-central1',
      clusterName: 'prod',
      namespace: 'default',
      kind: 'pod',
      name: 'api',
    },
  )
})

test('parses canonical custom resource links with their CRD identity', () => {
  assert.deepEqual(
    parseAtlasLink(
      `${BASE}/aws/account-1/us-east-1/prod/custom-resources/cert-manager.io/v1/Certificate/certificates/namespaced/namespaces/default/resources/customresource/site-certificate`,
    ),
    {
      type: 'k8s-resource',
      teamId: 'team-1',
      provider: 'aws',
      parentId: 'account-1',
      region: 'us-east-1',
      clusterName: 'prod',
      namespace: 'default',
      kind: 'Certificate',
      name: 'site-certificate',
      apiVersion: 'cert-manager.io/v1',
      plural: 'certificates',
      resourceKind: 'Certificate',
    },
  )
})

test('cluster-scoped custom resources ignore the browsing namespace filter', () => {
  assert.deepEqual(
    parseAtlasLink(
      `${BASE}/aws/account-1/us-east-1/prod/custom-resources/cert-manager.io/v1/ClusterIssuer/clusterissuers/cluster-scoped/resources/customresource/letsencrypt?namespace=default`,
    ),
    {
      type: 'k8s-resource',
      teamId: 'team-1',
      provider: 'aws',
      parentId: 'account-1',
      region: 'us-east-1',
      clusterName: 'prod',
      namespace: null,
      kind: 'ClusterIssuer',
      name: 'letsencrypt',
      apiVersion: 'cert-manager.io/v1',
      plural: 'clusterissuers',
      resourceKind: 'ClusterIssuer',
    },
  )
})

test('rejects inherited object keys as Kubernetes providers', () => {
  assert.equal(parseAtlasLink(`${BASE}/toString/account/region/cluster/overview`), null)
})
