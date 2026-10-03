import assert from 'node:assert/strict'
import { test } from 'node:test'

import { localBackendEnv } from './dev-local-stack-env.ts'
import { managedCleanupArgs } from './dev-managed-cleanup.ts'
import {
  MANAGED_KUBECONFIG,
  MANAGED_NAMESPACE,
  isLocalContextName,
  localKubeconfig,
  managedBackendEnv,
  managedPodHealth,
  orbstackProblem,
} from './dev-managed-env.ts'

function kubeconfig(context: string, server: string, extraContexts: string[] = []) {
  return JSON.stringify({
    kind: 'Config',
    clusters: [{ name: context, cluster: { server } }],
    users: [{ name: context, user: { token: 'x' } }],
    contexts: [context, ...extraContexts].map((name) => ({
      name,
      context: { cluster: context, user: context },
    })),
  })
}

function pod(app: string, status: object) {
  return { metadata: { labels: { app } }, status }
}

test('only local cluster context names are accepted', () => {
  for (const name of ['orbstack', 'docker-desktop', 'minikube', 'kind-nuphos'])
    assert.ok(isLocalContextName(name), name)
  for (const name of [
    'gcp/nuphos/nuphos-prod',
    'gke_nuphos_asia-east1_prod',
    'arn:aws:eks:us-west-1:1:cluster/prod',
    'orbstack-prod',
    'kind-',
    '',
  ])
    assert.equal(isLocalContextName(name), false, name)
})

test('a local context is accepted only while its server is this machine', () => {
  const ok = localKubeconfig('orbstack', kubeconfig('orbstack', 'https://127.0.0.1:26443'))

  assert.ok(ok.ok)
  assert.equal(ok.kubeconfig['current-context'], 'orbstack')
  assert.ok(
    localKubeconfig(
      'docker-desktop',
      kubeconfig('docker-desktop', 'https://kubernetes.docker.internal:6443'),
    ).ok,
  )

  const renamedCloud = localKubeconfig('minikube', kubeconfig('minikube', 'https://34.80.1.2'))

  assert.deepEqual(renamedCloud, {
    ok: false,
    reason: '"minikube" points at https://34.80.1.2, not this machine',
  })
})

test('a cloud context is refused before its kubeconfig is even read', () => {
  const cloud = localKubeconfig(
    'gcp/nuphos/nuphos-prod',
    kubeconfig('gcp/nuphos/nuphos-prod', 'https://127.0.0.1:6443'),
  )

  assert.equal(cloud.ok, false)
})

test('a kubeconfig carrying more than the one context is refused', () => {
  const widened = localKubeconfig(
    'orbstack',
    kubeconfig('orbstack', 'https://127.0.0.1:26443', ['gcp/nuphos/nuphos-prod']),
  )

  assert.equal(widened.ok, false)
  assert.equal(localKubeconfig('orbstack', '').ok, false)
})

test('OrbStack problems name the command that fixes them', () => {
  assert.match(orbstackProblem(null, null)!, /brew install --cask orbstack/)
  assert.match(orbstackProblem('Stopped', null)!, /orbctl start$/)
  assert.match(orbstackProblem('Running\n', 'false\n')!, /orbctl start k8s/)
  assert.equal(orbstackProblem('Running\n', 'true\n'), null)
})

test('managed mode turns the provisioner on against the confined kubeconfig and local namespace', () => {
  const stack = { mongoPort: 1, rustfsPort: 2, runtimePort: 3, s3AccessKey: 'a', s3SecretKey: 'b' }
  const env = { ...localBackendEnv(stack), ...managedBackendEnv('orbstack') }

  assert.equal(env.CLAUDE_CODE_RUNTIME_PROVISIONER_ENABLED, 'true')
  assert.equal(env.CLAUDE_CODE_RUNTIME_KUBECTL, 'true')
  assert.equal(env.CLAUDE_CODE_RUNTIME_KUBE_CONTEXT, 'orbstack')
  assert.equal(env.CLAUDE_CODE_RUNTIME_NAMESPACE, MANAGED_NAMESPACE)
  assert.equal(env.KUBECONFIG, MANAGED_KUBECONFIG)
  assert.equal(env.CLAUDE_CODE_RUNTIME_NODE_SELECTOR, '')
  assert.equal(env.CLAUDE_CODE_RUNTIME_NODE_TOLERATIONS, '')
  assert.equal(env.NUPHOS_LOCAL_STACK, 'true')
})

test('stop scales managed agents to zero, a wipe deletes their namespace', () => {
  const pinned = ['--kubeconfig', MANAGED_KUBECONFIG, '--context', 'orbstack']

  assert.deepEqual(managedCleanupArgs('stop', 'orbstack').slice(0, 4), pinned)
  assert.deepEqual(managedCleanupArgs('stop', 'orbstack').slice(-6), [
    '-n',
    MANAGED_NAMESPACE,
    'scale',
    'deployment',
    '--all',
    '--replicas=0',
  ])
  assert.deepEqual(managedCleanupArgs('down', 'orbstack').slice(0, 4), pinned)
  assert.ok(managedCleanupArgs('down', 'orbstack').includes('delete'))
})

test('the dashboard lists each managed agent pod with its state', () => {
  const health = managedPodHealth(
    JSON.stringify({
      items: [
        pod('openab-claude-0123456789abcdef', {
          phase: 'Running',
          containerStatuses: [{ ready: true, state: { running: {} } }],
        }),
        pod('openab-codex-fedcba9876543210', {
          phase: 'Pending',
          containerStatuses: [{ ready: false, state: { waiting: { reason: 'ImagePullBackOff' } } }],
        }),
        pod('openab-claude-aaaaaaaaaaaaaaaa', { phase: 'Pending' }),
        pod('something-else', { phase: 'Running' }),
      ],
    }),
  )

  assert.deepEqual(health, {
    'claude-0123456': 'ready',
    'codex-fedcba98': 'ImagePullBackOff',
    'claude-aaaaaaa': 'Pending',
  })
  assert.match(managedPodHealth('{"items":[]}').pods!, /Add agent/)
  assert.deepEqual(managedPodHealth('not json'), { pods: 'unreadable kubectl output' })
})
