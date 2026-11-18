import { t } from '../../i18n'
import { useBypassControl } from '../agent/panel/sessionBypass'

import { offlineMember } from './botPresenceRuntime'
import { useBotRuntimeControl } from './useBotRuntimeControl'

/**
 * What the Bot chat's composer offers: the Bot's own runtime, permission mode and model, the
 * ones its own page edits, never the chat's. Only the Bot's owner may read or change its mode;
 * anyone else sees its model locked.
 */
export function useBotComposerControls(...args: Parameters<typeof useBotRuntimeControl>) {
  const [teamId, bot, owned, , , , chat] = args
  const runtimeControl = useBotRuntimeControl(...args)
  const bypassControl = useBypassControl(owned ? bot : undefined)
  const modelSession = bot
    ? {
        sessionId: bot,
        teamId,
        runtimeId: runtimeControl?.value?.id,
        lockedHint: owned ? undefined : t('Only the owner can change model settings.'),
      }
    : undefined

  // A group chat has no runtime: its strip names a member Bot whose computer is offline.
  const offlineAgent = bot ? undefined : offlineMember(chat?.agents ?? [])

  return { runtimeControl, bypassControl, modelSession, offlineAgent }
}
