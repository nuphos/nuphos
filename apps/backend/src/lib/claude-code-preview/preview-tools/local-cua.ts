// `local_cua` drives Computer Use on the owner's Mac from any runtime. The
// Codex App's own `cua_repl` runs there; Desktop relays one call per device
// tunnel stream, the way `local_exec` relays a command. The App asks before it
// touches each app; each prompt becomes an approval card that parks the turn
// like any other decision, so a cloud runtime gets the same consent as a local
// Codex turn.
import { createDeviceToolHandler } from './device-tool'

import type { PreviewToolContext, PreviewToolModule } from '../preview-tool-context'
import type { DeviceTool, DeviceToolDeps } from './device-tool'

export type LocalCuaDeps = DeviceToolDeps

type Args = { code: string; title?: string; timeout_ms?: number; device?: string }

const cuaTool: DeviceTool = {
  name: 'local_cua',
  label: 'Computer Use',
  purpose: 'cua',
  invalid: (raw) => {
    const { code } = raw as Args

    return typeof code === 'string' && code.trim() ? undefined : 'code is required.'
  },
  frame: (raw) => {
    const args = raw as Args

    return {
      code: args.code,
      ...(args.title ? { title: args.title } : {}),
      ...(args.timeout_ms ? { timeoutMs: args.timeout_ms } : {}),
    }
  },
  audit: (args) => `[computer-use] ${String(args.code)}`,
  errorReason: 'computer_use_error',
  noDevice:
    'No local device is usable in this conversation. Either no Mac is selected in its credential selector, or the selected one is offline: Nuphos Desktop must be open and signed in on it, with local exec allowed. list_credentials shows which.',
  unsupported:
    'The device disconnected or does not support Computer Use (it needs Nuphos Desktop on macOS).',
}

const definition = {
  name: 'local_cua',
  description:
    "Control native apps and browsers on the user's Mac with Computer Use: read UI state, take screenshots, click, type. " +
    "It runs JavaScript in the Codex App's `cua_repl` on that device; bindings persist between calls in this conversation until about a minute of idleness. " +
    'Start with exactly one entry call, e.g. `await cua.getState()` or `let app = await cua.getApp("Finder")`; its result documents the full API. ' +
    'The user approves each app the first time; a denied approval returns an error. ' +
    'Prefer local_exec, a CLI, or an API when one can do the job, and your own native Computer Use tool when you have one; use this only for work that needs the GUI.',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript to run with the initialized `cua` API.' },
      title: {
        type: 'string',
        maxLength: 80,
        description: 'Short description of what the code does.',
      },
      timeout_ms: {
        type: 'integer',
        minimum: 1,
        description: 'Execution timeout; defaults to 30000.',
      },
      device: {
        type: 'string',
        description:
          'deviceId to run on. Omit it when only one device is available; otherwise the error lists the current device ids.',
      },
    },
    required: ['code'],
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
