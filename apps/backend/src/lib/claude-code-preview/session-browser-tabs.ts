// A conversation's dock browser tabs, for its owner on another screen (the
// iPhone app). The tabs live only in the Nuphos Desktop that opened them, so
// each request is one `local_browser` call down the owner's device tunnel,
// resolved and audited exactly as the agent's own calls are. Only `dock` and
// `focus` go down as calls: a phone lists the tabs and brings one forward on
// the Mac, it never runs a page's JavaScript. Watching a tab live and taking
// it over is a stream instead (`sessionBrowserViewTarget`), audited when it opens.
import { getReadableConversation } from '@/lib/agent/db'
import { AppError } from '@/lib/errors'

import {
  createDeviceToolHandler,
  defaultDeviceToolDeps,
  resolveDevice,
} from './preview-tools/device-tool'

import type { DeviceTool, DeviceToolDeps } from './preview-tools/device-tool'
import type { RuntimeDesktopTarget } from './runtime-desktop'
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

/** The dock is the owner's own screen, as local_browser only runs in your own conversations. */
async function requireOwnConversation(teamId: string, userId: string, sessionId: string) {
  const conversation = await getReadableConversation(sessionId, userId, teamId)

  if (conversation?.userId !== userId || conversation.teamId !== teamId)
    throw new AppError(404, 'not_found', 'Conversation not found')
}

async function call(
  teamId: string,
  userId: string,
  sessionId: string,
  args: Call,
  deps: DeviceToolDeps,
): Promise<ToolResult> {
  await requireOwnConversation(teamId, userId, sessionId)
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

/**
 * Where a phone watches one dock tab live: the same device the dock calls reach,
 * relayed by the desktop viewer's stream (`runtimeDesktopEvents`) to the
 * Desktop's `browserView` stream, at the phone's page size.
 */
export async function sessionBrowserViewTarget(
  teamId: string,
  userId: string,
  sessionId: string,
  tab: { id: string; width: number; height: number },
  deps: DeviceToolDeps = quietDeps,
): Promise<RuntimeDesktopTarget> {
  await requireOwnConversation(teamId, userId, sessionId)
  const ctx = { userId, teamId, sessionId, locale: 'en' }
  const deviceId = await resolveDevice(ctx, dockTool, undefined, deps)

  if (typeof deviceId !== 'string')
    throw new AppError(409, 'browser_unavailable', resultText(deviceId))
  const owner = await deps.owner(ctx, deviceId)

  if (!owner) throw new AppError(404, 'not_found', 'This computer is not available to you.')
  const now = new Date()

  // Seeing and driving a tab is at least as much as a dock call, so it leaves the same record.
  await deps.audit({
    ownerUserId: owner,
    deviceId,
    actorUserId: userId,
    conversationOwnerUserId: userId,
    origin: 'user',
    teamId,
    sessionId,
    command: `[browser] phone view tab=${tab.id}`,
    requestedAt: now,
    dispatchedAt: now,
    finishedAt: now,
    outcome: 'ok',
  })

  return { userId: owner, deviceId, teamId, sessionId, display: 0, viewer: userId, tab }
}
