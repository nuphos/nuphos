import assert from 'node:assert/strict'
import test from 'node:test'

import { parseResourceTopology } from './resource-topology.ts'

test('maps Pod configuration, storage, ownership, scheduling, and mount paths', () => {
  const topology = parseResourceTopology(
    `
apiVersion: v1
kind: Pod
metadata:
  name: api-7b9
  namespace: prod
  ownerReferences:
    - kind: ReplicaSet
      name: api-7b9
spec:
  nodeName: node-a
  serviceAccountName: api-runtime
  imagePullSecrets:
    - name: registry-auth
  containers:
    - name: api
      image: example/api:v4
      ports:
        - name: http
          containerPort: 8080
      readinessProbe:
        httpGet: { path: /ready, port: 8080 }
      env:
        - name: DATABASE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: database
              key: password
        - name: FEATURE_MODE
          valueFrom:
            configMapKeyRef:
              name: app-settings
              key: feature-mode
              optional: true
      envFrom:
        - configMapRef:
            name: shared-settings
          prefix: APP_
      volumeMounts:
        - name: config
          mountPath: /etc/app
          readOnly: true
        - name: data
          mountPath: /var/lib/app
  initContainers:
    - name: migrate
      image: example/api:v4
      volumeMounts:
        - name: projected
          mountPath: /run/bootstrap
  volumes:
    - name: config
      configMap:
        name: app-settings
    - name: data
      persistentVolumeClaim:
        claimName: api-data
    - name: projected
      projected:
        sources:
          - secret:
              name: bootstrap-token
          - serviceAccountToken:
              audience: internal
`,
    { kind: 'Pod', namespace: 'prod', name: 'api-7b9' },
  )

  const targetKinds = new Set(topology.relations.map(({ kind, name }) => `${kind}/${name}`))

  assert.ok(targetKinds.has('Node/node-a'))
  assert.ok(targetKinds.has('ReplicaSet/api-7b9'))
  assert.ok(targetKinds.has('ServiceAccount/api-runtime'))
  assert.ok(targetKinds.has('Secret/database'))
  assert.ok(targetKinds.has('Secret/registry-auth'))
  assert.ok(targetKinds.has('ConfigMap/app-settings'))
  assert.ok(targetKinds.has('ConfigMap/shared-settings'))
  assert.ok(targetKinds.has('PersistentVolumeClaim/api-data'))
  assert.ok(targetKinds.has('Secret/bootstrap-token'))

  assert.deepEqual(topology.volumes.find(({ name }) => name === 'config')?.mounts, [
    {
      volumeName: 'config',
      container: 'api',
      path: '/etc/app',
      readOnly: true,
      init: false,
      ephemeral: false,
    },
  ])
  assert.equal(topology.containers[0]?.ports[0], 'http · 8080/TCP')
  assert.deepEqual(topology.containers[0]?.probes, ['Readiness'])
  assert.equal(topology.containers[0]?.envCount, 2)
})

test('shows StatefulSet service and claim templates without inventing a PVC name', () => {
  const topology = parseResourceTopology(
    `
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: prod
spec:
  serviceName: postgres-headless
  template:
    spec:
      containers:
        - name: postgres
          image: postgres:17
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: [ReadWriteOnce]
`,
    { kind: 'StatefulSet', namespace: 'prod', name: 'postgres' },
  )

  assert.ok(
    topology.relations.some(
      ({ kind, name, via }) =>
        kind === 'Service' && name === 'postgres-headless' && via === 'Stable network identity',
    ),
  )
  assert.ok(
    topology.relations.some(({ kind, name }) => kind === 'ServiceAccount' && name === 'default'),
  )
  assert.equal(
    topology.relations.some(({ kind }) => kind === 'PersistentVolumeClaim'),
    false,
  )
  assert.deepEqual(topology.volumes[0]?.sources, [
    { label: 'PVC template', kind: null, name: null, detail: 'one claim per Pod' },
  ])
  assert.equal(topology.volumes[0]?.mounts[0]?.path, '/var/lib/postgresql/data')
})

test('includes ephemeral containers in container and volume topology', () => {
  const topology = parseResourceTopology(
    `kind: Pod
metadata: { namespace: prod }
spec:
  containers: [{ name: app, image: app:v1 }]
  ephemeralContainers:
    - name: debugger
      image: debugger:v1
      volumeMounts: [{ name: data, mountPath: /data }]
  volumes: [{ name: data, emptyDir: {} }]
`,
    { kind: 'Pod', namespace: 'prod', name: 'api' },
  )

  assert.equal(topology.containers[1]?.name, 'debugger')
  assert.equal(topology.containers[1]?.ephemeral, true)
  assert.equal(topology.volumes[0]?.mounts[0]?.ephemeral, true)
})
