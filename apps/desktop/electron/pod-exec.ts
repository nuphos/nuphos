// Interactive `kubectl exec`-equivalent into a pod container. Mirrors the SSH
// terminal subsystem (terminal.ts): one session map, events streamed to the
// renderer over a single channel, with input / resize / close / replay. The
// transport is @kubernetes/client-node's Exec over the cluster API server's
// exec subresource (the same WebSocket path port-forward already uses).

import { createHash } from 'node:crypto'
import { PassThrough } from 'node:stream'

import * as k8s from '@kubernetes/client-node'

import {
  awaitNodeShellCleanup,
  ensureNodeShellPodDeleted,
  NODE_SHELL_COMMAND,
  NODE_SHELL_NAMESPACE,
  nodeShellPod,
  registerNodeShellPod,
  sweepOrphanedNodeShells,
  waitForPodRunning,
} from './pod-exec/node-shell'
import {
  attachExec,
  closeAllPodExecSessions,
  closePodExecSession,
  closeSessionsOutsideScope,
  createSession,
  deleteSession,
  detachPodExecSession,
  liveSession,
  replayPodExecSession,
  resizePodExecSession,
  send,
  writePodExecSession,
} from './pod-exec/session'
import { NO_SUPPORTED_SHELL_MESSAGE, resolvePodShell } from './pod-exec/shell'
import { describeError } from './pod-exec/tty'

import type { WebContents } from 'electron'

export {
  awaitNodeShellCleanup,
  closeAllPodExecSessions,
  closePodExecSession,
  closeSessionsOutsideScope,
  detachPodExecSession,
  replayPodExecSession,
  resizePodExecSession,
  writePodExecSession,
}

/** Whether `id` already names a usable session. Lets the renderer reattach to a
 *  node shell without re-running the consent prompt for a pod it already made. */
export function hasPodExecSession(id: string): boolean {
  return liveSession(id) !== null
}

export async function startPodExecSession(
  target: WebContents,
  id: string,
  kc: k8s.KubeConfig,
  namespace: string,
  pod: string,
  container: string,
  opts?: { cols?: number; rows?: number; shell?: string },
): Promise<{ id: string }> {
  // Idempotent: a remounted view asks for its own id back rather than opening a
  // second exec into the same container.
  if (liveSession(id)) return { id }
  const command = opts?.shell
    ? [opts.shell]
    : await resolvePodShell((candidate) => probePodShell(kc, namespace, pod, container, candidate))

  if (!command) throw new Error(NO_SUPPORTED_SHELL_MESSAGE)

  const session = createSession(target, id, opts)

  try {
    await attachExec(target, kc, session, namespace, pod, container, command)

    return { id: session.id }
  } catch (error) {
    deleteSession(session.id)
    // Log the raw object so the dev console shows the full shape/stack while
    // the renderer gets a human-readable message.
    console.error('[pod-exec] exec failed:', error)
    throw new Error(describeError(error), { cause: error })
  }
}

async function probePodShell(
  kc: k8s.KubeConfig,
  namespace: string,
  pod: string,
  container: string,
  command: readonly string[],
): Promise<boolean> {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const exec = new k8s.Exec(kc)

  return await new Promise<boolean>((resolve) => {
    let socket: {
      close: () => void
      on: (event: 'error', listener: () => void) => void
    } | null = null
    let settled = false
    const finish = (available: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket?.close()
      } catch {
        // best-effort
      }
      resolve(available)
    }
    const timer = setTimeout(() => finish(false), 5_000)

    timer.unref()
    void exec
      .exec(
        namespace,
        pod,
        container,
        [...command, '-c', 'exit 0'],
        stdout,
        stderr,
        null,
        false,
        (status) => finish(status.status === 'Success'),
      )
      .then((ws) => {
        const opened = ws as unknown as {
          close: () => void
          on: (event: 'error', listener: () => void) => void
        }

        socket = opened
        opened.on('error', () => finish(false))
        if (settled) opened.close()
      })
      .catch(() => finish(false))
  })
}

// --- Node shell --------------------------------------------------------------
// A node has no exec subresource, so a "node terminal" means: create a tiny
// privileged pod pinned to the node (host PID/IPC/net), then nsenter into the
// host's PID 1 namespaces and run the host's shell. The pod is ephemeral and is
// deleted the moment the terminal closes (via the session onCleanup hook).

export async function startNodeExecSession(
  target: WebContents,
  id: string,
  kc: k8s.KubeConfig,
  coreApi: k8s.CoreV1Api,
  nodeName: string,
  opts?: { cols?: number; rows?: number },
): Promise<{ id: string }> {
  if (liveSession(id)) return { id }
  const session = createSession(target, id, opts)
  // The session id is now the caller's tab-scoped key, which is neither unique
  // per attempt nor a legal object name — hash it into something Kubernetes
  // accepts and that two shells on the same node cannot collide on.
  const podName = `nuphos-node-shell-${createHash('sha1').update(session.id).digest('hex').slice(0, 8)}`
  const ns = NODE_SHELL_NAMESPACE

  const deletePod = () => {
    void ensureNodeShellPodDeleted(podName)
  }

  // Clean up any leaked node-shell pods from a prior run before adding another.
  await sweepOrphanedNodeShells(coreApi)

  try {
    send(target, session, {
      id: session.id,
      type: 'data',
      data: `\x1b[90mStarting node shell on ${nodeName} (privileged pod ${ns}/${podName})…\x1b[0m\r\n`,
    })
    // Register the pod BEFORE the create resolves, capturing the create promise
    // so any teardown that races the create (e.g. app quit mid-create) deletes
    // it create-aware: the delete waits for the create to settle rather than
    // 404ing early and leaking the pod once it lands.
    const createP = coreApi.createNamespacedPod({
      namespace: ns,
      body: nodeShellPod(podName, nodeName),
    })

    registerNodeShellPod(podName, {
      coreApi,
      created: createP.then(
        () => true,
        () => false,
      ),
    })
    session.onCleanup = deletePod
    await createP

    await waitForPodRunning(coreApi, ns, podName, () => session.closed)
    if (session.closed) {
      // Closed mid-startup — ensure the pod is gone.
      deletePod()

      return { id: session.id }
    }

    send(target, session, { id: session.id, type: 'data', data: '\x1b[90mConnected.\x1b[0m\r\n' })
    await attachExec(target, kc, session, ns, podName, 'shell', NODE_SHELL_COMMAND)

    return { id: session.id }
  } catch (error) {
    deletePod()
    deleteSession(session.id)
    console.error('[node-exec] start failed:', error)
    throw new Error(describeError(error), { cause: error })
  }
}
