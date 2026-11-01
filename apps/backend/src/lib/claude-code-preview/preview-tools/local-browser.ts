// `local_browser` drives the browser tabs inside the owner's Nuphos Desktop
// workspace. It rides the same device tunnel and checks as `local_cua`; Desktop
// runs each action on the tab's own webContents, so no debugging port is opened
// and nothing outside those tabs is reachable.
import { createDeviceToolHandler } from './device-tool'

import type { PreviewToolContext, PreviewToolModule } from '../preview-tool-context'
import type { DeviceTool, DeviceToolDeps } from './device-tool'

const ACTIONS = [
  'tabs',
  'open',
  'navigate',
  'eval',
  'screenshot',
  'record_start',
  'record_stop',
] as const

type Args = {
  action: (typeof ACTIONS)[number]
  tab?: number
  url?: string
  script?: string
  device?: string
}

const browserTool: DeviceTool = {
  name: 'local_browser',
  label: 'local_browser',
  purpose: 'browser',
  invalid: (raw) => {
    const args = raw as Args

    if (!ACTIONS.includes(args.action)) return `action must be one of: ${ACTIONS.join(', ')}.`
    if ((args.action === 'open' || args.action === 'navigate') && !args.url)
      return 'url is required.'
    if (args.action === 'eval' && !args.script?.trim()) return 'script is required.'
    const needsTab = args.action !== 'tabs' && args.action !== 'open'

    return needsTab && args.tab === undefined
      ? 'tab is required; list the open tabs with action "tabs".'
      : undefined
  },
  frame: (raw, ctx) => {
    const args = raw as Args

    return {
      action: args.action,
      team: ctx.teamId,
      ...(args.tab !== undefined ? { tab: args.tab } : {}),
      ...(args.url ? { url: args.url } : {}),
      ...(args.script ? { script: args.script } : {}),
    }
  },
  audit: (raw) => {
    const args = raw as Args

    const tab = args.tab === undefined ? [] : [`tab=${String(args.tab)}`]

    return ['[browser]', args.action, ...tab, args.url ?? args.script ?? ''].join(' ').trim()
  },
  errorReason: 'browser_error',
  noDevice:
    'No local device is usable in this conversation. Either none is selected in its credential selector, or the selected one is offline: Nuphos Desktop must be open and signed in on it, with local exec allowed. list_credentials shows which.',
  unsupported:
    'The device disconnected or its Nuphos Desktop does not support local_browser yet (update Nuphos Desktop).',
}

const definition = {
  name: 'local_browser',
  description:
    'The Nuphos browser: use it whenever the user asks to open a browser, a page or a website, also on a computer with its own desktop. ' +
    'A site or app named by the user ("open up TikTok") means its official URL (https://www.tiktok.com); search the web if unsure, then open it in the same turn, never an empty tab. ' +
    'When a task needs the user to sign in or sign up somewhere, open that login or sign-up page here yourself, sub-agents included, and say what to do on it; the user types their own password and passes human checks, never you. ' +
    "Operate this conversation's browser tabs inside the user's Nuphos Desktop workspace (the in-app browser, not Chrome or Safari): open a page in a new tab in this conversation's dock, list the tabs this conversation opened, navigate, run JavaScript in a page, or take a screenshot. " +
    'Pages keep the logins the user made in the in-app browser. Start with action "open" (or "tabs"), then pass the returned tab id. ' +
    'eval runs `script` in the page as a user gesture and returns its JSON-serializable value (an awaited Promise for async code): read the DOM, click, fill inputs (dispatch input events for frameworks). ' +
    'screenshot only works while the tab is on screen. ' +
    "record_start captures the tab's network traffic (requests, responses, headers including cookies, bodies) until record_stop, which writes it as a HAR file on the device and returns its path with one line per request; read details from that file on the device. " +
    'Use this for the in-app browser; use local_cua for other apps.',
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

export function createLocalBrowserHandler(ctx: PreviewToolContext, deps?: DeviceToolDeps) {
  return createDeviceToolHandler(ctx, browserTool, deps)
}

export const localBrowserToolModule: PreviewToolModule = {
  definitions: [definition],
  handlers: (ctx) => ({ local_browser: createLocalBrowserHandler(ctx) }),
}
