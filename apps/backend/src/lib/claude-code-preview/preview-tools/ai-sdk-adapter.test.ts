import { describe, expect, test } from 'bun:test'
import { tool } from 'ai'
import { z } from 'zod'

import { toolInputJsonSchema, toolModuleFromAiSdkTools } from './ai-sdk-adapter'

import type { PreviewToolContext } from '../preview-tool-context'

const ctx: PreviewToolContext = {
  userId: 'user-1',
  teamId: 'team-1',
  sessionId: 'conv-1',
  locale: 'zh-TW',
}

function capture() {
  const frames: Record<string, unknown>[] = []

  return {
    frames,
    publish: (_ctx: unknown, frame: Record<string, unknown>) => {
      frames.push(frame)

      return Promise.resolve()
    },
  }
}

describe('toolInputJsonSchema', () => {
  test('converts a zod object to a plain JSON Schema object', () => {
    const schema = toolInputJsonSchema(
      z.object({ label: z.string().describe('intent'), count: z.number().int().optional() }),
    )

    expect(schema.type).toBe('object')
    expect(schema.properties).toMatchObject({
      label: { type: 'string', description: 'intent' },
      count: { type: 'integer' },
    })
    expect(schema).not.toHaveProperty('$schema')
    expect(schema.required).toEqual(['label'])
  })

  test('falls back to an empty object schema for unknown shapes', () => {
    expect(toolInputJsonSchema(undefined)).toEqual({ type: 'object', properties: {} })
  })
})

describe('toolModuleFromAiSdkTools', () => {
  test('advertises definitions and publishes the classic frame pair per call', async () => {
    const { frames, publish } = capture()
    const module = toolModuleFromAiSdkTools(
      {
        cost_panel_create: tool({
          description: 'Create a cost panel',
          inputSchema: z.object({ label: z.string(), title: z.string() }),
          execute: async ({ title }) => ({ panelId: 'p1', title }),
        }),
        not_a_tool: { description: 'no execute' },
      },
      { publish },
    )

    expect(module.definitions.map((d) => (d as { name: string }).name)).toEqual([
      'cost_panel_create',
    ])

    const result = await module.handlers(ctx).cost_panel_create!({
      label: '建立成本面板',
      title: 'EKS spend',
    })

    expect(result.structuredContent).toEqual({ panelId: 'p1', title: 'EKS spend' })
    expect(frames.map((frame) => frame.type)).toEqual([
      'tool-input-available',
      'tool-output-available',
    ])
    expect(frames[0]).toMatchObject({
      toolName: 'cost_panel_create',
      input: { label: '建立成本面板', title: 'EKS spend' },
    })
    expect(frames[0]!.toolCallId).toBe(frames[1]!.toolCallId)
    expect(frames[1]).toMatchObject({ output: { panelId: 'p1', title: 'EKS spend' } })
  })

  test('maps a thrown execute into a tool error and an error frame', async () => {
    const { frames, publish } = capture()
    const module = toolModuleFromAiSdkTools(
      {
        arch_add_node: tool({
          description: 'Add a node',
          inputSchema: z.object({ label: z.string() }),
          execute: async (): Promise<unknown> => {
            throw new Error('diagram is locked')
          },
        }),
      },
      { publish },
    )

    const result = await module.handlers(ctx).arch_add_node!({ label: '新增節點' })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe('diagram is locked')
    expect(frames.at(-1)).toMatchObject({
      type: 'tool-output-error',
      errorText: 'diagram is locked',
    })
  })

  test('validates MCP arguments with the AI SDK tool schema before execute', async () => {
    const { frames, publish } = capture()
    let executed = false
    const module = toolModuleFromAiSdkTools(
      {
        save_memory: tool({
          inputSchema: z.object({ scope: z.enum(['personal', 'team']) }),
          execute: () => {
            executed = true

            return Promise.resolve({ ok: true })
          },
        }),
      },
      { publish },
    )

    const result = await module.handlers(ctx).save_memory!({})

    expect(result.isError).toBe(true)
    expect(executed).toBe(false)
    expect(frames.at(-1)?.type).toBe('tool-output-error')
  })
})
