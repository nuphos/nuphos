import { useEffect } from 'react'

import { forgetSessionDesktops, publishSessionDesktops } from '../../lib/sessionDesktops'
import { sessionDesktopsOf } from '../agent/panel/shells'

import type { RuntimeExecution } from '../../lib/runtimeExecution'

/** Publishes a Bot chat's desktops, docked in its channel, while the channel is open. */
export function useBotDesktops(
  teamId: string,
  channelId: string,
  bot: string | undefined,
  botState: RuntimeExecution | undefined,
  botOwned: boolean,
) {
  useEffect(() => {
    if (!bot) return
    publishSessionDesktops(bot, {
      ...sessionDesktopsOf(teamId, { runtimeState: botState, foreign: !botOwned }),
      dock: channelId,
    })

    return () => forgetSessionDesktops(bot, channelId)
  }, [bot, teamId, botState, botOwned, channelId])
}
