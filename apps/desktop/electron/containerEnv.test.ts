import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { containerEnvProjection } from './containerEnv.ts'

// Covers every EnvVar shape the projection models. The cross-path comparison
// against the workload env editor lives in podContainerDetail.test.ts.
//
// The fixture is deliberately shaped like a *Pod* container (spec.containers[]),
// one level shallower than a workload's spec.template.spec.containers[].
const podContainer = {
  name: 'api',
  image: 'ghcr.io/acme/api:1.0.0',
  env: [
    { name: 'LOG_LEVEL', value: 'debug' },
    { name: 'EMPTY', value: '' },
    { name: 'NO_VALUE' },
    {
      name: 'DATABASE_PASSWORD',
      valueFrom: { secretKeyRef: { name: 'db-creds', key: 'password', optional: false } },
    },
    {
      name: 'FEATURE_FLAGS',
      valueFrom: { configMapKeyRef: { name: 'app-config', key: 'flags', optional: true } },
    },
    {
      name: 'POD_NAME',
      valueFrom: { fieldRef: { apiVersion: 'v1', fieldPath: 'metadata.name' } },
    },
    {
      name: 'CPU_LIMIT',
      valueFrom: {
        resourceFieldRef: { containerName: 'api', resource: 'limits.cpu', divisor: '1m' },
      },
    },
    {
      name: 'REGION',
      valueFrom: {
        fileKeyRef: { volumeName: 'env-files', path: 'app.env', key: 'REGION', optional: true },
      },
    },
  ],
  envFrom: [
    { configMapRef: { name: 'shared-config', optional: true }, prefix: 'CFG_' },
    { secretRef: { name: 'shared-secrets' } },
  ],
} as never

describe('pod container env projection', () => {
  const { env, envFrom } = containerEnvProjection(podContainer)
  const byName = new Map(env.map((entry) => [entry.name, entry]))

  it('projects every env entry off spec.containers[] (not just literal values)', () => {
    assert.equal(env.length, 8)
    assert.deepEqual(
      env.map((entry) => entry.source),
      [
        'value',
        'value',
        'value',
        'secretKeyRef',
        'configMapKeyRef',
        'fieldRef',
        'resourceFieldRef',
        'fileKeyRef',
      ],
    )
  })

  it('passes a literal value through, and normalizes a missing one to empty', () => {
    assert.equal(byName.get('LOG_LEVEL')?.value, 'debug')
    assert.equal(byName.get('EMPTY')?.value, '')
    assert.equal(byName.get('NO_VALUE')?.value, '')
  })

  it('describes a secretKeyRef as a reference and never carries a value', () => {
    const entry = byName.get('DATABASE_PASSWORD')

    assert.equal(entry?.source, 'secretKeyRef')
    assert.equal(entry?.refName, 'db-creds')
    assert.equal(entry?.key, 'password')
    assert.equal(entry?.optional, false)
    // The projection must not resolve the Secret — no secret material here.
    assert.equal(entry?.value, null)
  })

  it('describes a configMapKeyRef with its ref name, key and optional flag', () => {
    const entry = byName.get('FEATURE_FLAGS')

    assert.equal(entry?.source, 'configMapKeyRef')
    assert.equal(entry?.refName, 'app-config')
    assert.equal(entry?.key, 'flags')
    assert.equal(entry?.optional, true)
    assert.equal(entry?.value, null)
  })

  it('describes a fieldRef with its apiVersion and fieldPath', () => {
    const entry = byName.get('POD_NAME')

    assert.equal(entry?.source, 'fieldRef')
    assert.equal(entry?.apiVersion, 'v1')
    assert.equal(entry?.fieldPath, 'metadata.name')
  })

  it('describes a resourceFieldRef with its container, resource and divisor', () => {
    const entry = byName.get('CPU_LIMIT')

    assert.equal(entry?.source, 'resourceFieldRef')
    assert.equal(entry?.containerName, 'api')
    assert.equal(entry?.resource, 'limits.cpu')
    assert.equal(entry?.divisor, '1m')
  })

  it('describes a fileKeyRef with its volume, file path and key', () => {
    const entry = byName.get('REGION')

    assert.equal(entry?.source, 'fileKeyRef')
    assert.equal(entry?.volumeName, 'env-files')
    assert.equal(entry?.path, 'app.env')
    assert.equal(entry?.key, 'REGION')
    assert.equal(entry?.optional, true)
    assert.equal(entry?.value, null)
  })

  it('projects envFrom sources with their prefix and optional flag', () => {
    assert.deepEqual(envFrom, [
      { source: 'configMapRef', name: 'shared-config', prefix: 'CFG_', optional: true },
      { source: 'secretRef', name: 'shared-secrets', prefix: null, optional: null },
    ])
  })

  // Every key of V1EnvVarSource in the installed client (configMapKeyRef,
  // fieldRef, fileKeyRef, resourceFieldRef, secretKeyRef) is modelled above, so
  // only a shape newer than the client can reach this branch.
  it('falls back to an "unknown" reference for a valueFrom shape newer than the client', () => {
    const { env: unknownEnv } = containerEnvProjection({
      name: 'api',
      env: [{ name: 'FUTURE', valueFrom: { notYetInvented: { key: 'x' } } }],
    } as never)

    assert.equal(unknownEnv[0].source, 'unknown')
    assert.equal(unknownEnv[0].value, null)
  })

  it('reports empty lists for a container with no env at all', () => {
    assert.deepEqual(containerEnvProjection({ name: 'sidecar' } as never), {
      env: [],
      envFrom: [],
    })
  })
})
