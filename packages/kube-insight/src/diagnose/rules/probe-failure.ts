import { containerSpec, eventContainer, eventCount, eventTime } from '../../kube.ts'
import { message } from '../../message.ts'
import { eventEvidence, eventsFor, recent, truncate } from '../support.ts'

import type { Probe } from '../../kube.ts'
import type { Finding, PodContext, Rule } from '../types.ts'

// The kubelet reports a failing probe as an Unhealthy event, "Liveness probe
// failed: <output>". A probe acts after failureThreshold failures in a row,
// one every periodSeconds (defaults 3 and 10).

const PROBES = ['liveness', 'readiness', 'startup'] as const

type ProbeKind = (typeof PROBES)[number]

const PREFIXES: [string, ProbeKind][] = [
  ['Liveness probe', 'liveness'],
  ['Readiness probe', 'readiness'],
  ['Startup probe', 'startup'],
]

const DEFAULT_PERIOD = 10
const DEFAULT_THRESHOLD = 3

export function probeNote(note: string): { probe: ProbeKind; output: string } | null {
  for (const [prefix, probe] of PREFIXES) {
    if (!note.startsWith(prefix)) continue
    const rest = note.slice(prefix.length)
    const colon = rest.indexOf(':')

    return { probe, output: colon === -1 ? '' : rest.slice(colon + 1).trim() }
  }

  return null
}

function probeSpec(context: PodContext, container: string, probe: ProbeKind): Probe | undefined {
  const spec = containerSpec(context.pod, container)

  if (probe === 'liveness') return spec?.livenessProbe
  if (probe === 'readiness') return spec?.readinessProbe

  return spec?.startupProbe
}

function probeFailure(context: PodContext): Finding[] {
  const { pod, podName, events, now } = context
  const only = pod.spec?.containers.length === 1 ? pod.spec.containers[0].name : null
  const findings: Finding[] = []

  for (const event of eventsFor(events, 'Unhealthy')) {
    const at = eventTime(event)
    const note = probeNote(event.message ?? '')

    if (!note || !recent(at, now)) continue
    const container = eventContainer(event) ?? only ?? ''
    const spec = probeSpec(context, container, note.probe)
    const period = spec?.periodSeconds ?? DEFAULT_PERIOD
    const threshold = spec?.failureThreshold ?? DEFAULT_THRESHOLD
    const params = {
      container,
      count: eventCount(event),
      output: truncate(note.output),
      period,
      threshold,
      total: period * threshold,
    }

    findings.push({
      container: container || null,
      cause: message(`diagnosis.probeFailure.cause.${note.probe}`, params),
      why: message(`diagnosis.probeFailure.why.${note.probe}`, params),
      fix: message(`diagnosis.probeFailure.fix.${note.probe}`, params),
      evidence: [eventEvidence(podName, event)],
      actions:
        note.probe === 'readiness' || !container
          ? []
          : [{ type: 'previous-logs', pod: podName, container }],
      at,
    })
  }

  return findings
}

export const probeFailureRule: Rule = {
  id: 'probe-failure',
  severity: 'warning',
  fixKind: 'edit-config',
  sources: [
    {
      title: 'Kubernetes: Configure liveness, readiness and startup probes',
      url: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#configure-probes',
    },
    {
      title: 'Kubernetes: Container probes',
      url: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes',
    },
  ],
  messageKeys: ['cause', 'why', 'fix'].flatMap((part) =>
    PROBES.map((probe) => `diagnosis.probeFailure.${part}.${probe}`),
  ),
  check: probeFailure,
}
