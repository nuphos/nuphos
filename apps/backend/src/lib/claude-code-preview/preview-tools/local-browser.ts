// `local_browser` drives the browser tabs on the conversation's computer: the
// in-app browser of the owner's Nuphos Desktop, or a headless Chromium that a
// computer running only `nuphos agent` starts. It rides the same device tunnel
// and checks as `local_cua`; neither opens a debugging port, and nothing outside
// those tabs is reachable.
import { getLocalActiveAgentRun, runChannels } from '@/lib/agent/run-admission'
import { getActiveAgentRunForSession } from '@/lib/agent/run-store'
import { toolError } from '@/lib/mcp/protocol'

import { createDeviceToolHandler } from './device-tool'
import { fillProblem, FillRefused, fillScriptFor, readSecret } from './local-browser-fill'

import type { PreviewToolContext, PreviewToolModule } from '../preview-tool-context'
import type { DeviceTool, DeviceToolDeps } from './device-tool'
import type { FillField, ReadSecret } from './local-browser-fill'

const ACTIONS = [
  'tabs',
  'open',
  'navigate',
  'eval',
  'fill',
  'screenshot',
  'show',
  'close',
  'record_start',
  'record_stop',
] as const

type Args = {
  action: (typeof ACTIONS)[number]
  tab?: number
  url?: string
  script?: string
  fields?: FillField[]
  device?: string
}

/** The channels the conversation's running turn answers. */
async function turnChannels(ctx: PreviewToolContext): Promise<string[]> {
  const userId = ctx.conversationOwnerUserId ?? ctx.userId
  const run =
    getLocalActiveAgentRun(userId, ctx.sessionId) ??
    (await getActiveAgentRunForSession(userId, ctx.sessionId))

  return run ? runChannels({ userId, sessionId: ctx.sessionId, streamId: run.streamId }) : []
}

const browserTool = (channels: typeof turnChannels, fill?: string): DeviceTool => ({
  name: 'local_browser',
  label: 'local_browser',
  purpose: 'browser',
  invalid: (raw) => {
    const args = raw as Args

    if (!ACTIONS.includes(args.action)) return `action must be one of: ${ACTIONS.join(', ')}.`
    if ((args.action === 'open' || args.action === 'navigate') && !args.url)
      return 'url is required.'
    if (args.action === 'eval' && !args.script?.trim()) return 'script is required.'
    if (args.action === 'fill' && fillProblem(args.fields)) return fillProblem(args.fields)
    const needsTab = args.action !== 'tabs' && args.action !== 'open'

    return needsTab && args.tab === undefined
      ? 'tab is required; list the open tabs with action "tabs".'
      : undefined
  },
  frame: async (raw, ctx) => {
    const args = raw as Args
    // A tab opens where it was asked for: the channel that woke this turn, when exactly one did.
    const asked = args.action === 'open' ? await channels(ctx) : []

    // The values travel in this page script only, after the call was shown and audited by its paths.
    if (args.action === 'fill')
      return { action: 'eval', team: ctx.teamId, tab: args.tab, script: fill ?? '' }

    return {
      action: args.action,
      ...(asked.length === 1 ? { dock: asked[0] } : {}),
      team: ctx.teamId,
      ...(args.tab !== undefined ? { tab: args.tab } : {}),
      ...(args.url ? { url: args.url } : {}),
      ...(args.script ? { script: args.script } : {}),
    }
  },
  audit: (raw) => {
    const args = raw as Args

    const tab = args.tab === undefined ? [] : [`tab=${String(args.tab)}`]

    // A fill is recorded by where it wrote and which file it read, never by what.
    if (args.action === 'fill')
      return [
        '[browser] fill',
        ...tab,
        ...(args.fields ?? []).map((field) => `${field.selector} <- ${field.path}`),
      ].join(' ')

    return ['[browser]', args.action, ...tab, args.url ?? args.script ?? ''].join(' ').trim()
  },
  errorReason: 'browser_error',
  noDevice:
    'No local device is usable in this conversation. Either none is selected in its credential selector, or the selected one is offline: Nuphos Desktop must be open and signed in on it, or `nuphos agent` running, with local exec allowed. list_credentials shows which.',
  unsupported:
    'The device disconnected or does not support local_browser yet: update Nuphos Desktop, or on a computer running only `nuphos agent`, update the CLI and install Chromium or Google Chrome.',
})

const definition = {
  name: 'local_browser',
  description:
    'The Nuphos browser: use it whenever the user asks to open a browser, a page or a website, also on a computer with its own desktop. ' +
    'A site or app named by the user ("open up TikTok") means its official URL (https://www.tiktok.com); search the web if unsure, then open it in the same turn, never an empty tab. ' +
    'When a task needs the user to sign in or sign up somewhere, open that login or sign-up page here yourself, sub-agents included, and say what to do on it; the user types their own password and passes human checks, never you. ' +
    "Operate this conversation's browser tabs on its computer, in Nuphos Desktop's in-app browser or, on a computer running only `nuphos agent`, a headless Chromium (not the user's Chrome or Safari): open a page in a new tab, list the tabs this conversation opened, navigate, run JavaScript in a page, or take a screenshot. " +
    'A tab runs in the background in a hidden desktop-sized window (1440x900), so pages get their desktop layout and screenshots work while the user does other things. ' +
    'When the user should see or use the page (they asked to open a site, or must sign in or pass a check), call show: its window comes on screen, and closing it hides it again while you keep driving it. close ends a tab you no longer need. ' +
    'A computer running only `nuphos agent` has no screen, so show and fill are refused there. ' +
    'In Nuphos Desktop, pages keep the logins the user made in the in-app browser; on a computer running only `nuphos agent`, each conversation starts signed out, and its logins last only until its last tab closes. ' +
    'Start with action "open" (or "tabs"), then pass the returned tab id. ' +
    'eval runs `script` in the page as a user gesture and returns its JSON-serializable value (an awaited Promise for async code): read the DOM, click, fill inputs (dispatch input events for frameworks). ' +
    'A download in a tab is saved to Downloads/Nuphos on the device with no save dialog, numbered instead of replacing a file there, up to 2 GB; the next tabs or eval result says "Downloaded: <path>" or how it failed. ' +
    "fill enters the user's own details, saved by a secure input card, into a page's inputs: pass `fields`, each with the CSS `selector` of an input and the `path` the card's answer gave for it. The values are read from those files and set on the page without passing through you or this conversation, and the result says only which selectors were filled. It enters them only on a page of the site the card named and refuses any other tab: navigate the tab to that site first. Use it for every such value instead of eval, never read the files, and do not read the filled inputs back from the page. " +
    "record_start captures the tab's network traffic (requests, responses, headers including cookies, bodies) until record_stop, which writes it as a HAR file on the device and returns its path with one line per request; read details from that file on the device. " +
    'Use this for web pages; use local_cua for other apps.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [...ACTIONS] },
      tab: {
        type: 'integer',
        description:
          'Tab id from "open" or "tabs" in this conversation; required by every action except tabs and open.',
      },
      url: { type: 'string', description: 'http(s) URL for open and navigate.' },
      script: { type: 'string', description: 'JavaScript expression or IIFE for eval.' },
      fields: {
        type: 'array',
        description: 'For fill: the inputs to set, each from a file a secure input card saved.',
        minItems: 1,
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector of the input or select.' },
            path: {
              type: 'string',
              description: "The file path the card's answer gave for this value, unchanged.",
            },
          },
          required: ['selector', 'path'],
          additionalProperties: false,
        },
      },
      device: {
        type: 'string',
        description:
          "deviceId to run on. Omit it to use the user's own screen (their one selected device that is not a Nuphos computer); otherwise the error lists the current device ids.",
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
}

export function createLocalBrowserHandler(
  ctx: PreviewToolContext,
  deps?: DeviceToolDeps,
  channels = turnChannels,
  read: ReadSecret = readSecret,
) {
  const plain = createDeviceToolHandler(ctx, browserTool(channels), deps)

  return async (args: Record<string, unknown>) => {
    // Anything else, and a fill its own checks refuse, takes the ordinary path.
    if (args.action !== 'fill' || browserTool(channels).invalid(args)) return plain(args)
    // Read first: a value that may not be filled fails the call before the device is asked for anything.
    const script = await fillScriptFor(ctx, args.fields as FillField[], read).catch(
      (error: unknown) => (error instanceof FillRefused ? toolError(error.message) : null),
    )

    if (typeof script !== 'string')
      return (
        script ??
        toolError(
          'Could not read a saved value from the runtime: the file may have expired or the path is not the one the card gave. Ask for the details again with request_user_decision.',
        )
      )

    return createDeviceToolHandler(ctx, browserTool(channels, script), deps)(args)
  }
}

export const localBrowserToolModule: PreviewToolModule = {
  definitions: [definition],
  handlers: (ctx) => ({ local_browser: createLocalBrowserHandler(ctx) }),
}
