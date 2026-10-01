import { execFile } from 'node:child_process'

import { config } from '@/config'

/** Every dev kubectl call names the configured context rather than trusting the current one. */
export function kubectlArgs(args: readonly string[]): string[] {
  const context = config.claudeCodeRuntimeProvisioner.kubeContext

  return context ? ['--context', context, ...args] : [...args]
}

export function execKubectl(args: string[], stdin?: string): Promise<string> {
  const argv = kubectlArgs(args)

  return new Promise((resolve, reject) => {
    const child = execFile(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- dev-only client, config-gated off in production; kubectl resolves from the operator's own PATH
      'kubectl',
      argv,
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(`kubectl ${args.join(' ')} failed: ${(stderr || err.message).slice(0, 300)}`),
          )
        } else {
          resolve(stdout)
        }
      },
    )

    if (stdin !== undefined) child.stdin?.write(stdin)
    child.stdin?.end()
  })
}

/** Readiness via Deployment availability — equivalent to /health, which the
 *  readiness probe already gates, and reachable from outside the cluster. */
export async function kubectlDeploymentReady(
  namespace: string,
  name: string,
  attempts = 24,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 5_000))
    try {
      const stdout = await execKubectl([
        '-n',
        namespace,
        'get',
        'deployment',
        name,
        '-o',
        'jsonpath={.status.availableReplicas}',
      ])

      if (Number(stdout.trim()) >= 1) return true
    } catch {
      // not created yet — keep polling
    }
  }

  return false
}
