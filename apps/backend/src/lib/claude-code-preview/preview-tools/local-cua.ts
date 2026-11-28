// `local_cua` drives Computer Use on the owner's Mac from any runtime: a tool of
// the Cua Driver that Nuphos Desktop and the CLI bundle, or JavaScript in the
// Codex App's own `cua_repl` where that App is installed. Desktop relays one
// call per device tunnel stream, the way `local_exec` relays a command. A
// prompt asking before it touches an app becomes an approval card that parks
// the turn like any other decision, so a cloud runtime gets the same consent as
// a local Codex turn.
import { createDeviceToolHandler } from './device-tool'

import type { PreviewToolContext, PreviewToolModule } from '../preview-tool-context'
import type { DeviceTool, DeviceToolDeps } from './device-tool'

export type LocalCuaDeps = DeviceToolDeps

type Args = {
  tool?: string
  arguments?: Record<string, unknown>
  code?: string
  title?: string
  timeout_ms?: number
  device?: string
}

const given = (value: unknown) => typeof value === 'string' && value.trim() !== ''

const cuaTool: DeviceTool = {
  name: 'local_cua',
  label: 'Computer Use',
  purpose: 'cua',
  invalid: (raw) => {
    const { tool, code } = raw as Args

    return [tool, code].filter(given).length === 1 ? undefined : 'Pass either tool or code.'
  },
  frame: (raw) => {
    const args = raw as Args

    if (given(args.tool)) return { tool: args.tool, arguments: args.arguments ?? {} }

    return {
      code: args.code,
      ...(args.title ? { title: args.title } : {}),
      ...(args.timeout_ms ? { timeoutMs: args.timeout_ms } : {}),
    }
  },
  audit: (args) =>
    `[computer-use] ${args.tool ? `${String(args.tool)} ${JSON.stringify(args.arguments ?? {})}` : String(args.code)}`,
  errorReason: 'computer_use_error',
  noDevice:
    'No local device is usable in this conversation. Either no Mac is selected in its credential selector, or the selected one is offline: Nuphos Desktop must be open and signed in on it, with local exec allowed. list_credentials shows which.',
  unsupported:
    'The device disconnected or does not support Computer Use (it needs Nuphos Desktop or the Nuphos CLI on macOS).',
}

const definition = {
  name: 'local_cua',
  description:
    "Control native apps and browsers on the user's Mac with Computer Use: read UI state, take screenshots, click, type. " +
    'Pass `tool` and `arguments` to call one tool of the Cua Driver built into Nuphos on that device. ' +
    'Start with `get_guide` (no arguments) for the workflow and tool list, then e.g. `list_apps`, `get_window_state` {pid, window_id}, `click`, `type_text`, `press_key`; `run_steps` batches several actions in one call. ' +
    "Pass `code` instead only to run JavaScript in the ChatGPT/Codex App's `cua_repl` when that App is installed there; start with `await cua.getState()`, whose result documents its API. " +
    'It needs the same access to the device as local_exec. ' +
    'macOS asks the user once to grant Nuphos Screen Recording and Accessibility; an approval the user denies returns an error. ' +
    'A Nuphos too old to bundle the Cua Driver answers a `tool` call as if no code was given (usually that Computer Use is not installed) or cannot serve it at all; then ask the user to update Nuphos. ' +
    'Prefer local_exec, a CLI, or an API when one can do the job, and your own native Computer Use tool when you have one; use this only for work that needs the GUI.',
  inputSchema: {
    type: 'object',
    properties: {
      tool: { type: 'string', description: 'Cua Driver tool to call, e.g. get_guide or click.' },
      arguments: { type: 'object', description: "The tool's arguments." },
      code: {
        type: 'string',
        description: 'Instead of tool: JavaScript for the Codex App’s initialized `cua` API.',
      },
      title: {
        type: 'string',
        maxLength: 80,
        description: 'With code: short description of what the code does.',
      },
      timeout_ms: {
        type: 'integer',
        minimum: 1,
        description: 'With code: execution timeout; defaults to 30000.',
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
