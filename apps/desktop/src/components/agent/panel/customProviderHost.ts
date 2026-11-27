import { localAgentId } from '../../../lib/localAgentReady'

import type { LocalRuntimeState } from '../../../api'

/**
 * The host of the custom provider this computer's Claude Code or Codex runs on, when
 * `runtimeId` is one of them: its model list is that provider's, not the vendor's.
 */
export function customProviderHost(
  state: LocalRuntimeState | null,
  runtimeId: string | undefined,
): string | undefined {
  if (!state?.userId || !state.deviceId || !runtimeId) return
  for (const provider of ['claude-code', 'codex'] as const) {
    const saved = state.customProviders?.[provider]

    // Saved only once parseCustomProvider accepted it as a URL.
    if (saved && localAgentId(state.userId, state.deviceId, provider) === runtimeId)
      return new URL(saved.baseUrl).host
  }
}
