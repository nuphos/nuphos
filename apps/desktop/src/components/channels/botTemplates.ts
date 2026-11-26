import { useQuery } from '@tanstack/react-query'

import { api } from '../../api'
import { BOT_AVATARS } from '../../lib/botAvatars'
import { queryKeys } from '../../lib/query/keys'

import type { BotTemplate } from '../../api/bot-import-types'
import type { BotAvatarFile } from '../../lib/botAvatars'

/** What a template card shows before a Bot is added, read from the nuphos/bot-templates catalog. */
export type BotTemplateCard = Omit<BotTemplate, 'avatar'> & { avatar: BotAvatarFile }

const builtInAvatar = (file: string): file is BotAvatarFile =>
  (BOT_AVATARS as readonly string[]).includes(file)

// `ipcRenderer.invoke` rejections arrive as
// `Error invoking remote method 'agent:foo': Error: <message>`.
const IPC_WRAPPER = /^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/

/** The message a failed IPC call carried, without Electron's wrapper. */
export const ipcErrorMessage = (cause: unknown, fallback: string) => {
  const message = cause instanceof Error ? cause.message.replace(IPC_WRAPPER, '').trim() : ''

  return message || fallback
}

/** The catalog, featured templates first. A template naming an avatar this app lacks is left out. */
export function useBotTemplates() {
  return useQuery({
    queryKey: queryKeys.botTemplates(),
    queryFn: async () => {
      const templates = await api.agentListBotTemplates()

      return templates
        .filter((template): template is BotTemplateCard => builtInAvatar(template.avatar))
        .sort((a, b) => Number(b.featured) - Number(a.featured))
    },
    staleTime: 60_000,
    retry: 1,
  })
}
