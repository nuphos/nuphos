import { createHmac } from 'node:crypto'

import { bool, optional, optionalList } from './env'

import type { ClaudeCodePreviewConfig } from '@/lib/claude-code-preview/gate'
import type { RuntimeScheduling } from '@/lib/claude-code-preview/runtime-deployment'

import { resolveDevelopmentRuntimeEndpoint } from '@/lib/claude-code-preview/gate'

/** A local stack has no key to hand out, so it derives a stable one from its JWT secret. */
function localStackTokenKey(): string | undefined {
  const jwtSecret = optional('NUPHOS_JWT_SECRET')

  if (process.env.NODE_ENV === 'production' || !bool('NUPHOS_LOCAL_STACK', false) || !jwtSecret)
    return undefined

  return createHmac('sha256', jwtSecret)
    .update('nuphos-local-stack-token-encryption')
    .digest('base64')
}

export function claudeCodePreviewConfig(): ClaudeCodePreviewConfig {
  return {
    developmentControlKey:
      process.env.NODE_ENV === 'production' ? undefined : optional('NUPHOS_CLAUDE_CONTROL_KEY'),
    codexDevelopmentControlKey:
      process.env.NODE_ENV === 'production' ? undefined : optional('NUPHOS_CODEX_CONTROL_KEY'),
    tokenEncryptionKey:
      optional('OPENAB_RUNTIME_TOKEN_ENCRYPTION_KEY') ??
      optional('CLAUDE_CODE_PREVIEW_TOKEN_ENCRYPTION_KEY') ??
      localStackTokenKey(),
    codexDevelopmentRuntimeEndpoint:
      process.env.NODE_ENV === 'production'
        ? undefined
        : resolveDevelopmentRuntimeEndpoint(
            optional('CODEX_RUNTIME_DEV_URL'),
            optional('CODEX_RUNTIME_DEV_AUTH_KEY'),
            'CODEX_RUNTIME',
          ),
    developmentRuntimeEndpoint:
      process.env.NODE_ENV === 'production'
        ? undefined
        : resolveDevelopmentRuntimeEndpoint(
            optional('CLAUDE_CODE_RUNTIME_DEV_URL'),
            optional('CLAUDE_CODE_RUNTIME_DEV_AUTH_KEY'),
          ),
  }
}

export type ClaudeCodeRuntimeProvisionerConfig = {
  enabled: boolean
  namespace: string
  /** Dev-only: reconcile through the operator's kubectl login instead of the
   *  in-cluster ServiceAccount. Ignored in production. */
  kubectl: boolean
  /** Dev-only: kubeconfig context for those kubectl calls, so the operator's
   *  current context does not have to be the runtime cluster. */
  kubeContext?: string
  /** Where runtime pods are allowed to land, and how much CPU they may burn. */
  scheduling: RuntimeScheduling
}

function keyValuePairs(entries: string[]): [string, string][] {
  return entries.map((entry) => {
    const separator = entry.indexOf('=')
    const key = separator === -1 ? '' : entry.slice(0, separator).trim()
    const value = separator === -1 ? '' : entry.slice(separator + 1).trim()

    if (!key || !value) {
      throw new Error(
        `Runtime scheduling entries must be key=value (got: ${JSON.stringify(entry)})`,
      )
    }

    return [key, value]
  })
}

function runtimeCpuLimit(): string | undefined {
  const raw = optional('CLAUDE_CODE_RUNTIME_CPU_LIMIT') ?? '4'

  if (raw === 'none') return undefined
  // Kubernetes CPU quantities are a plain number of cores or milli-cores.
  // Rejecting here turns a typo into a startup failure rather than a
  // Deployment the API server refuses on the next reconcile.
  if (!/^\d+(?:\.\d+)?m?$/.test(raw) || Number.parseFloat(raw) <= 0) {
    throw new Error(
      'CLAUDE_CODE_RUNTIME_CPU_LIMIT must be a positive CPU quantity such as 4 or 500m, ' +
        `or \`none\` (got: ${JSON.stringify(raw)})`,
    )
  }

  return raw
}

function runtimeSchedulingConfig(): RuntimeScheduling {
  const cpuLimit = runtimeCpuLimit()

  return {
    nodeSelector: Object.fromEntries(
      keyValuePairs(optionalList('CLAUDE_CODE_RUNTIME_NODE_SELECTOR')),
    ),
    tolerations: keyValuePairs(optionalList('CLAUDE_CODE_RUNTIME_NODE_TOLERATIONS')).map(
      ([key, value]) => ({ key, value }),
    ),
    ...(cpuLimit ? { cpuLimit } : {}),
  }
}

export function claudeCodeRuntimeProvisionerConfig(): ClaudeCodeRuntimeProvisionerConfig {
  return {
    enabled: bool('CLAUDE_CODE_RUNTIME_PROVISIONER_ENABLED', false),
    namespace: optional('CLAUDE_CODE_RUNTIME_NAMESPACE') ?? 'openab-runtimes',
    kubectl: process.env.NODE_ENV !== 'production' && bool('CLAUDE_CODE_RUNTIME_KUBECTL', false),
    kubeContext: optional('CLAUDE_CODE_RUNTIME_KUBE_CONTEXT'),
    scheduling: runtimeSchedulingConfig(),
  }
}
