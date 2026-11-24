import { describe, expect, test } from 'bun:test'

import { createTeamMemoryTools } from '@/lib/agent/memory-native/tools'
import { createSessionTools } from '@/lib/agent/tools-sessions'
import { createLocalExecTool } from '@/lib/agent/tools-skilled/local-tools'
import {
  ANTIGRAVITY_DECLARATION_BUDGET,
  ANTIGRAVITY_NUPHOS_RESERVE,
  declarationBytes,
} from '@/lib/mcp/declaration-budget'

import { CREDENTIALS_MCP_SURFACE } from '../credentials-mcp'
import { nuphosToolsSurface } from '../nuphos-tools-mcp'

import { toolModuleFromAiSdkTools } from './ai-sdk-adapter'
import { channelToolModule } from './channels'
import { decisionToolModule } from './decisions'
import { kubeconfigToolModule } from './kubeconfig'
import { threadToolModule } from './threads'

import { ANTIGRAVITY_TOOLS, toolModulesForRuntime } from './index'

import type { McpToolDeclaration } from '@/lib/mcp/declaration-budget'

const turn = { userId: 'u', teamId: 't', sessionId: 's', origin: 'user' as const }

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
  definitions.map((definition) => (definition as { name: string }).name)

function asDeclarations(definitions: readonly unknown[]): McpToolDeclaration[] {
  return definitions.map((definition) => {
    const { name, description, inputSchema } = definition as McpToolDeclaration

    return { name, description, inputSchema }
  })
}

function measuredBytes(): number {
  const { instructions, toolDefinitions } = nuphosToolsSurface(
    toolModulesForRuntime(modules(), 'antigravity'),
    'antigravity',
  )

  return (
    declarationBytes(asDeclarations(toolDefinitions)) +
    declarationBytes(asDeclarations(CREDENTIALS_MCP_SURFACE.toolDefinitions)) +
    Buffer.byteLength(instructions) +
    Buffer.byteLength(CREDENTIALS_MCP_SURFACE.instructions)
  )
}

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

  test('get instructions that name only the tools they keep', () => {
    const all = names(nuphosToolsSurface(modules()).toolDefinitions)
    const { instructions } = nuphosToolsSurface(
      toolModulesForRuntime(modules(), 'antigravity'),
      'antigravity',
    )

    expect(
      all.filter((name) => instructions.includes(name) && !ANTIGRAVITY_TOOLS.has(name)),
    ).toEqual([])
    expect(nuphosToolsSurface(modules(), 'codex').instructions).toContain('render_artifact')
  })

  test('fit in its tool budget with both servers instructions', () => {
    const measured = measuredBytes()

    expect(measured).toBeLessThanOrEqual(ANTIGRAVITY_NUPHOS_RESERVE)
    expect(measured).toBeLessThanOrEqual(ANTIGRAVITY_DECLARATION_BUDGET)
  })
})
