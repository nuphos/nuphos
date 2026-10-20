import { containerStatuses, eventTime } from '../../kube.ts'
import { message } from '../../message.ts'
import { eventEvidence, eventsFor, recent, statusField } from '../support.ts'

import type { Finding, PodContext, Rule } from '../types.ts'

// CreateContainerConfigError is how the kubelet reports a container whose
// Secret or ConfigMap, or a key in one, is missing; the kubelet writes
// `secret "db" not found` and `couldn't find key PASSWORD in Secret shop/db`.
// A volume from a missing object shows no such reason: the containers wait in
// ContainerCreating and the FailedMount event names what is missing. Only the
// kubelet's words are read; no Secret or ConfigMap is fetched.

type Missing = { kind: 'Secret' | 'ConfigMap'; name: string; key: string | null }

const OBJECT_PREFIXES = [
  ['Secret', 'secret "'],
  ['Secret', 'secrets "'],
  ['ConfigMap', 'configmap "'],
  ['ConfigMap', 'configmaps "'],
] as const

export function missingConfig(text: string): Missing | null {
  const keyMatch = /^couldn't find key (\S+) in (Secret|ConfigMap) (\S+)/.exec(text)

  if (keyMatch) {
    const object = keyMatch[3]

    return {
      kind: keyMatch[2] as Missing['kind'],
      name: object.slice(object.lastIndexOf('/') + 1),
      key: keyMatch[1],
    }
  }
  for (const [kind, prefix] of OBJECT_PREFIXES) {
    if (!text.startsWith(prefix)) continue
    const end = text.indexOf('"', prefix.length)

    if (end > prefix.length) return { kind, name: text.slice(prefix.length, end), key: null }
  }

  return null
}

const MOUNT = /^MountVolume\.SetUp failed for volume "([^"]+)"\s*:\s*(.*)$/s

function fromContainers({ pod, podName }: PodContext): Finding[] {
  return containerStatuses(pod).flatMap((status): Finding[] => {
    const waiting = status.state?.waiting

    if (waiting?.reason !== 'CreateContainerConfigError') return []
    const missing = missingConfig(waiting.message ?? '')
    const variant = missing ? (missing.key ? 'key' : 'object') : 'unknown'
    const params = {
      container: status.name,
      ...(missing ? { object: missing.kind, name: missing.name } : {}),
      ...(missing?.key ? { key: missing.key } : {}),
    }

    return [
      {
        container: status.name,
        cause: message(`diagnosis.configMissing.cause.${variant}`, params),
        why: message('diagnosis.configMissing.why', params),
        fix: message(`diagnosis.configMissing.fix.${variant}`, params),
        evidence: [
          statusField(pod, podName, status, 'state.waiting.reason', 'CreateContainerConfigError'),
          ...(missing
            ? [{ type: 'object' as const, object: { kind: missing.kind, name: missing.name } }]
            : []),
        ],
        actions: [],
        at: null,
      },
    ]
  })
}

function fromMounts(context: PodContext, named: Set<string>): Finding[] {
  const { podName, events, now } = context
  const findings: Finding[] = []
  const seen = new Set<string>()

  for (const event of eventsFor(events, 'FailedMount')) {
    const at = eventTime(event)
    const mount = MOUNT.exec(event.message ?? '')
    const missing = mount ? missingConfig(mount[2]) : null

    if (!mount || !missing || missing.key || !recent(at, now)) continue
    const id = `${missing.kind}/${missing.name}`

    if (named.has(id) || seen.has(id)) continue
    seen.add(id)
    const params = { volume: mount[1], object: missing.kind, name: missing.name, pod: podName }

    findings.push({
      container: null,
      cause: message('diagnosis.configMissing.cause.volume', params),
      why: message('diagnosis.configMissing.why.volume', params),
      fix: message('diagnosis.configMissing.fix.volume', params),
      evidence: [
        eventEvidence(podName, event),
        { type: 'object', object: { kind: missing.kind, name: missing.name } },
      ],
      actions: [],
      at,
    })
  }

  return findings
}

function configMissing(context: PodContext): Finding[] {
  const direct = fromContainers(context)
  const named = new Set(
    direct.flatMap((f) =>
      f.cause.params.name ? [`${f.cause.params.object}/${f.cause.params.name}`] : [],
    ),
  )

  return [...direct, ...fromMounts(context, named)]
}

export const configMissingRule: Rule = {
  id: 'config-missing',
  severity: 'critical',
  fixKind: 'edit-config',
  sources: [
    {
      title: 'Kubernetes: Secrets, using Secrets as environment variables',
      url: 'https://kubernetes.io/docs/concepts/configuration/secret/#using-secrets-as-environment-variables',
    },
    {
      title: 'Kubernetes: ConfigMaps',
      url: 'https://kubernetes.io/docs/concepts/configuration/configmap/',
    },
    {
      title: 'Kubernetes: Configure a pod to use a ConfigMap',
      url: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/',
    },
  ],
  messageKeys: [
    ...['object', 'key', 'unknown', 'volume'].flatMap((v) => [
      `diagnosis.configMissing.cause.${v}`,
      `diagnosis.configMissing.fix.${v}`,
    ]),
    'diagnosis.configMissing.why',
    'diagnosis.configMissing.why.volume',
  ],
  check: configMissing,
}
