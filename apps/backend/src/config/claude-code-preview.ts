import { createHmac } from 'node:crypto'

import { bool, optional } from './env'

import type { ClaudeCodePreviewConfig } from '@/lib/claude-code-preview/gate'

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
