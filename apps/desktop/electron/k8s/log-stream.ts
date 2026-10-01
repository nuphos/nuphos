import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'

import * as k8s from '@kubernetes/client-node'

import { parseTimestampedLine } from '../logParse'

import { getClients, withAuthRetry } from './client'
import { podLogContainers } from './log-containers'
import { podMatchesSelector } from './rows-workloads'

// Read just the selector of a workload — the Pods + Logs tabs in the
// workload detail view need this to client-side filter the live pod
// stream / kick off log follows.
export function getWorkloadSelector(
  context: string,
  kind: string,
  namespace: string,
  name: string,
): Promise<{
  matchLabels?: Record<string, string>
  matchExpressions?: k8s.V1LabelSelectorRequirement[]
} | null> {
  return withAuthRetry(context, async () => {
    const { appsApi, batchApi } = getClients(context)
    let sel: k8s.V1LabelSelector | undefined

    if (kind === 'Deployment')
      sel = (await appsApi.readNamespacedDeployment({ namespace, name })).spec?.selector
    else if (kind === 'StatefulSet')
      sel = (await appsApi.readNamespacedStatefulSet({ namespace, name })).spec?.selector
    else if (kind === 'DaemonSet')
      sel = (await appsApi.readNamespacedDaemonSet({ namespace, name })).spec?.selector
    else if (kind === 'ReplicaSet')
      sel = (await appsApi.readNamespacedReplicaSet({ namespace, name })).spec?.selector
    else if (kind === 'Job')
      sel = (await batchApi.readNamespacedJob({ namespace, name })).spec?.selector
    if (!sel) return null

    return {
      matchLabels: sel.matchLabels,
      matchExpressions: sel.matchExpressions,
    }
  })
}

// ---- Workload log streaming ----------------------------------------------
//
// `startWorkloadLogStream` resolves the workload's selector + matched pods,
// then opens a `follow:true` log stream per (pod, container) using the
// kubernetes SDK's Log helper. Each line is parsed off the stream and
// pushed to the renderer via `k8s:workloadlog:event`. The renderer keeps
// the same shape as the previous one-shot `WorkloadLogLine`, so the same
// merge / display logic works for tail backfill *and* live tail.
//
// One session can serve one log view. Stopping a session aborts every
// underlying connection and clears state — the destroy listener on the
// webContents covers the case where the window closes mid-stream.

export type WorkloadLogLine = {
  timestamp: string | null
  pod: string
  container: string
  message: string
}

// One options bag for every log read so adding a knob (sinceSeconds today;
// follow / grep / container filter later) never has to thread a new positional
// arg through the renderer → preload → main → k8s chain. Each function uses the
// fields that apply to it: getPodLogs uses all three; startWorkloadLogStream
// ignores `previous` (it always follows the live instance); getWorkloadPrevious-
// Logs ignores `sinceSeconds` (a previous instance is historical).
export type LogQuery = {
  tailLines?: number
  previous?: boolean
  sinceSeconds?: number
}

export type WorkloadLogEvent =
  | { sessionId: string; type: 'lines'; lines: WorkloadLogLine[] }
  | { sessionId: string; type: 'error'; message: string }
  | { sessionId: string; type: 'warning'; message: string }
  | { sessionId: string; type: 'ready' }

type LogStreamSession = {
  sessionId: string
  webContents: import('electron').WebContents
  controllers: AbortController[]
  followedKeys: Set<string>
  failedKeys: Set<string>
  reconcileTimer: ReturnType<typeof setInterval> | null
  // Set once a stop has been requested so any in-flight `Log.log()` that
  // resolves after cancellation gets aborted immediately instead of
  // leaking a live HTTP connection.
  cancelled: boolean
}

const logSessions = new Map<string, LogStreamSession>()

function emitLogEvent(session: LogStreamSession, event: WorkloadLogEvent) {
  if (session.webContents.isDestroyed()) return
  session.webContents.send('k8s:workloadlog:event', event)
}

export function startWorkloadLogStream(
  context: string,
  kind: string,
  namespace: string,
  name: string,
  query: LogQuery = {},
  webContents: import('electron').WebContents,
): string {
  const { tailLines, sinceSeconds } = query
  const sessionId = randomUUID()
  const session: LogStreamSession = {
    sessionId,
    webContents,
    controllers: [],
    followedKeys: new Set(),
    failedKeys: new Set(),
    reconcileTimer: null,
    cancelled: false,
  }

  logSessions.set(sessionId, session)
  webContents.once('destroyed', () => {
    stopWorkloadLogStream(sessionId)
  })

  let reconciling = false
  let selectorLoaded = false
  let selectorSnapshot: Awaited<ReturnType<typeof getWorkloadSelector>> = null
  let selectorMissingReported = false

  async function startContainerStream(
    log: k8s.Log,
    podName: string,
    containerName: string,
    streamKey: string,
  ) {
    let buf = ''
    const flushBuf = () => {
      if (!buf) return
      const lines = buf
        .split('\n')
        .map((line) => parseTimestampedLine(line, podName, containerName))

      buf = ''
      if (lines.length > 0) emitLogEvent(session, { sessionId, type: 'lines', lines })
    }
    const stream = new Writable({
      write(chunk, _enc, cb) {
        const text = chunk instanceof Buffer ? chunk.toString('utf8') : String(chunk)

        buf += text
        const nl = buf.lastIndexOf('\n')

        if (nl < 0) {
          cb()

          return
        }
        const complete = buf.slice(0, nl)

        buf = buf.slice(nl + 1)
        const lines = complete
          .split('\n')
          .map((line) => parseTimestampedLine(line, podName, containerName))

        if (lines.length > 0) emitLogEvent(session, { sessionId, type: 'lines', lines })
        cb()
      },
      final(cb) {
        flushBuf()
        cb()
      },
      destroy(error, cb) {
        flushBuf()
        cb(error)
      },
    })

    try {
      const ctrl = await log.log(namespace, podName, containerName, stream, {
        follow: true,
        ...(tailLines != null ? { tailLines } : {}),
        timestamps: true,
        ...(sinceSeconds != null ? { sinceSeconds } : {}),
      })

      if (session.cancelled) {
        ctrl.abort()

        return
      }
      session.controllers.push(ctrl)
    } catch (e) {
      session.followedKeys.delete(streamKey)
      if (session.failedKeys.has(streamKey) || session.cancelled) return
      session.failedKeys.add(streamKey)
      emitLogEvent(session, {
        sessionId,
        type: 'warning',
        message: `Could not follow ${podName}/${containerName}: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }

  async function reconcile() {
    if (reconciling || session.cancelled) return
    reconciling = true
    try {
      if (!selectorLoaded) {
        selectorSnapshot = await getWorkloadSelector(context, kind, namespace, name)
        selectorLoaded = true
      }
      const selector = selectorSnapshot

      if (session.cancelled) return
      if (!selector) {
        if (!selectorMissingReported) {
          selectorMissingReported = true
          emitLogEvent(session, {
            sessionId,
            type: 'error',
            message: 'This workload has no Pod selector, so its logs cannot be followed.',
          })
        }

        return
      }
      const { coreApi, kc } = getClients(context)
      const podsRes = await coreApi.listNamespacedPod({ namespace })

      if (session.cancelled) return
      const log = new k8s.Log(kc)
      const matched = podsRes.items.filter((pod) => podMatchesSelector(pod, selector))

      for (const pod of matched) {
        const podName = pod.metadata?.name
        const podIdentity = pod.metadata?.uid ?? podName

        if (!podName || !podIdentity) continue
        for (const container of podLogContainers(pod)) {
          const streamKey = `${podIdentity}\0${container.name}\0${String(container.instance)}`

          if (session.followedKeys.has(streamKey)) continue
          session.followedKeys.add(streamKey)
          void startContainerStream(log, podName, container.name, streamKey)
        }
      }
      emitLogEvent(session, { sessionId, type: 'ready' })
    } catch (e) {
      if (!session.cancelled) {
        emitLogEvent(session, {
          sessionId,
          type: 'error',
          message: e instanceof Error ? e.message : String(e),
        })
      }
    } finally {
      reconciling = false
    }
  }

  // Reconcile periodically so Pods created during a rollout join the same log
  // session. UID-based keys also let a StatefulSet Pod with a reused name get a
  // fresh stream after replacement.
  void reconcile()
  session.reconcileTimer = setInterval(() => void reconcile(), 5_000)

  return sessionId
}

export function stopWorkloadLogStream(sessionId: string): void {
  const s = logSessions.get(sessionId)

  if (!s) return
  s.cancelled = true
  logSessions.delete(sessionId)
  if (s.reconcileTimer) clearInterval(s.reconcileTimer)
  for (const c of s.controllers) {
    try {
      c.abort()
    } catch {
      // Ignore close races — by the time we abort the controller, the
      // underlying socket may already be tearing down.
    }
  }
}
