import { config } from '@/config'
import { logError, logEvent } from '@/lib/observability'

import { provisionerKubeClient } from './provisioner-kube'
import { clearProvisionerTimers, setProvisionerTimers } from './provisioner-timers'
import { initRuntimeMetricsSampler, shutdownRuntimeMetricsSampler } from './runtime-metrics-sampler'
import { OPENAB_PROVIDERS } from './runtime-provider'
import { reconcileHostedRuntimes } from './runtime-reconcile'

export { reconcileHostedRuntimes } from './runtime-reconcile'
export type { ProvisionerDeps } from './runtime-reconcile'

export function initClaudeCodeRuntimeProvisioner(): boolean {
  shutdownClaudeCodeRuntimeProvisioner()
  initRuntimeMetricsSampler()
  const provisionerConfig = config.claudeCodeRuntimeProvisioner

  if (!provisionerConfig.enabled) return false
  const kube = provisionerKubeClient()

  if (!kube) {
    logEvent('warn', 'claude_code.provisioner.not_in_cluster')

    return false
  }
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      for (const provider of OPENAB_PROVIDERS) {
        await reconcileHostedRuntimes({
          kube,
          namespace: provisionerConfig.namespace,
          scheduling: provisionerConfig.scheduling,
          provider,
        }).catch((err: unknown) => {
          logError('openab.provisioner.reconcile_failed', err, { provider })
        })
      }
    } finally {
      running = false
    }
  }

  setProvisionerTimers(
    setTimeout(() => void run(), 0),
    setInterval(() => void run(), 60_000),
  )

  return true
}

export function shutdownClaudeCodeRuntimeProvisioner(): void {
  clearProvisionerTimers()
  shutdownRuntimeMetricsSampler()
}
