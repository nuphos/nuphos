// Stopping or wiping the local stack does the same to the managed agents a
// `--managed` launcher left in its local cluster: stop scales them to zero and
// keeps their volumes, a wipe deletes the namespace.
import { readFileSync } from 'node:fs'

import { MANAGED_KUBECONFIG, MANAGED_NAMESPACE, localKubeconfig } from './dev-managed-env.ts'
import { runDevCommand } from './dev-process.ts'

function managedContext(): string | null {
  let text: string

  try {
    text = readFileSync(MANAGED_KUBECONFIG, 'utf8')
  } catch {
    return null
  }
  const context = (JSON.parse(text) as { 'current-context'?: string })['current-context'] ?? ''

  return localKubeconfig(context, text).ok ? context : null
}

export function managedCleanupArgs(mode: 'stop' | 'down', context: string): string[] {
  const base = ['--kubeconfig', MANAGED_KUBECONFIG, '--context', context, '--request-timeout=10s']

  return mode === 'down'
    ? [...base, 'delete', 'namespace', MANAGED_NAMESPACE, '--ignore-not-found', '--timeout=180s']
    : [...base, '-n', MANAGED_NAMESPACE, 'scale', 'deployment', '--all', '--replicas=0']
}

/** A no-op unless a `--managed` launcher has confined itself to a local cluster before. */
export async function cleanupManagedAgents(
  mode: 'stop' | 'down',
  onLine: (line: string) => void,
): Promise<void> {
  let context: string | null

  try {
    context = managedContext()
  } catch {
    context = null
  }
  if (!context) return
  onLine(
    mode === 'down'
      ? `deleting managed agents: ${context}/${MANAGED_NAMESPACE} …`
      : `scaling managed agents to zero in ${context}/${MANAGED_NAMESPACE} …`,
  )
  const result = await runDevCommand('kubectl', managedCleanupArgs(mode, context), {
    timeoutMs: 240_000,
    onStdout: onLine,
    onStderr: onLine,
  })

  if (result.exitCode !== 0)
    onLine(`managed agents left as they are (kubectl exited ${String(result.exitCode)})`)
}
