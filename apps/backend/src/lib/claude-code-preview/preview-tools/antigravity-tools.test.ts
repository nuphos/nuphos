import { describe, expect, test } from 'bun:test'

import { createTeamMemoryTools } from '@/lib/agent/memory-native/tools'
import { createSessionTools } from '@/lib/agent/tools-sessions'
import { createLocalExecTool } from '@/lib/agent/tools-skilled/local-tools'

import { CREDENTIALS_MCP_SURFACE } from '../credentials-mcp'
import { NUPHOS_TOOLS_INSTRUCTIONS, nuphosToolsSurface } from '../nuphos-tools-mcp'

import { toolModuleFromAiSdkTools } from './ai-sdk-adapter'
import { channelToolModule } from './channels'
import { decisionToolModule } from './decisions'
import { kubeconfigToolModule } from './kubeconfig'
import { threadToolModule } from './threads'

import { ANTIGRAVITY_TOOLS, toolModulesForRuntime } from './index'

type Definition = { name: string; description?: string; inputSchema?: unknown }

// Antigravity's measured budget is about 33.8 KB for every MCP server's tools and,
// probably, their instructions (#4148). Counting plain bytes overstates its cost, so
// 32 KiB leaves room for per-turn text such as the device list.
const ANTIGRAVITY_BUDGET = 32 * 1024

const turn = { userId: 'u', teamId: 't', sessionId: 's', origin: 'user' as const }

// The real factories behind the tools Antigravity keeps, and some it drops.
function modules() {
  return [
    toolModuleFromAiSdkTools(
      createTeamMemoryTools({ userId: 'u', teamId: 't', conversationId: 's' }),
    ),
    toolModuleFromAiSdkTools(createSessionTools('u', 's', 't')),
    toolModuleFromAiSdkTools({
      local_exec: createLocalExecTool(
        [{ deviceId: 'mac', label: 'MacBook', ownerUserId: 'u' }],
        turn,
      ),
    }),
    threadToolModule(),
    channelToolModule(),
    decisionToolModule(),
    kubeconfigToolModule(),
  ]
}

const names = (definitions: readonly unknown[]) =>
  definitions.map((definition) => (definition as Definition).name)

const bytes = (definitions: readonly unknown[]) =>
  definitions.reduce<number>((sum, definition) => {
    const { name, description, inputSchema } = definition as Definition

    return sum + Buffer.byteLength(JSON.stringify({ name, description, inputSchema }))
  }, 0)

describe('Antigravity tools', () => {
  test('keep only the allowlist, and only for Antigravity', () => {
    const all = nuphosToolsSurface(modules()).toolDefinitions
    const kept = nuphosToolsSurface(toolModulesForRuntime(modules(), 'antigravity'))

    expect(new Set(names(kept.toolDefinitions))).toEqual(new Set(ANTIGRAVITY_TOOLS))
    expect(
      names(nuphosToolsSurface(toolModulesForRuntime(modules(), 'codex')).toolDefinitions),
    ).toEqual(names(all))
    expect(names(nuphosToolsSurface(toolModulesForRuntime(modules())).toolDefinitions)).toEqual(
      names(all),
    )
  })

  test('fit in its tool budget with both servers instructions', () => {
    const { toolDefinitions } = nuphosToolsSurface(toolModulesForRuntime(modules(), 'antigravity'))
    const total =
      bytes(toolDefinitions) +
      bytes(CREDENTIALS_MCP_SURFACE.toolDefinitions) +
      Buffer.byteLength(NUPHOS_TOOLS_INSTRUCTIONS) +
      Buffer.byteLength(CREDENTIALS_MCP_SURFACE.instructions ?? '')

    expect(total).toBeLessThanOrEqual(ANTIGRAVITY_BUDGET)
  })
})
