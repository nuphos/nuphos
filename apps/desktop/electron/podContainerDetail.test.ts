import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { deploymentEnvContainer } from './containerEnv.ts'
import { podContainerDetail, podContainerDetails } from './podContainerDetail.ts'

// getPodDetail hands its whole spec/status to podContainerDetails, so these
// assertions cover the projection the Pod overview actually draws — for
// spec.containers[] and spec.initContainers[] alike.
const appContainer = {
  name: 'api',
  image: 'ghcr.io/acme/api:1.0.0',
  resources: {
    requests: { cpu: '100m', memory: '128Mi' },
    limits: { cpu: '500m', memory: '512Mi' },
  },
  env: [
    { name: 'LOG_LEVEL', value: 'debug' },
    {
      name: 'DATABASE_PASSWORD',
      valueFrom: { secretKeyRef: { name: 'db-creds', key: 'password', optional: false } },
    },
  ],
  envFrom: [{ configMapRef: { name: 'shared-config', optional: true }, prefix: 'CFG_' }],
} as never

const migrationContainer = {
  name: 'migrate',
  image: 'ghcr.io/acme/migrate:1.0.0',
  env: [
    { name: 'MIGRATION_TOKEN', valueFrom: { secretKeyRef: { name: 'db-creds', key: 'token' } } },
  ],
  envFrom: [{ secretRef: { name: 'migration-secrets' } }],
} as never

const runningStatus = {
  name: 'api',
  image: 'ghcr.io/acme/api:1.0.0',
  ready: true,
  started: true,
  restartCount: 2,
  state: { running: { startedAt: '2026-01-01T00:00:00Z' } },
  lastState: { terminated: { reason: 'OOMKilled', finishedAt: '2026-01-01T00:00:00Z' } },
} as never

const completedStatus = {
  name: 'migrate',
  image: 'ghcr.io/acme/migrate:1.0.0',
  ready: false,
  started: false,
  restartCount: 0,
  state: { terminated: { reason: 'Completed', exitCode: 0 } },
} as never

describe('pod container details', () => {
  const { containers, init_containers } = podContainerDetails(
    { containers: [appContainer], initContainers: [migrationContainer] } as never,
    { containerStatuses: [runningStatus], initContainerStatuses: [completedStatus] } as never,
  )

  it('gives every container its env and envFrom', () => {
    assert.deepEqual(
      containers.map((c) => c.env.map((entry) => entry.name)),
      [['LOG_LEVEL', 'DATABASE_PASSWORD']],
    )
    assert.deepEqual(
      containers.map((c) => c.envFrom.map((entry) => entry.name)),
      [['shared-config']],
    )
  })

  it('gives every init container its env and envFrom', () => {
    assert.deepEqual(
      init_containers.map((c) => c.env.map((entry) => entry.name)),
      [['MIGRATION_TOKEN']],
    )
    assert.deepEqual(
      init_containers.map((c) => c.envFrom.map((entry) => entry.name)),
      [['migration-secrets']],
    )
    assert.deepEqual(
      init_containers.map((c) => c.is_init),
      [true],
    )
  })

  it('matches each container with its own status', () => {
    assert.equal(containers[0].status, 'Running')
    assert.equal(containers[0].restarts, 2)
    assert.equal(init_containers[0].status, 'Completed')
  })

  it('tolerates a Pod with no containers and no status', () => {
    assert.deepEqual(podContainerDetails({} as never, {} as never), {
      containers: [],
      init_containers: [],
      ephemeral_containers: [],
    })
  })

  it('keeps ephemeral containers distinct from app and init containers', () => {
    const detail = podContainerDetails(
      {
        containers: [appContainer],
        ephemeralContainers: [{ name: 'debugger', image: 'debugger:v1' }],
      } as never,
      {
        ephemeralContainerStatuses: [
          { name: 'debugger', ready: false, restartCount: 0, state: { running: {} } },
        ],
      } as never,
    )

    assert.equal(detail.ephemeral_containers[0]?.name, 'debugger')
    assert.equal(detail.ephemeral_containers[0]?.is_ephemeral, true)
    assert.equal(detail.ephemeral_containers[0]?.is_init, false)
  })
})

describe('pod container detail', () => {
  it('carries env and envFrom for a spec.containers[] entry', () => {
    const detail = podContainerDetail(appContainer, runningStatus, false)

    assert.deepEqual(
      detail.env.map((entry) => [entry.name, entry.source]),
      [
        ['LOG_LEVEL', 'value'],
        ['DATABASE_PASSWORD', 'secretKeyRef'],
      ],
    )
    assert.equal(detail.env[0].value, 'debug')
    assert.equal(detail.env[1].refName, 'db-creds')
    // A Secret reference is described, never resolved.
    assert.equal(detail.env[1].value, null)
    assert.deepEqual(detail.envFrom, [
      { source: 'configMapRef', name: 'shared-config', prefix: 'CFG_', optional: true },
    ])
    assert.equal(detail.is_init, false)
  })

  it('carries env and envFrom for a spec.initContainers[] entry', () => {
    const detail = podContainerDetail(migrationContainer, completedStatus, true)

    assert.deepEqual(
      detail.env.map((entry) => [entry.name, entry.source]),
      [['MIGRATION_TOKEN', 'secretKeyRef']],
    )
    assert.equal(detail.env[0].key, 'token')
    assert.deepEqual(detail.envFrom, [
      { source: 'secretRef', name: 'migration-secrets', prefix: null, optional: null },
    ])
    assert.equal(detail.is_init, true)
  })

  it('reports empty env lists rather than omitting them', () => {
    const detail = podContainerDetail({ name: 'sidecar' } as never, undefined, false)

    assert.deepEqual(detail.env, [])
    assert.deepEqual(detail.envFrom, [])
  })

  it('describes container status, restarts and resources', () => {
    const detail = podContainerDetail(appContainer, runningStatus, false)

    assert.equal(detail.status, 'Running')
    assert.equal(detail.ready, true)
    assert.equal(detail.started, true)
    assert.equal(detail.restarts, 2)
    assert.equal(detail.restart_reason, 'OOMKilled')
    assert.equal(detail.last_restart, '2026-01-01T00:00:00.000Z')
    assert.equal(detail.cpu_request, '100m')
    assert.equal(detail.cpu_limit, '500m')
    assert.equal(detail.memory_request, '128Mi')
    assert.equal(detail.memory_limit, '512Mi')
  })

  it('reports a finished init container as Completed, and a pending one as Pending', () => {
    assert.equal(podContainerDetail(migrationContainer, completedStatus, true).status, 'Completed')
    assert.equal(
      podContainerDetail(
        migrationContainer,
        { name: 'migrate', state: { terminated: { reason: 'Error', exitCode: 1 } } } as never,
        true,
      ).status,
      'Error',
    )
    assert.equal(podContainerDetail(migrationContainer, undefined, true).status, 'Pending')
  })

  // Cross-path: the read-only Pod table (this module) and the workload env
  // editor (getDeploymentEnv) must describe the same container identically.
  it('matches what the workload env editor produces for the same container', () => {
    const podSide = podContainerDetail(appContainer, runningStatus, false)
    const workloadSide = deploymentEnvContainer('containers', appContainer)

    assert.deepEqual(podSide.env, workloadSide.env)
    assert.deepEqual(podSide.envFrom, workloadSide.envFrom)
  })
})
