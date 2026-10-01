/* eslint-disable max-lines -- Kubernetes volume and reference variants are kept together as one exhaustive projection. */
import yaml from 'js-yaml'

import type { DetailTarget } from './target'

type UnknownRecord = Record<string, unknown>

export type NavigableResourceKind = Extract<
  DetailTarget['kind'],
  | 'ConfigMap'
  | 'Secret'
  | 'PersistentVolumeClaim'
  | 'ServiceAccount'
  | 'Node'
  | 'Service'
  | 'ReplicaSet'
  | 'Deployment'
  | 'StatefulSet'
  | 'DaemonSet'
  | 'Job'
  | 'CronJob'
>

export type ResourceRelationGroup = 'Configuration' | 'Storage' | 'Runtime'

export type ResourceRelation = {
  id: string
  group: ResourceRelationGroup
  kind: NavigableResourceKind
  name: string
  namespace: string | null
  via: string
  detail: string | null
}

export type VolumeMountModel = {
  volumeName: string
  container: string
  path: string
  readOnly: boolean
  init: boolean
  ephemeral: boolean
}

export type VolumeSourceModel = {
  label: string
  kind: NavigableResourceKind | null
  name: string | null
  detail: string | null
}

export type VolumeModel = {
  name: string
  sources: VolumeSourceModel[]
  mounts: VolumeMountModel[]
}

export type ContainerSpecModel = {
  name: string
  image: string
  init: boolean
  ephemeral: boolean
  ports: string[]
  probes: string[]
  envCount: number
  envFromCount: number
  mounts: VolumeMountModel[]
  cpuRequest: string | null
  cpuLimit: string | null
  memoryRequest: string | null
  memoryLimit: string | null
}

export type ResourceTopology = {
  relations: ResourceRelation[]
  volumes: VolumeModel[]
  containers: ContainerSpecModel[]
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordAt(value: unknown, key: string): UnknownRecord {
  if (!isRecord(value)) return {}
  const next = value[key]

  return isRecord(next) ? next : {}
}

function stringAt(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null
  const next = value[key]

  return typeof next === 'string' && next.length > 0 ? next : null
}

function boolAt(value: unknown, key: string): boolean {
  return isRecord(value) && value[key] === true
}

function recordsAt(value: unknown, key: string): UnknownRecord[] {
  if (!isRecord(value) || !Array.isArray(value[key])) return []

  return value[key].filter(isRecord)
}

function podSpecFor(root: UnknownRecord, kind: string): UnknownRecord {
  const spec = recordAt(root, 'spec')

  if (kind === 'Pod') return spec
  if (kind === 'CronJob') {
    return recordAt(recordAt(recordAt(recordAt(spec, 'jobTemplate'), 'spec'), 'template'), 'spec')
  }

  return recordAt(recordAt(spec, 'template'), 'spec')
}

function relationGroup(kind: NavigableResourceKind): ResourceRelationGroup {
  if (kind === 'ConfigMap' || kind === 'Secret') return 'Configuration'
  if (kind === 'PersistentVolumeClaim') return 'Storage'

  return 'Runtime'
}

function isNavigableKind(kind: string): kind is NavigableResourceKind {
  return [
    'ConfigMap',
    'Secret',
    'PersistentVolumeClaim',
    'ServiceAccount',
    'Node',
    'Service',
    'ReplicaSet',
    'Deployment',
    'StatefulSet',
    'DaemonSet',
    'Job',
    'CronJob',
  ].includes(kind)
}

function sourceDetail(optional: unknown, suffix?: string | null) {
  const parts = [suffix, optional === true ? 'optional' : null].filter(Boolean)

  return parts.length > 0 ? parts.join(' · ') : null
}

function parseVolumeSources(volume: UnknownRecord): VolumeSourceModel[] {
  const configMap = recordAt(volume, 'configMap')
  const configMapName = stringAt(configMap, 'name')

  if (configMapName) {
    return [
      {
        label: 'ConfigMap',
        kind: 'ConfigMap',
        name: configMapName,
        detail: sourceDetail(configMap.optional),
      },
    ]
  }

  const secret = recordAt(volume, 'secret')
  const secretName = stringAt(secret, 'secretName')

  if (secretName) {
    return [
      {
        label: 'Secret',
        kind: 'Secret',
        name: secretName,
        detail: sourceDetail(secret.optional),
      },
    ]
  }

  const claim = recordAt(volume, 'persistentVolumeClaim')
  const claimName = stringAt(claim, 'claimName')

  if (claimName) {
    return [
      {
        label: 'PersistentVolumeClaim',
        kind: 'PersistentVolumeClaim',
        name: claimName,
        detail: boolAt(claim, 'readOnly') ? 'read-only' : null,
      },
    ]
  }

  const projected = recordAt(volume, 'projected')
  const projectedSources = recordsAt(projected, 'sources').flatMap(
    (source): VolumeSourceModel[] => {
      const projectedConfigMap = recordAt(source, 'configMap')
      const projectedConfigMapName = stringAt(projectedConfigMap, 'name')

      if (projectedConfigMapName) {
        return [
          {
            label: 'Projected ConfigMap',
            kind: 'ConfigMap' as const,
            name: projectedConfigMapName,
            detail: sourceDetail(projectedConfigMap.optional),
          },
        ]
      }
      const projectedSecret = recordAt(source, 'secret')
      const projectedSecretName = stringAt(projectedSecret, 'name')

      if (projectedSecretName) {
        return [
          {
            label: 'Projected Secret',
            kind: 'Secret' as const,
            name: projectedSecretName,
            detail: sourceDetail(projectedSecret.optional),
          },
        ]
      }
      if (isRecord(source.serviceAccountToken)) {
        return [
          {
            label: 'Service account token',
            kind: null,
            name: null,
            detail: stringAt(source.serviceAccountToken, 'audience'),
          },
        ]
      }
      if (isRecord(source.downwardAPI)) {
        return [{ label: 'Downward API', kind: null, name: null, detail: null }]
      }

      return []
    },
  )

  if (projectedSources.length > 0) return projectedSources

  const emptyDir = recordAt(volume, 'emptyDir')

  if (isRecord(volume.emptyDir)) {
    const medium = stringAt(emptyDir, 'medium')
    const sizeLimit = stringAt(emptyDir, 'sizeLimit')

    return [
      {
        label: medium === 'Memory' ? 'Memory-backed emptyDir' : 'Ephemeral emptyDir',
        kind: null,
        name: null,
        detail: sizeLimit ? `limit ${sizeLimit}` : null,
      },
    ]
  }

  const hostPath = recordAt(volume, 'hostPath')

  if (isRecord(volume.hostPath)) {
    return [
      {
        label: 'Host path',
        kind: null,
        name: null,
        detail: stringAt(hostPath, 'path'),
      },
    ]
  }

  const csi = recordAt(volume, 'csi')

  if (isRecord(volume.csi)) {
    return [
      {
        label: 'CSI',
        kind: null,
        name: null,
        detail: stringAt(csi, 'driver'),
      },
    ]
  }

  const downwardApi = recordAt(volume, 'downwardAPI')

  if (isRecord(volume.downwardAPI)) {
    return [
      {
        label: 'Downward API',
        kind: null,
        name: null,
        detail: recordsAt(downwardApi, 'items').length
          ? `${String(recordsAt(downwardApi, 'items').length)} items`
          : null,
      },
    ]
  }

  const knownLabels: [string, string][] = [
    ['ephemeral', 'Ephemeral volume claim'],
    ['nfs', 'NFS'],
    ['awsElasticBlockStore', 'AWS EBS'],
    ['azureDisk', 'Azure Disk'],
    ['gcePersistentDisk', 'GCE persistent disk'],
    ['cephfs', 'CephFS'],
    ['rbd', 'RBD'],
    ['iscsi', 'iSCSI'],
  ]

  for (const [key, label] of knownLabels) {
    if (isRecord(volume[key])) return [{ label, kind: null, name: null, detail: null }]
  }

  return [{ label: 'Volume', kind: null, name: null, detail: null }]
}

function probeNames(container: UnknownRecord) {
  return [
    ['startupProbe', 'Startup'],
    ['readinessProbe', 'Readiness'],
    ['livenessProbe', 'Liveness'],
  ].flatMap(([key, label]) => (isRecord(container[key]) ? [label] : []))
}

function containerModels(spec: UnknownRecord): ContainerSpecModel[] {
  const all: { value: UnknownRecord; init: boolean; ephemeral: boolean }[] = [
    ...recordsAt(spec, 'containers').map((value) => ({ value, init: false, ephemeral: false })),
    ...recordsAt(spec, 'initContainers').map((value) => ({ value, init: true, ephemeral: false })),
    ...recordsAt(spec, 'ephemeralContainers').map((value) => ({
      value,
      init: false,
      ephemeral: true,
    })),
  ]

  return all.flatMap(({ value: container, init, ephemeral }) => {
    const name = stringAt(container, 'name')

    if (!name) return []
    const resources = recordAt(container, 'resources')
    const requests = recordAt(resources, 'requests')
    const limits = recordAt(resources, 'limits')
    const mounts = recordsAt(container, 'volumeMounts').flatMap((mount) => {
      const volumeName = stringAt(mount, 'name')
      const path = stringAt(mount, 'mountPath')

      if (!volumeName || !path) return []

      return [
        {
          volumeName,
          container: name,
          path,
          readOnly: boolAt(mount, 'readOnly'),
          init,
          ephemeral,
        },
      ]
    })

    for (const device of recordsAt(container, 'volumeDevices')) {
      const volumeName = stringAt(device, 'name')
      const path = stringAt(device, 'devicePath')

      if (!volumeName || !path) continue
      mounts.push({ volumeName, container: name, path, readOnly: false, init, ephemeral })
    }

    return [
      {
        name,
        image: stringAt(container, 'image') ?? '-',
        init,
        ephemeral,
        ports: recordsAt(container, 'ports').flatMap((port) => {
          const value = port.containerPort

          if (typeof value !== 'number') return []
          const portName = stringAt(port, 'name')
          const protocol = stringAt(port, 'protocol') ?? 'TCP'

          const namePrefix = portName ? `${portName} · ` : ''

          return [`${namePrefix}${String(value)}/${protocol}`]
        }),
        probes: probeNames(container),
        envCount: recordsAt(container, 'env').length,
        envFromCount: recordsAt(container, 'envFrom').length,
        mounts,
        cpuRequest: stringAt(requests, 'cpu'),
        cpuLimit: stringAt(limits, 'cpu'),
        memoryRequest: stringAt(requests, 'memory'),
        memoryLimit: stringAt(limits, 'memory'),
      },
    ]
  })
}

export function parseResourceTopology(yamlText: string, target: DetailTarget): ResourceTopology {
  let parsed: unknown

  try {
    parsed = yaml.load(yamlText)
  } catch {
    parsed = null
  }
  const root = isRecord(parsed) ? parsed : {}
  const metadata = recordAt(root, 'metadata')
  const rootSpec = recordAt(root, 'spec')
  const namespace = stringAt(metadata, 'namespace') ?? target.namespace
  const resourceKind = stringAt(root, 'kind') ?? target.kind
  const spec = podSpecFor(root, resourceKind)
  const containers = containerModels(spec)
  const relations: ResourceRelation[] = []

  function addRelation(
    kind: NavigableResourceKind,
    name: string | null,
    via: string,
    detail: string | null = null,
    relationNamespace: string | null = namespace,
  ) {
    if (!name) return
    relations.push({
      id: `${String(relations.length)}\0${kind}\0${relationNamespace ?? ''}\0${name}\0${via}\0${detail ?? ''}`,
      group: relationGroup(kind),
      kind,
      name,
      namespace: kind === 'Node' ? null : relationNamespace,
      via,
      detail,
    })
  }

  const serviceAccount = stringAt(spec, 'serviceAccountName') ?? 'default'

  addRelation('ServiceAccount', serviceAccount, 'Pod identity')
  if (resourceKind === 'Pod')
    addRelation('Node', stringAt(spec, 'nodeName'), 'Scheduled on', null, null)

  for (const owner of recordsAt(metadata, 'ownerReferences')) {
    const kind = stringAt(owner, 'kind')

    if (kind && isNavigableKind(kind)) addRelation(kind, stringAt(owner, 'name'), 'Owned by')
  }

  if (resourceKind === 'StatefulSet') {
    addRelation('Service', stringAt(rootSpec, 'serviceName'), 'Stable network identity')
  }

  for (const imagePullSecret of recordsAt(spec, 'imagePullSecrets')) {
    addRelation('Secret', stringAt(imagePullSecret, 'name'), 'Image pull credential')
  }

  for (const container of [
    ...recordsAt(spec, 'containers').map((value) => ({ value, init: false, ephemeral: false })),
    ...recordsAt(spec, 'initContainers').map((value) => ({ value, init: true, ephemeral: false })),
    ...recordsAt(spec, 'ephemeralContainers').map((value) => ({
      value,
      init: false,
      ephemeral: true,
    })),
  ]) {
    const containerName = stringAt(container.value, 'name') ?? 'container'
    const containerLabel = `${container.init ? 'Init container' : container.ephemeral ? 'Ephemeral container' : 'Container'} ${containerName}`

    for (const env of recordsAt(container.value, 'env')) {
      const envName = stringAt(env, 'name') ?? 'environment variable'
      const valueFrom = recordAt(env, 'valueFrom')
      const configMap = recordAt(valueFrom, 'configMapKeyRef')
      const secret = recordAt(valueFrom, 'secretKeyRef')

      addRelation(
        'ConfigMap',
        stringAt(configMap, 'name'),
        `${containerLabel} · ${envName}`,
        sourceDetail(configMap.optional, stringAt(configMap, 'key')),
      )
      addRelation(
        'Secret',
        stringAt(secret, 'name'),
        `${containerLabel} · ${envName}`,
        sourceDetail(secret.optional, stringAt(secret, 'key')),
      )
    }

    for (const envFrom of recordsAt(container.value, 'envFrom')) {
      const configMap = recordAt(envFrom, 'configMapRef')
      const secret = recordAt(envFrom, 'secretRef')
      const prefix = stringAt(envFrom, 'prefix')

      addRelation(
        'ConfigMap',
        stringAt(configMap, 'name'),
        `${containerLabel} · envFrom`,
        sourceDetail(configMap.optional, prefix ? `prefix ${prefix}` : null),
      )
      addRelation(
        'Secret',
        stringAt(secret, 'name'),
        `${containerLabel} · envFrom`,
        sourceDetail(secret.optional, prefix ? `prefix ${prefix}` : null),
      )
    }
  }

  const allMounts = containers.flatMap((container) => container.mounts)
  const volumes = recordsAt(spec, 'volumes').flatMap((volume) => {
    const name = stringAt(volume, 'name')

    if (!name) return []
    const sources = parseVolumeSources(volume)

    for (const source of sources) {
      if (source.kind && source.name) {
        addRelation(source.kind, source.name, `Volume ${name}`, source.detail)
      }
    }

    return [{ name, sources, mounts: allMounts.filter((mount) => mount.volumeName === name) }]
  })

  // StatefulSet claim templates produce per-Pod PVC names, so showing them as
  // direct links would be misleading. Keep them in the volume map as templates.
  for (const claimTemplate of recordsAt(rootSpec, 'volumeClaimTemplates')) {
    const claimMetadata = recordAt(claimTemplate, 'metadata')
    const name = stringAt(claimMetadata, 'name')

    if (!name || volumes.some((volume) => volume.name === name)) continue
    volumes.push({
      name,
      sources: [
        {
          label: 'PVC template',
          kind: null,
          name: null,
          detail: 'one claim per Pod',
        },
      ],
      mounts: allMounts.filter((mount) => mount.volumeName === name),
    })
  }

  return { relations, volumes, containers }
}
