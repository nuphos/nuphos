import { describe, expect, test } from 'bun:test'

import { createArtifactTool } from '@/lib/agent/tools-skilled/artifact-tool'
import { handleOpenAbPermissionRequest } from '@/lib/claude-code-preview/openab-permission-bridge'
import { parseToolUpdate } from '@/lib/claude-code-preview/preview-agent-update'
import {
  TOOL_PRESENTATION,
  TOOL_PRESENTATION_FRAME,
} from '@/lib/claude-code-preview/preview-tool-presentation'
import { toolModuleFromAiSdkTools } from '@/lib/claude-code-preview/preview-tools/ai-sdk-adapter'
import { createPreviewAssistantPartAccumulator } from '@/lib/claude-code-preview/preview-transcript'

import { createPreviewToolLog } from './chat-preview-tool-log'
import { consumePreviewToolPresentation, handlePreviewToolUpdate } from './chat-preview-tool-update'

const input = { label: 'Inspect synthetic fixture' }
const context = { userId: 'synthetic', teamId: 'synthetic', sessionId: 'synthetic', locale: 'en' }

function harness() {
  const log = createPreviewToolLog()
  const frames: Record<string, unknown>[] = []
  const order = createPreviewAssistantPartAccumulator()
  const emit = (frame: Record<string, unknown>) => {
    frames.push(frame)
  }
  const update = (id: string, payload: Record<string, unknown>) => {
    const parsed = parseToolUpdate(id, payload)

    if (parsed.kind !== 'tool') throw new Error('expected tool')
    handlePreviewToolUpdate(emit, log, parsed)
    order.appendTool(id)
  }
  const start = (id: string) =>
    update(id, {
      title: 'mcp.nuphos-tools.local_exec',
      status: 'in_progress',
      rawInput: { server: 'nuphos-tools', tool: 'local_exec', arguments: input },
    })
  const publish = async (_: unknown, frame: Record<string, unknown>) => {
    if (!consumePreviewToolPresentation(emit, log, frame)) emit(frame)
  }

  return { log, frames, emit, update, start, publish, history: () => order.materialize(log.list()) }
}

function visibleIds(frames: Record<string, unknown>[]) {
  return [
    ...new Set(frames.filter((f) => typeof f.toolCallId === 'string').map((f) => f.toolCallId)),
  ]
}

describe('runtime-owned MCP presentation', () => {
  test.each([false, true])(
    'one execute and one ACP id with revealed permission=%s',
    async (permission) => {
      const h = harness()

      h.start('acp-1')
      if (permission)
        handlePreviewToolUpdate(h.emit, h.log, {
          kind: 'tool',
          toolCallId: 'acp-1',
          title: 'OpenAB tool request',
          status: 'pending',
          revealed: true,
        })
      let calls = 0
      const module = toolModuleFromAiSdkTools(
        {
          local_exec: {
            execute: async () => {
              calls++

              return { stdout: 'synthetic' }
            },
          },
        },
        { publish: h.publish },
      )
      const result = await module.handlers(context).local_exec!(input)

      h.update('acp-1', { status: 'completed', rawOutput: { result, error: null } })
      expect(calls).toBe(1)
      expect(visibleIds(h.frames)).toEqual(['acp-1'])
      expect(h.frames.at(-1)).toEqual({
        type: 'tool-output-available',
        toolCallId: 'acp-1',
        output: { stdout: 'synthetic' },
      })
      expect(h.history()).toHaveLength(1)
      expect(h.history()[0]).toMatchObject({
        toolCallId: 'acp-1',
        type: 'tool-local_exec',
        output: { stdout: 'synthetic' },
      })
    },
  )

  test('parallel identical labels stay independent, reverse completion and replay retain both ids', async () => {
    const h = harness()

    h.start('acp-a')
    h.start('acp-b')
    let calls = 0
    const module = toolModuleFromAiSdkTools(
      { local_exec: { execute: async () => ({ count: ++calls }) } },
      { publish: h.publish },
    )
    const a = await module.handlers(context).local_exec!(input)
    const b = await module.handlers(context).local_exec!(input)

    h.update('acp-b', { status: 'completed', rawOutput: { result: b } })
    h.update('acp-a', { status: 'completed', rawOutput: { result: a } })
    h.update('acp-a', { status: 'completed', rawOutput: { result: a } })
    expect(calls).toBe(2)
    expect(visibleIds(h.frames)).toEqual(['acp-a', 'acp-b'])
    expect(h.history()).toHaveLength(2)
    expect(h.log.list().map((s) => s.output)).toEqual([{ count: 1 }, { count: 2 }])
  })

  test('handler frames arriving early or lost both leave the ACP card as the only one', async () => {
    for (const lost of [false, true]) {
      const h = harness()
      const module = toolModuleFromAiSdkTools(
        { local_exec: { execute: async () => 'ok' } },
        {
          publish: lost
            ? async () => {
                throw new Error('synthetic bridge failure')
              }
            : h.publish,
        },
      )
      const result = await module.handlers(context).local_exec!(input)

      h.start('acp-1')
      h.update('acp-1', { status: 'completed', rawOutput: result })
      expect(visibleIds(h.frames)).toEqual(['acp-1'])
      expect(h.history()).toHaveLength(1)
      expect(h.log.list()[0]?.output).toBe('ok')
    }
  })

  test('an approval keeps the original card tool type and structured output', async () => {
    const h = harness()

    h.update('chart-call', {
      title: 'mcp.nuphos-tools.render_chart',
      status: 'in_progress',
      rawInput: { server: 'nuphos-tools', tool: 'render_chart', arguments: input },
    })
    handlePreviewToolUpdate(h.emit, h.log, {
      kind: 'tool',
      toolCallId: 'chart-call',
      title: 'OpenAB tool request',
      status: 'pending',
      revealed: true,
    })
    const module = toolModuleFromAiSdkTools(
      {
        render_chart: {
          execute: () => Promise.resolve({ title: 'Synthetic chart', type: 'bar', data: [] }),
        },
      },
      { publish: h.publish },
    )
    const result = await module.handlers(context).render_chart!(input)

    h.update('chart-call', { status: 'completed', rawOutput: result })
    expect(h.frames.find((f) => f.type === 'tool-input-available')?.toolName).toBe('render_chart')
    expect(visibleIds(h.frames)).toEqual(['chart-call'])
    expect(h.history()[0]).toMatchObject({
      type: 'tool-render_chart',
      output: { title: 'Synthetic chart', type: 'bar', data: [] },
    })
  })

  test('a legacy hosting replica still receives a usable standard card pair', async () => {
    const legacyFrames: Record<string, unknown>[] = []
    let calls = 0
    const module = toolModuleFromAiSdkTools(
      {
        local_exec: {
          execute: () => {
            calls++

            return Promise.resolve('legacy-compatible')
          },
        },
      },
      {
        publish: (_ctx, frame) => {
          legacyFrames.push(frame)

          return Promise.resolve()
        },
      },
    )
    const result = await module.handlers(context).local_exec!(input)

    expect(calls).toBe(1)
    expect(legacyFrames.map((f) => f.type)).toEqual([
      'tool-input-available',
      'tool-output-available',
    ])
    expect(visibleIds(legacyFrames)).toHaveLength(1)
    expect(legacyFrames.at(-1)?.output).toBe('legacy-compatible')
    expect(result.structuredContent).toBe('legacy-compatible')
  })

  test('artifact content stays on the canonical input while the model gets a short receipt', async () => {
    const h = harness()
    const artifact = {
      label: 'Show synthetic artifact',
      artifactId: 'synthetic-doc',
      title: 'Synthetic document',
      kind: 'html',
      content: '<html><body>Synthetic</body></html>',
    }

    h.update('artifact-call', {
      title: 'mcp.nuphos-tools.render_artifact',
      status: 'in_progress',
      rawInput: { server: 'nuphos-tools', tool: 'render_artifact', arguments: artifact },
    })
    const module = toolModuleFromAiSdkTools(
      { render_artifact: createArtifactTool() },
      { publish: h.publish },
    )
    const result = await module.handlers(context).render_artifact!(artifact)

    h.update('artifact-call', { status: 'completed', rawOutput: { result } })
    expect(h.frames.find((f) => f.type === 'tool-input-available')).toMatchObject({
      toolName: 'render_artifact',
      input: artifact,
      toolCallId: 'artifact-call',
    })
    expect(h.history()[0]).toMatchObject({ type: 'tool-render_artifact', input: artifact })
    expect(visibleIds(h.frames)).toEqual(['artifact-call'])
    expect(JSON.stringify(result)).not.toContain('<html>')
  })

  test.each([false, true])(
    'a native call earlier in the turn keeps one id live and stored, error=%s',
    async (error) => {
      const h = harness()

      h.update('read-1', {
        title: 'Read Photo.jpg',
        status: 'in_progress',
        rawInput: { path: '/x' },
      })
      h.update('read-1', { status: 'completed', rawOutput: 'ok' })
      h.start('acp-1')
      const module = toolModuleFromAiSdkTools(
        {
          local_exec: {
            execute: () =>
              error ? Promise.reject(new Error('synthetic error')) : Promise.resolve('done'),
          },
        },
        { publish: h.publish },
      )
      const result = await module.handlers(context).local_exec!(input)

      h.update('acp-1', { status: 'completed', rawOutput: { result } })
      expect(visibleIds(h.frames)).toEqual(['read-1', 'acp-1'])
      expect(h.history()).toMatchObject([{ toolCallId: 'read-1' }, { toolCallId: 'acp-1' }])
      expect(h.frames.at(-1)).toMatchObject(
        error
          ? { type: 'tool-output-error', toolCallId: 'acp-1', errorText: 'synthetic error' }
          : { type: 'tool-output-available', toolCallId: 'acp-1', output: 'done' },
      )
    },
  )

  test('an unrecognized ACP call keeps its own id; handler frames never add a second card', async () => {
    const h = harness()

    h.update('opaque-call', {
      title: 'Execute native tool',
      status: 'in_progress',
      rawInput: input,
    })
    const module = toolModuleFromAiSdkTools(
      { render_chart: { execute: () => Promise.resolve({ title: 'Synthetic chart' }) } },
      { publish: h.publish },
    )
    const result = await module.handlers(context).render_chart!(input)

    h.update('opaque-call', { status: 'completed', rawOutput: { result } })
    expect(visibleIds(h.frames)).toEqual(['opaque-call'])
    expect(h.history()).toMatchObject([{ toolCallId: 'opaque-call' }])
    expect(h.frames.some((f) => f.type === TOOL_PRESENTATION_FRAME)).toBe(false)
  })

  test.each([false, true])(
    'an old adapter keeps legacy cards on a new consumer, revealed=%s',
    async (revealed) => {
      const h = harness()

      h.start('legacy-acp')
      if (revealed)
        handlePreviewToolUpdate(h.emit, h.log, {
          kind: 'tool',
          toolCallId: 'legacy-acp',
          title: 'OpenAB tool request',
          status: 'pending',
          revealed: true,
        })
      await h.publish(
        {},
        {
          type: 'tool-input-available',
          toolCallId: 'legacy-handler',
          toolName: 'local_exec',
          input,
        },
      )
      await h.publish(
        {},
        {
          type: 'tool-output-error',
          toolCallId: 'legacy-handler',
          errorText: 'legacy synthetic failure',
        },
      )
      h.update('legacy-acp', {
        status: 'completed',
        rawOutput: {
          result: { isError: true, content: [{ type: 'text', text: 'legacy synthetic failure' }] },
        },
      })
      expect(
        h.frames.some(
          (f) =>
            f.type === 'tool-output-error' &&
            f.toolCallId === 'legacy-handler' &&
            f.errorText === 'legacy synthetic failure',
        ),
      ).toBe(true)
      // Mixed versions retain the old presentation; only two upgraded replicas deduplicate.
      expect(visibleIds(h.frames)).toEqual(
        revealed ? ['legacy-acp', 'legacy-handler'] : ['legacy-handler'],
      )
    },
  )

  test('handler errors remain errors even when ACP reports the MCP request completed', async () => {
    const h = harness()

    h.start('acp-1')
    const module = toolModuleFromAiSdkTools(
      {
        local_exec: {
          execute: async () => {
            throw new Error('synthetic failure')
          },
        },
      },
      { publish: h.publish },
    )
    const result = await module.handlers(context).local_exec!(input)

    h.update('acp-1', { status: 'completed', rawOutput: { result } })
    expect(h.frames.at(-1)).toEqual({
      type: 'tool-output-error',
      toolCallId: 'acp-1',
      errorText: 'synthetic failure',
    })
    expect(h.history()[0]).toMatchObject({ state: 'output-error', errorText: 'synthetic failure' })
  })

  test('ownership is per run, native custom-card tools and unrelated MCP servers stay unchanged', async () => {
    const h = harness()

    await h.publish({}, { type: TOOL_PRESENTATION_FRAME, toolName: 'local_exec', owner: 'runtime' })
    const fresh = harness()

    fresh.start('new-run')
    expect(fresh.frames).toEqual([])
    h.update('native-card', {
      title: 'mcp.nuphos-tools.request_user_decision',
      status: 'in_progress',
      rawInput: { server: 'nuphos-tools', tool: 'request_user_decision', arguments: input },
    })
    expect(h.frames).toEqual([])
    h.update('foreign', {
      title: 'mcp.other.local_exec',
      status: 'completed',
      rawOutput: { _meta: { [TOOL_PRESENTATION]: 'runtime' }, structuredContent: 'do not unwrap' },
    })
    expect(h.log.list().find((s) => s.toolCallId === 'foreign')?.output).toEqual({
      _meta: { [TOOL_PRESENTATION]: 'runtime' },
      structuredContent: 'do not unwrap',
    })
  })
})

describe('approval lifecycle with one runtime card', () => {
  test.each(['full-access', 'approved', 'denied', 'timeout', 'cancelled'])(
    '%s keeps approval discoverable without executing denied calls',
    async (mode) => {
      const h = harness()

      h.start('approved-acp')
      let executions = 0
      let waits = 0
      const outcome = await handleOpenAbPermissionRequest(
        {
          userId: 'synthetic',
          conversationId: 'synthetic',
          request: {
            sessionId: 'runtime',
            toolCall: { toolCallId: 'approved-acp', title: 'OpenAB tool request', rawInput: input },
            options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }],
          },
          emit: h.emit,
          handleTool: (update) => handlePreviewToolUpdate(h.emit, h.log, update),
        },
        {
          getSessionBypass: async () => mode === 'full-access',
          registerWait: async (args) => {
            waits++

            return { ...args, waitId: 'synthetic-wait', createdAt: 1 }
          },
          hasPendingMessages: async () => false,
          awaitDecision: async () => {
            expect(
              h.frames.some(
                (f) => f.type === 'tool-approval-request' && f.toolCallId === 'approved-acp',
              ),
            ).toBe(true)
            if (mode === 'timeout' || mode === 'cancelled')
              return {
                timedOut: true as const,
                reason: mode === 'timeout' ? 'timeout' : 'cancelled',
              }

            return {
              timedOut: false as const,
              decision: {
                payload: { decision: mode === 'approved' ? 'approved' : 'denied' },
                resolvedAt: 2,
              },
            }
          },
        },
      )

      if (outcome.outcome.outcome === 'selected') {
        const module = toolModuleFromAiSdkTools(
          {
            local_exec: {
              execute: async () => {
                executions++

                return 'ok'
              },
            },
          },
          { publish: h.publish },
        )
        const result = await module.handlers(context).local_exec!(input)

        h.update('approved-acp', { status: 'completed', rawOutput: { result } })
        expect(h.log.list()[0]?.output).toBe('ok')
      } else {
        h.update('approved-acp', {
          status: 'failed',
          content: [
            { type: 'content', content: { type: 'text', text: 'adapter echoed cancellation' } },
          ],
        })
        expect(h.log.list()[0]?.errorText).toBe(
          mode === 'timeout'
            ? 'Permission request timed out'
            : mode === 'denied'
              ? 'Permission denied'
              : 'Permission request was cancelled',
        )
      }
      expect(executions).toBe(mode === 'approved' || mode === 'full-access' ? 1 : 0)
      expect(waits).toBe(mode === 'full-access' ? 0 : 1)
      expect(visibleIds(h.frames)).toEqual(['approved-acp'])
      expect(h.history()).toHaveLength(1)
    },
  )
})

describe('Full Access permission requests', () => {
  test('a Nuphos question card is not shown again for its runtime call', async () => {
    const h = harness()
    const question = { category: 'approval', question: 'Send it?', options: ['Send', 'Wait'] }

    h.update('native-question', {
      title: 'mcp.nuphos-tools.request_user_decision',
      status: 'in_progress',
      rawInput: { server: 'nuphos-tools', tool: 'request_user_decision', arguments: question },
    })
    await handleOpenAbPermissionRequest(
      {
        userId: 'synthetic',
        conversationId: 'synthetic',
        request: {
          sessionId: 'runtime',
          toolCall: {
            toolCallId: 'native-question',
            title: 'OpenAB tool request',
            rawInput: question,
          },
          options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }],
        },
        emit: h.emit,
        handleTool: (update) => handlePreviewToolUpdate(h.emit, h.log, update),
      },
      {
        getSessionBypass: async () => true,
        registerWait: () => Promise.reject(new Error('Full Access never waits')),
        awaitDecision: () => Promise.reject(new Error('Full Access never waits')),
      },
    )

    expect(h.frames.filter((f) => f.type === 'tool-input-available')).toEqual([])
  })
})
