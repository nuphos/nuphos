// A conversation's dock browser tabs, for its owner on another screen (the
// iPhone app). The tabs live only in the Nuphos Desktop that opened them, so
// each request is one `local_browser` call down the owner's device tunnel,
// resolved and audited exactly as the agent's own calls are. Only `dock` and
// `focus` are allowed here: a phone lists the tabs and brings one forward on
// the Mac, it never runs a page's JavaScript.
import { getReadableConversation } from '@/lib/agent/db'
import { AppError } from '@/lib/errors'

import { createDeviceToolHandler, defaultDeviceToolDeps } from './preview-tools/device-tool'

import type { DeviceTool, DeviceToolDeps } from './preview-tools/device-tool'
import type { ToolResult } from '@/lib/mcp/protocol'

/** A phone waits for this, so it fails fast instead of the agent's four minutes. */
const PHONE_TIMEOUT_MS = 15_000

/** A tab in the conversation's dock: opened by the agent or the user, live or restored. */
export type SessionBrowserTab = { id: string; url: string; title: string }

type Call = { action: 'dock' } | { action: 'focus'; dockTab: string }

const dockTool: DeviceTool = {
  name: 'local_browser',
  label: 'The dock',
  purpose: 'browser',
  invalid: (raw) => {
    const args = raw as Partial<Call> & { dockTab?: unknown }

    if (args.action === 'dock') return undefined
    if (args.action === 'focus' && typeof args.dockTab === 'string') return undefined

    return 'Only dock, and focus with a dock tab id, are allowed.'
  },
  frame: (raw, ctx) => ({ ...(raw as Call), team: ctx.teamId }),
  audit: (raw) => {
    const args = raw as Call

    return [
      '[browser] phone',
      args.action,
      ...('dockTab' in args ? [`tab=${args.dockTab}`] : []),
    ].join(' ')
  },
  errorReason: 'browser_error',
  noDevice: 'No computer of yours is online for this conversation.',
  unsupported: 'The computer went offline, or its Nuphos Desktop needs an update.',
}

const quietDeps: DeviceToolDeps = {
  ...defaultDeviceToolDeps,
  // The conversation's run never shows these calls as tool cards.
  publish: async () => {},
  timeoutMs: PHONE_TIMEOUT_MS,
}

const resultText = (result: ToolResult) =>
  result.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n')

async function call(
  teamId: string,
  userId: string,
  sessionId: string,
  args: Call,
  deps: DeviceToolDeps,
): Promise<ToolResult> {
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  // The dock is the owner's own screen, as local_browser only runs in your own conversations.
  if (conversation?.userId !== userId || conversation.teamId !== teamId)
    throw new AppError(404, 'not_found', 'Conversation not found')
  const result = await createDeviceToolHandler(
    { userId, teamId, sessionId, locale: 'en' },
    dockTool,
    deps,
  )(args)

  if (result.isError) throw new AppError(409, 'browser_unavailable', resultText(result))

  return result
}

/** The browser tabs in this conversation's dock, in its owner's Nuphos Desktop. */
export async function sessionBrowserTabs(
  teamId: string,
  userId: string,
  sessionId: string,
  deps: DeviceToolDeps = quietDeps,
): Promise<SessionBrowserTab[]> {
  const result = await call(teamId, userId, sessionId, { action: 'dock' }, deps)

  return JSON.parse(resultText(result)) as SessionBrowserTab[]
}

/** Shows one of those tabs on the owner's Mac: its window, its conversation, its dock tab. */
export async function focusSessionBrowserTab(
  teamId: string,
  userId: string,
  sessionId: string,
  dockTab: string,
  deps: DeviceToolDeps = quietDeps,
): Promise<void> {
  await call(teamId, userId, sessionId, { action: 'focus', dockTab }, deps)
}
