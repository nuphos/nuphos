import type { LarkDomain } from '../../types'

export const CREATE_APP_URL: Record<LarkDomain, string> = {
  feishu: 'https://open.feishu.cn/app?lang=zh-CN',
  larksuite: 'https://open.larksuite.com/app?lang=en-US',
}

const CONSOLE_LANG: Record<LarkDomain, string> = {
  feishu: 'zh-CN',
  larksuite: 'en-US',
}

// Deep link into a specific page of the app's console (auth = Permissions &
// Scopes, event = Events & Callbacks). Falls back to the console home while the
// App ID isn't known yet.
export function larkAppPageUrl(
  domain: LarkDomain,
  appId: string | undefined,
  page: 'auth' | 'event',
): string {
  const origin = domain === 'feishu' ? 'https://open.feishu.cn' : 'https://open.larksuite.com'

  if (!appId?.trim().startsWith('cli_')) return CREATE_APP_URL[domain]

  return `${origin}/app/${appId.trim()}/${page}?lang=${CONSOLE_LANG[domain]}`
}

// Events the app must subscribe to on the Event Configuration tab. Shared with
// the Lark settings view so the list stays discoverable after the wizard closes.
export const LARK_SUBSCRIBE_EVENTS = [
  'im.message.receive_v1',
  'im.chat.member.bot.added_v1',
  'im.chat.member.bot.deleted_v1',
] as const
