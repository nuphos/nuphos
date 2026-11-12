import { useEffect, useState } from 'react'

import { api } from '../../api'

import { readBotTaskAccess } from './botTaskAccess'

export function useBotTaskAccess(teamId: string, botId: string | undefined, owned: boolean) {
  const key = `${teamId}:${botId ?? ''}`
  const [result, setResult] = useState<{ key: string; allowed: boolean }>()

  useEffect(() => {
    if (!botId || owned) return
    let live = true

    void readBotTaskAccess(false, () =>
      api.agentGetConversation(botId, teamId, { tail: 1, messages: 'omit', runtimeState: 'omit' }),
    ).then((allowed) => {
      if (live) setResult({ key, allowed })
    })

    return () => {
      live = false
    }
  }, [teamId, botId, owned, key])

  return Boolean(botId) && (owned || (result?.key === key && result.allowed))
}
