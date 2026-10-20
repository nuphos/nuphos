import { containerStatuses, timeOf } from '../../kube.ts'
import { message } from '../../message.ts'
import { recent, statusField } from '../support.ts'

import type { ContainerStatus } from '../../kube.ts'
import type { Finding, PodContext, Rule } from '../types.ts'

// A crash loop is read from the restart count and how the previous run ended,
// never from the waiting reason alone: between runs a crash-looping container
// shows `waiting: CrashLoopBackOff` only part of the time. Exit codes 126 and
// 127 are the shell's "not executable" and "command not found"; 128 + n is
// death by signal n, so 137 is SIGKILL and 143 SIGTERM.

const VARIANTS = [
  'exitCode',
  'exitsZero',
  'notExecutable',
  'commandNotFound',
  'killed',
  'terminated',
] as const

type Variant = (typeof VARIANTS)[number]

const BY_CODE: Partial<Record<number, Variant>> = {
  0: 'exitsZero',
  126: 'notExecutable',
  127: 'commandNotFound',
  137: 'killed',
  143: 'terminated',
}

const FIX: Record<Variant, string> = {
  exitCode: 'logs',
  exitsZero: 'exitsZero',
  notExecutable: 'command',
  commandNotFound: 'command',
  killed: 'killed',
  terminated: 'terminated',
}

export function isOomKilled(status: ContainerStatus): boolean {
  return (
    status.state?.terminated?.reason === 'OOMKilled' ||
    status.lastState?.terminated?.reason === 'OOMKilled'
  )
}

/** A container that restarted and whose failure still matters right now. */
export function isActiveRestart(status: ContainerStatus, now: number | null): boolean {
  const last = status.lastState?.terminated

  if (!last || status.restartCount < 1) return false
  const backingOff = status.state?.waiting?.reason === 'CrashLoopBackOff'

  return backingOff || !status.ready || recent(timeOf(last.finishedAt), now)
}

function crashLoop({ pod, podName, now }: PodContext): Finding[] {
  const findings: Finding[] = []

  for (const status of containerStatuses(pod)) {
    const last = status.lastState?.terminated

    if (!last || isOomKilled(status) || !isActiveRestart(status, now)) continue
    const variant = BY_CODE[last.exitCode] ?? 'exitCode'
    const params = {
      container: status.name,
      restarts: status.restartCount,
      exitCode: last.exitCode,
      reason: last.reason ?? '',
    }

    findings.push({
      container: status.name,
      cause: message(`diagnosis.crashLoop.cause.${variant}`, params),
      why: message(
        variant === 'exitsZero'
          ? 'diagnosis.crashLoop.why.exitsZero'
          : 'diagnosis.crashLoop.why.backOff',
        params,
      ),
      fix: message(`diagnosis.crashLoop.fix.${FIX[variant]}`, params),
      evidence: [
        statusField(pod, podName, status, 'lastState.terminated.exitCode', last.exitCode),
        statusField(pod, podName, status, 'restartCount', status.restartCount),
      ],
      actions: [{ type: 'previous-logs', pod: podName, container: status.name }],
      at: timeOf(last.finishedAt),
    })
  }

  return findings
}

export const crashLoopRule: Rule = {
  id: 'crash-loop',
  severity: 'critical',
  fixKind: 'inspect-logs',
  sources: [
    {
      title: 'Kubernetes: Pod lifecycle, container restarts',
      url: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-restarts',
    },
    {
      title: 'Kubernetes: Debug running pods',
      url: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/',
    },
    {
      title: 'Bash manual: exit status',
      url: 'https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html',
    },
  ],
  messageKeys: [
    ...VARIANTS.map((v) => `diagnosis.crashLoop.cause.${v}`),
    'diagnosis.crashLoop.why.backOff',
    'diagnosis.crashLoop.why.exitsZero',
    ...[...new Set(Object.values(FIX))].map((f) => `diagnosis.crashLoop.fix.${f}`),
  ],
  check: crashLoop,
}
