import { containerSpec, containerStatuses, timeOf } from '../../kube.ts'
import { message } from '../../message.ts'
import { statusField } from '../support.ts'

import { isActiveRestart } from './crash-loop.ts'

import type { Finding, PodContext, Rule } from '../types.ts'

// A run that ended OOMKilled ran out of memory. With a memory limit the
// container hit its own cgroup limit; without one the node ran short and the
// kernel's OOM killer picked it, so the sentences differ.

function outOfMemory({ pod, podName, now }: PodContext): Finding[] {
  const findings: Finding[] = []

  for (const status of containerStatuses(pod)) {
    const current = status.state?.terminated
    const last = status.lastState?.terminated
    const ended =
      current?.reason === 'OOMKilled'
        ? { termination: current, field: 'state.terminated.reason' }
        : last?.reason === 'OOMKilled' && isActiveRestart(status, now)
          ? { termination: last, field: 'lastState.terminated.reason' }
          : null

    if (!ended) continue
    const limit = containerSpec(pod, status.name)?.resources?.limits?.memory
    const variant = limit ? 'limit' : 'noLimit'
    const params = {
      container: status.name,
      restarts: status.restartCount,
      ...(limit ? { limit } : {}),
    }

    findings.push({
      container: status.name,
      cause: message(`diagnosis.outOfMemory.cause.${variant}`, params),
      why: message(`diagnosis.outOfMemory.why.${variant}`, params),
      fix: message(`diagnosis.outOfMemory.fix.${variant}`, params),
      evidence: [statusField(pod, podName, status, ended.field, 'OOMKilled')],
      actions: [{ type: 'previous-logs', pod: podName, container: status.name }],
      at: timeOf(ended.termination.finishedAt),
    })
  }

  return findings
}

export const outOfMemoryRule: Rule = {
  id: 'out-of-memory',
  severity: 'critical',
  fixKind: 'edit-config',
  sources: [
    {
      title: 'Kubernetes: Resource management for pods and containers',
      url: 'https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#memory-units',
    },
    {
      title: 'Kubernetes: Assign memory resources (exceed a container memory limit)',
      url: 'https://kubernetes.io/docs/tasks/configure-pod-container/assign-memory-resource/#exceed-a-container-s-memory-limit',
    },
    {
      title: 'Kubernetes: Node-pressure eviction, node OOM behavior',
      url: 'https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/#node-out-of-memory-behavior',
    },
  ],
  messageKeys: ['cause', 'why', 'fix'].flatMap((part) =>
    ['limit', 'noLimit'].map((variant) => `diagnosis.outOfMemory.${part}.${variant}`),
  ),
  check: outOfMemory,
}
