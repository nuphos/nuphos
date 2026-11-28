// `local_cua` drives Computer Use on the owner's Mac from any runtime, one call
// per device tunnel stream, the way `local_exec` relays a command. An `action`
// runs on Nuphos's own screen host (mac-screen-host.swift), in Desktop and the
// CLI. `code` runs in the Codex App's own `cua_repl` where that App is
// installed; the App asks before it touches each app, and each prompt becomes
// an approval card that parks the turn like any other decision.
import { createDeviceToolHandler } from './device-tool'

import type { PreviewToolContext, PreviewToolModule } from '../preview-tool-context'
import type { DeviceTool, DeviceToolDeps } from './device-tool'

export type LocalCuaDeps = DeviceToolDeps

type Args = { code?: string; action?: string; title?: string; timeout_ms?: number; device?: string }

/** The arguments a built-in action carries to the device, as the screen host reads them. */
const ACTION_FIELDS = [
  'action',
  'x',
  'y',
  'button',
  'clicks',
  'text',
  'key',
  'scroll_x',
  'scroll_y',
]

const cuaTool: DeviceTool = {
  name: 'local_cua',
  label: 'Computer Use',
  purpose: 'cua',
  invalid: (raw) => {
    const { code, action } = raw as Args

    return (typeof code === 'string' && code.trim() !== '') !== (typeof action === 'string')
      ? undefined
      : 'Pass either action or code.'
  },
  frame: (raw) => {
    const args = raw as Args

    if (args.action)
      return {
        action: Object.fromEntries(
          ACTION_FIELDS.flatMap((key) => (key in raw ? [[key, raw[key]]] : [])),
        ),
      }

    return {
      code: args.code,
      ...(args.title ? { title: args.title } : {}),
      ...(args.timeout_ms ? { timeoutMs: args.timeout_ms } : {}),
    }
  },
  audit: (args) =>
    `[computer-use] ${typeof args.code === 'string' ? args.code : JSON.stringify(args)}`,
  errorReason: 'computer_use_error',
  noDevice:
    'No local device is usable in this conversation. Either no Mac is selected in its credential selector, or the selected one is offline: Nuphos Desktop must be open and signed in on it, with local exec allowed. list_credentials shows which.',
  unsupported:
    'The device disconnected or does not support Computer Use (it needs Nuphos Desktop or the nuphos CLI on macOS).',
}

const definition = {
  name: 'local_cua',
  description:
    "Control native apps and browsers on the user's Mac with Computer Use: take screenshots, click, type, press keys, scroll. " +
    'Use `action`, built into Nuphos Desktop and the nuphos CLI on macOS: start with `screenshot`; x and y are points in that screenshot. ' +
    'An older Nuphos cannot run `action` and answers with an error about the Codex App or `code`: ask the user to update Nuphos on that Mac. ' +
    "Alternatively, `code` runs JavaScript in the Codex App's `cua_repl` when that App's Computer Use is installed on the device; bindings persist between calls for about a minute of idleness, `await cua.getState()` documents its API, and the user approves each app the first time. " +
    'Prefer local_exec, a CLI, or an API when one can do the job, and your own native Computer Use tool when you have one; use this only for work that needs the GUI.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['screenshot', 'click', 'type', 'key', 'scroll', 'list_apps'],
        description:
          'screenshot: the main display. click: at x, y. type: text. key: a key or combination such as "return" or "cmd+shift+t". scroll: scroll_y/scroll_x steps at x, y. list_apps: running apps and their windows.',
      },
      x: { type: 'integer', description: 'Point in the screenshot (click, scroll).' },
      y: { type: 'integer', description: 'Point in the screenshot (click, scroll).' },
      button: { type: 'string', enum: ['left', 'right'], description: 'click: defaults to left.' },
      clicks: { type: 'integer', minimum: 1, maximum: 3, description: 'click: 2 double-clicks.' },
      text: { type: 'string', description: 'type: the text to type.' },
      key: { type: 'string', description: 'key: e.g. "escape", "cmd+c", "f5".' },
      scroll_y: { type: 'integer', description: 'scroll: steps, positive scrolls down.' },
      scroll_x: { type: 'integer', description: 'scroll: steps, positive scrolls right.' },
      code: {
        type: 'string',
        description: "Instead of action: JavaScript for the Codex App's `cua` API.",
      },
      title: {
        type: 'string',
        maxLength: 80,
        description: 'Short description of what the call does.',
      },
      timeout_ms: {
        type: 'integer',
        minimum: 1,
        description: 'Execution timeout for code; defaults to 30000.',
      },
      device: {
        type: 'string',
        description:
          'deviceId to run on. Omit it when only one device is available; otherwise the error lists the current device ids.',
      },
    },
    additionalProperties: false,
  },
}

export function createLocalCuaHandler(ctx: PreviewToolContext, deps?: LocalCuaDeps) {
  return createDeviceToolHandler(ctx, cuaTool, deps)
}

export const localCuaToolModule: PreviewToolModule = {
  definitions: [definition],
  handlers: (ctx) => ({ local_cua: createLocalCuaHandler(ctx) }),
}
