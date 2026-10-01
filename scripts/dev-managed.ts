// The `managed` row of `bun run dev --managed`: checks the local cluster the
// provisioner will deploy into, confines the backend to it, then lists the
// managed agents' pods. Failing here never stops the rest of the stack.
import { execFile } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { markDirty, pushEvent } from './dev-event-log.ts'
import {
  MANAGED_KUBECONFIG,
  MANAGED_NAMESPACE,
  isLocalContextName,
  localKubeconfig,
  managedPodHealth,
  orbstackProblem,
} from './dev-managed-env.ts'
import { managed } from './dev-services.ts'
import { isQuitting } from './dev-shutdown.ts'

type Captured = { ok: boolean; missing: boolean; stdout: string; stderr: string }

function capture(command: string, args: string[], timeoutMs = 20_000): Promise<Captured> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          missing: (err as NodeJS.ErrnoException | null)?.code === 'ENOENT',
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        })
      },
    )
  })
}

function kube(context: string, args: string[]): Promise<Captured> {
  return capture('kubectl', [
    '--kubeconfig',
    MANAGED_KUBECONFIG,
    '--context',
    context,
    '--request-timeout=10s',
    ...args,
  ])
}

async function orbstackState(): Promise<string | null> {
  const status = await capture('orbctl', ['status'])
  const k8s = status.missing ? null : await capture('orbctl', ['config', 'get', 'k8s.enable'])

  return orbstackProblem(status.missing ? null : status.stdout, k8s?.stdout ?? null)
}

/** Writes the backend's kubeconfig only once it is proven to hold nothing but a local cluster. */
async function confineToLocalCluster(context: string): Promise<string | null> {
  if (!isLocalContextName(context)) return `"${context}" is not a local cluster context`
  const view = await capture('kubectl', [
    'config',
    'view',
    '--minify',
    '--flatten',
    '--context',
    context,
    '-o',
    'json',
  ])

  if (view.missing) return 'kubectl is not installed'
  const checked = localKubeconfig(context, view.ok ? view.stdout : '')

  if (!checked.ok) {
    const hint = context === 'orbstack' && !view.ok ? ' — run: orbctl start k8s' : ''

    return `${checked.reason}${hint}`
  }
  mkdirSync(dirname(MANAGED_KUBECONFIG), { recursive: true, mode: 0o700 })
  const temporary = `${MANAGED_KUBECONFIG}.${String(process.pid)}`

  writeFileSync(temporary, JSON.stringify(checked.kubeconfig), { mode: 0o600 })
  renameSync(temporary, MANAGED_KUBECONFIG)

  return null
}

async function namespaceState(context: string): Promise<string | null> {
  const reachable = await kube(context, ['get', '--raw', '/readyz'])

  if (!reachable.ok) return `cluster ${context} is unreachable: ${reachable.stderr.slice(0, 160)}`
  if ((await kube(context, ['get', 'namespace', MANAGED_NAMESPACE])).ok) return null
  const created = await kube(context, ['create', 'namespace', MANAGED_NAMESPACE])

  if (!created.ok)
    return `could not create namespace ${MANAGED_NAMESPACE}: ${created.stderr.slice(0, 160)}`
  pushEvent(managed, `created namespace ${MANAGED_NAMESPACE}`)

  return null
}

/** The first thing keeping managed agents off this cluster, or null when there is none. */
async function preflight(context: string): Promise<string | null> {
  return (
    (context === 'orbstack' ? await orbstackState() : null) ??
    (await confineToLocalCluster(context)) ??
    (await namespaceState(context))
  )
}

let attempt = 0

async function watchPods(context: string, current: () => boolean) {
  while (current()) {
    const pods = await kube(context, ['-n', MANAGED_NAMESPACE, 'get', 'pods', '-o', 'json'])

    if (!current()) return
    managed.health = pods.ok ? managedPodHealth(pods.stdout) : { pods: 'cluster unreachable' }
    markDirty()
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
}

/** True once the backend may run the provisioner: the cluster is local, reachable and has the namespace. */
export async function startManagedAgents(context: string): Promise<boolean> {
  const mine = ++attempt
  const current = () => !isQuitting() && mine === attempt
  const startedAt = Date.now()

  managed.status = 'starting'
  managed.health = {}
  managed.note = null
  managed.url = `${context} · ${MANAGED_NAMESPACE}`
  managed.startedAt = startedAt
  markDirty()
  const problem = await preflight(context)

  // A superseded attempt leaves the row to the one that replaced it.
  if (!current()) return false
  if (problem) {
    managed.status = 'crashed'
    managed.note = problem
    managed.url = null
    pushEvent(managed, `${problem} — provisioner stays off; fix it, then press r`)

    return false
  }
  managed.status = 'ready'
  managed.readyMs = Date.now() - startedAt
  pushEvent(managed, `provisioner deploys managed agents into ${context}/${MANAGED_NAMESPACE}`)
  void watchPods(context, current)

  return true
}
