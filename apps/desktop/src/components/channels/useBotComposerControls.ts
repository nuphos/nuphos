import { offlineMember } from './botPresenceRuntime'
import { useBotRuntimeControl } from './useBotRuntimeControl'

import type { RuntimeControl } from '../agent/panel/RuntimeSelector'

/**
 * The Bot's runtime, for its details to pick, and what the chat's composer only reports about its
 * agent: offline, signed out or gone. A Bot's runtime and model are changed in its details.
 */
export function useBotComposerControls(...args: Parameters<typeof useBotRuntimeControl>) {
  const [, bot, , , , chat] = args
  const runtime = useBotRuntimeControl(...args)
  const offlineAgent = bot ? undefined : offlineMember(chat?.agents ?? [])
  let runtimeControl: RuntimeControl | undefined

  if (runtime) runtimeControl = { ...runtime, statusOnly: true }
  else if (offlineAgent) runtimeControl = { value: null, offlineAgent, statusOnly: true }

  return { runtime, runtimeControl }
}
