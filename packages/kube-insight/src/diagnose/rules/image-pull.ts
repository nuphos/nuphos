import { containerStatuses, eventTime } from '../../kube.ts'
import { message } from '../../message.ts'
import { eventEvidence, eventsFor, statusField } from '../support.ts'

import type { Finding, PodContext, Rule } from '../types.ts'

// Why an image cannot be pulled, read from the kubelet's and the runtime's
// words. Registries word their errors differently, so anything unrecognised is
// `unknown` rather than a guess. Docker Hub and GHCR answer alike for a
// missing and a private repository, hence `notFoundOrPrivate`.

const PULL_REASONS = new Set([
  'ErrImagePull',
  'ImagePullBackOff',
  'InvalidImageName',
  'ErrImageNeverPull',
])

const CLASSES = [
  'invalidName',
  'neverPull',
  'rateLimited',
  'notFoundOrPrivate',
  'unauthorized',
  'notFound',
  'unreachable',
  'unknown',
] as const

type PullClass = (typeof CLASSES)[number]

const has = (text: string, needles: string[]) => needles.some((n) => text.includes(n))

export function pullClass(reason: string, raw: string): PullClass {
  const text = raw.toLowerCase()

  if (reason === 'InvalidImageName') return 'invalidName'
  if (reason === 'ErrImageNeverPull') return 'neverPull'
  if (has(text, ['toomanyrequests', '429 too many', 'rate limit'])) return 'rateLimited'
  if (has(text, ['does not exist or may require'])) return 'notFoundOrPrivate'
  if (text.includes('ghcr.io/') && has(text, ['anonymous token', 'denied']))
    return 'notFoundOrPrivate'
  if (
    has(text, [
      'unauthorized',
      'authentication required',
      '403 forbidden',
      'access denied',
      'denied:',
    ])
  )
    return 'unauthorized'
  if (has(text, ['not found', 'manifest unknown', 'name unknown'])) return 'notFound'
  if (
    has(text, [
      'no such host',
      'i/o timeout',
      'connection refused',
      'dial tcp',
      'tls handshake timeout',
    ])
  )
    return 'unreachable'

  return 'unknown'
}

function imagePull({ pod, podName, events }: PodContext): Finding[] {
  const findings: Finding[] = []

  for (const status of containerStatuses(pod)) {
    const waiting = status.state?.waiting
    const reason = waiting?.reason ?? ''

    if (!PULL_REASONS.has(reason)) continue
    const pulls = eventsFor(events, 'Failed', status.name).filter(
      (e) => e.type === 'Warning' && (e.message ?? '').toLowerCase().includes('pull'),
    )
    const text = [...pulls.map((e) => e.message ?? ''), waiting?.message ?? ''].join('\n')
    const variant = pullClass(reason, text)
    const image = status.image ?? pod.spec?.containers.find((c) => c.name === status.name)?.image
    const params = { container: status.name, image: image ?? '' }
    const times = pulls.map(eventTime).filter((t): t is number => t != null)

    findings.push({
      container: status.name,
      cause: message(`diagnosis.imagePull.cause.${variant}`, params),
      why: message('diagnosis.imagePull.why', params),
      fix: message(`diagnosis.imagePull.fix.${variant}`, params),
      evidence: [
        statusField(pod, podName, status, 'state.waiting.reason', reason),
        ...pulls.map((e) => eventEvidence(podName, e)),
      ],
      actions: [],
      at: times.length > 0 ? Math.max(...times) : null,
    })
  }

  return findings
}

export const imagePullRule: Rule = {
  id: 'image-pull',
  severity: 'critical',
  fixKind: 'edit-config',
  sources: [
    {
      title: 'Kubernetes: Images, ImagePullBackOff',
      url: 'https://kubernetes.io/docs/concepts/containers/images/#imagepullbackoff',
    },
    {
      title: 'Kubernetes: Pull an image from a private registry',
      url: 'https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/',
    },
  ],
  messageKeys: [
    ...CLASSES.map((c) => `diagnosis.imagePull.cause.${c}`),
    ...CLASSES.map((c) => `diagnosis.imagePull.fix.${c}`),
    'diagnosis.imagePull.why',
  ],
  check: imagePull,
}
