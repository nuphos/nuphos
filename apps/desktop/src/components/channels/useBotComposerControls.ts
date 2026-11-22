import { t } from '../../i18n'

import { offlineMember } from './botPresenceRuntime'
import { useBotRuntimeControl } from './useBotRuntimeControl'

/**
 * What the Bot chat's composer offers: the Bot's own runtime and model, the ones its own page
 * edits, never the chat's. Anyone but the Bot's owner sees its model locked. What the Bot may
 * use is in Bot details.
 */
export function useBotComposerControls(...args: Parameters<typeof useBotRuntimeControl>) {
  const [teamId, bot, owned, , , chat] = args
  const ownRuntime = useBotRuntimeControl(...args)
  // A group chat has no runtime: its strip names a member Bot whose computer is offline.
  const offlineAgent = bot ? undefined : offlineMember(chat?.agents ?? [])
  const runtimeControl = ownRuntime ?? (offlineAgent ? { value: null, offlineAgent } : undefined)
  const modelSession = bot
    ? {
        sessionId: bot,
        teamId,
        runtimeId: runtimeControl?.value?.id,
        lockedHint: owned ? undefined : t('Only the owner can change model settings.'),
      }
    : undefined

  return { runtimeControl, modelSession }
}
