// Temporary pre-merge e2e for nuphos#3364 against real Composio. Not committed.
import { composioAuthConfigId, composioRequest } from '@/lib/composio'
import { composioConnection, composioUserId, createComposioLink, deleteComposioAccount, executeComposioTool } from '@/lib/personal-credentials/composio'
import { googleScopes } from '@/lib/personal-credentials/google'

const user = composioUserId('e2e-pr3364', 'calendar-tester')
const [mode, ca] = process.argv.slice(2)
const run = (tool: string, args: Record<string, unknown>) => executeComposioTool({ tool, connectedAccountId: ca!, composioUserId: user, arguments: args })
const shape = (v: unknown): unknown => Array.isArray(v) ? [v.length ? shape(v[0]) : 'empty'] : v && typeof v === 'object' ? Object.keys(v) : typeof v

if (mode === 'link') {
  const id = await composioAuthConfigId('googlecalendar', [googleScopes('google-calendar')])
  const cfg = await composioRequest<Record<string, unknown>>('GET', `/auth_configs/${id}`)
  console.log('auth config', id, JSON.stringify({ scopes: (cfg.credentials as { scopes?: unknown } | undefined)?.scopes ?? cfg.scopes, is_composio_managed: cfg.is_composio_managed }))
  const link = await createComposioLink({ provider: 'google-calendar', composioUserId: user, callbackUrl: 'https://nuphos.ai/' })
  console.log('connected account', link.connectedAccountId)
  console.log('connect link', link.redirectUrl)
} else if (mode === 'check' && ca) {
  console.log('recorded login', JSON.stringify(await composioConnection('google-calendar', ca, user)))
  const me = await run('GOOGLECALENDAR_GET_CURRENT_USER', {})
  console.log('GET_CURRENT_USER successful', me.successful, 'error', me.error, 'data keys', JSON.stringify(shape(me.data)))
  const ev = await run('GOOGLECALENDAR_EVENTS_LIST', { calendarId: 'primary', maxResults: 3 })
  const items = (ev.data as { items?: unknown[] } | null)?.items
  console.log('EVENTS_LIST successful', ev.successful, 'error', ev.error, 'count', items?.length ?? null, 'shape', JSON.stringify(shape(ev.data)), 'item keys', JSON.stringify(items?.[0] ? Object.keys(items[0] as object) : null))
} else if (mode === 'delete' && ca) {
  await deleteComposioAccount(ca)
  console.log('deleted', ca)
} else console.log('usage: link | check <ca_id> | delete <ca_id>')
process.exit(0)
