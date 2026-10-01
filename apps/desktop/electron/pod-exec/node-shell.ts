import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { describeError } from './tty'

import type * as k8s from '@kubernetes/client-node'

export const NODE_SHELL_NAMESPACE = 'kube-system'
// This pod runs privileged with host PID/IPC/net, so its image effectively owns
// the node — it must be a Zeabur-controlled, digest-pinned image, never a
// mutable public tag. Built from zeabur/atlas apps/node-shell and
// published to ECR Public so it's pullable from any user cluster. It carries
// only `nsenter` + `sleep`; the interactive shell comes from the host via
// nsenter, not this image.
const NODE_SHELL_IMAGE =
  'public.ecr.aws/c7s2j3w4/node-shell@sha256:f4367b5083bf13f50010615e44a5dcc39adaf659b3ba08e796cedd0c6056a544'
// Identifies pods this app created, so orphans (from a crash / forced quit) can
// be swept on the next terminal open. The node-name label uses key-existence
// matching since its value varies per node.
// A stable per-install id, persisted alongside the auth config. Every node-shell
// pod this install creates is labeled with it, so the orphan sweep only ever
// deletes pods THIS install left behind — never a node shell another machine
// has open against the same cluster.
let cachedOwnerId: string | null = null

function nodeShellOwnerId(): string {
  if (cachedOwnerId) return cachedOwnerId
  const dir = join(homedir(), '.config', 'nuphos')
  const file = join(dir, 'node-shell-owner')

  try {
    const existing = readFileSync(file, 'utf8').trim()

    if (existing) {
      cachedOwnerId = existing

      return existing
    }
  } catch {
    // not created yet
  }
  const id = randomUUID()

  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, id, 'utf8')
  } catch {
    // If it can't be persisted, fall back to a process-lifetime id — the sweep
    // still works within this run, it just won't recognize a prior run's pods.
  }
  cachedOwnerId = id

  return id
}

// Selector for THIS install's node-shell pods. The node name goes in an
// annotation, not a label value: node names can be 253 chars but label values
// cap at 63, so a long node name would make pod creation fail.
function nodeShellLabelSelector(): string {
  return `app.kubernetes.io/managed-by=nuphos,nuphos.dev/node-shell=true,nuphos.dev/node-shell-owner=${nodeShellOwnerId()}`
}
// Enter PID 1's mount/uts/ipc/net/pid namespaces, then a login shell (host bash,
// falling back to sh).
export const NODE_SHELL_COMMAND = [
  'nsenter',
  '-t',
  '1',
  '-m',
  '-u',
  '-i',
  '-n',
  '-p',
  '--',
  'sh',
  '-c',
  'if command -v bash >/dev/null 2>&1; then exec bash -l; else exec sh; fi',
]

export function nodeShellPod(name: string, nodeName: string): k8s.V1Pod {
  return {
    metadata: {
      name,
      namespace: NODE_SHELL_NAMESPACE,
      labels: {
        'app.kubernetes.io/managed-by': 'nuphos',
        'nuphos.dev/node-shell': 'true',
        'nuphos.dev/node-shell-owner': nodeShellOwnerId(),
      },
      // Node name in an annotation (no 63-char limit, unlike label values).
      annotations: { 'nuphos.dev/node-shell-node': nodeName },
    },
    spec: {
      nodeName,
      hostPID: true,
      hostIPC: true,
      hostNetwork: true,
      restartPolicy: 'Never',
      // The shell talks to the API server through the user's kubeconfig over
      // exec, never from inside the pod — so it needs no service-account token.
      // Withholding it keeps a host-root pod from also holding API credentials.
      automountServiceAccountToken: false,
      // Schedule onto control-plane / otherwise-tainted nodes too.
      tolerations: [{ operator: 'Exists' }],
      // Sleep doesn't need graceful shutdown — delete should be instant.
      terminationGracePeriodSeconds: 0,
      // Defense-in-depth: if every delete path is somehow missed, the pod
      // self-terminates rather than living indefinitely.
      activeDeadlineSeconds: 3600,
      containers: [
        {
          name: 'shell',
          image: NODE_SHELL_IMAGE,
          imagePullPolicy: 'IfNotPresent',
          securityContext: { privileged: true },
          // Keep the pod alive; the real shell is exec'd in via nsenter.
          command: ['sleep', '3600'],
        },
      ],
    },
  }
}

export async function waitForPodRunning(
  coreApi: k8s.CoreV1Api,
  namespace: string,
  name: string,
  isCancelled: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 30_000

  for (;;) {
    if (isCancelled()) return
    const res = await coreApi.readNamespacedPod({ name, namespace })
    const phase = res.status?.phase

    if (phase === 'Running') return
    if (phase === 'Failed' || phase === 'Succeeded') {
      throw new Error(`node-shell pod ${phase.toLowerCase()}`)
    }
    // Surface an image-pull / config stall instead of hanging to the deadline.
    const waiting = res.status?.containerStatuses?.[0]?.state?.waiting

    if (waiting?.reason && /Err|BackOff|Invalid/.test(waiting.reason)) {
      const detail = waiting.message ? `: ${waiting.message}` : ''

      throw new Error(`node-shell container ${waiting.reason}${detail}`)
    }
    if (Date.now() > deadline) throw new Error('node-shell pod did not become ready within 30s')
    await new Promise((r) => setTimeout(r, 600))
  }
}

// Every node-shell pod we've issued a create for and not yet confirmed deleted,
// keyed by pod name. `created` resolves true once the pod exists (false if the
// create failed) so a delete can wait for the create to settle first — without
// it, a delete issued during a slow create would 404 and then the create would
// land an orphaned privileged pod. A record is removed ONLY once the pod is
// confirmed gone (delete success or 404), so the orphan sweep also skips it.
type NodeShellPodRecord = {
  coreApi: k8s.CoreV1Api
  created: Promise<boolean>
  deleting?: Promise<void>
}
const nodeShellPods = new Map<string, NodeShellPodRecord>()
const pendingNodeShellDeletes = new Set<Promise<void>>()

export function registerNodeShellPod(name: string, record: NodeShellPodRecord): void {
  nodeShellPods.set(name, record)
}

function isNotFound(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const o = e as Record<string, unknown>
  const nested = (o.response as { statusCode?: unknown } | undefined)?.statusCode

  return o.code === 404 || o.statusCode === 404 || nested === 404
}

// Delete a node-shell pod — create-aware and idempotent. Waits for the pod's
// create to settle (so we never delete-before-create), deletes it, and forgets
// the pod only once it's confirmed gone (success or 404). A transient delete
// failure is logged and the record kept so a later retry / shutdown can finish.
export function ensureNodeShellPodDeleted(name: string): Promise<void> {
  const rec = nodeShellPods.get(name)

  if (!rec) return Promise.resolve()
  if (rec.deleting) return rec.deleting
  const work = (async () => {
    const created = await rec.created

    if (!created) {
      // The create never landed → nothing to delete.
      nodeShellPods.delete(name)

      return
    }
    try {
      await rec.coreApi.deleteNamespacedPod({
        name,
        namespace: NODE_SHELL_NAMESPACE,
        gracePeriodSeconds: 0,
      })
      nodeShellPods.delete(name)
    } catch (e) {
      if (isNotFound(e)) {
        nodeShellPods.delete(name)

        return
      }
      // Surface it (a leaked privileged pod must be diagnosable) and allow a
      // retry — keep the record, clear the in-flight marker.
      console.warn(`[node-exec] failed to delete node-shell pod ${name}:`, describeError(e))
      rec.deleting = undefined
    }
  })()

  rec.deleting = work
  pendingNodeShellDeletes.add(work)
  void work.finally(() => pendingNodeShellDeletes.delete(work))

  return work
}

// Delete any node-shell pods THIS install left behind that we aren't already
// tracking (orphans from a crash / forced quit). Owner-scoped so it never
// touches a node shell another machine has open. Runs before each new node
// terminal so leaks are self-healing per cluster.
export async function sweepOrphanedNodeShells(coreApi: k8s.CoreV1Api): Promise<void> {
  try {
    const res = await coreApi.listNamespacedPod({
      namespace: NODE_SHELL_NAMESPACE,
      labelSelector: nodeShellLabelSelector(),
    })

    for (const pod of res.items) {
      const name = pod.metadata?.name

      if (!name || nodeShellPods.has(name)) continue
      console.warn(`[node-exec] sweeping orphaned node-shell pod ${name}`)
      nodeShellPods.set(name, { coreApi, created: Promise.resolve(true) })
      void ensureNodeShellPodDeleted(name)
    }
  } catch (e) {
    console.warn('[node-exec] orphan sweep failed:', describeError(e))
  }
}

// On app shutdown: force-delete every pod we still track and wait for the
// deletes to land, bounded by timeoutMs so quit never hangs. Each delete is
// create-aware, so a pod whose create is still in flight is deleted once it
// lands (within the budget) rather than leaked.
export async function awaitNodeShellCleanup(timeoutMs: number): Promise<void> {
  const names = [...nodeShellPods.keys()]

  if (names.length === 0) return
  const work = Promise.allSettled(names.map((name) => ensureNodeShellPodDeleted(name)))

  await Promise.race([work, new Promise((r) => setTimeout(r, timeoutMs))])
}
