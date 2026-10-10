// The Nuphos native tools exposed to the Claude Code runtime, assembled per
// conversation from the same factories the classic agent uses.
import { randomUUID } from 'node:crypto'

import { getConversationMemoryProvider, recordAgentEvent } from '@/lib/agent/db'
import { previewMemoryActivityFrame } from '@/lib/agent/memory-slots/preview-activity'
import { recordPreviewMemoryActivity } from '@/lib/agent/memory-slots/preview-activity-store'
import { createMemoryObserver, resolveTurnFromStamp } from '@/lib/agent/memory-slots/runtime'
import { createTurnMemoryAccumulator } from '@/lib/agent/memory-slots/turn-accumulator'
import { listActivePlansForConversation } from '@/lib/agent/plans'
import { createSessionTools } from '@/lib/agent/tools-sessions'
import { createChartTool } from '@/lib/agent/tools-skilled/chart-tool'

import { publishPreviewFrame } from '../run-frame-bridge'

import { toolModuleFromAiSdkTools } from './ai-sdk-adapter'
import { connectorToolModule } from './connectors'
import { decisionToolModule } from './decisions'
import { kubeconfigToolModule } from './kubeconfig'
import { localExecToolModule } from './local-exec'
import { skillToolSet } from './skills'
import { slackPreviewToolModule } from './slack'
import { sessionResourceToolModule } from './session-resources'
import { threadToolModule } from './threads'

import type { PreviewToolContext, PreviewToolModule } from '../preview-tool-context'
import type { MemoryTool } from '@/lib/agent/memory-slots/types'

async function settleActivity(tasks: Promise<unknown>[]): Promise<void> {
  try {
    await Promise.all(tasks)
  } catch {
    // Activity is telemetry/provenance. A failed side channel must not turn a
    // successful provider tool call into an MCP error.
    return
  }
}

async function memoryTools(ctx: PreviewToolContext): Promise<Record<string, unknown>> {
  const resolution = await resolveTurnFromStamp({
    readStamp: () => getConversationMemoryProvider(ctx.sessionId),
    lazyStamp: () => {},
    team: { teamId: ctx.teamId },
  })

  if (resolution.kind !== 'active' || !resolution.provider.tools) return {}
  const pendingActivity = new Set<Promise<void>>()
  const publishActivity = (
    activity: 'fetched' | 'saved',
    event: Parameters<typeof recordPreviewMemoryActivity>[3],
  ) => {
    // Autonomous/runtime-background MCP calls have no chat turn to attribute.
    // Their ordinary saved UI frame still comes from the local accumulator.
    if (!ctx.turnKey) return
    const pending = settleActivity([
      publishPreviewFrame(ctx, previewMemoryActivityFrame(activity, event)),
      recordPreviewMemoryActivity(ctx.sessionId, ctx.turnKey, activity, event),
    ])

    pendingActivity.add(pending)
    void pending.finally(() => pendingActivity.delete(pending))
  }
  const accumulator = createTurnMemoryAccumulator({
    providerId: resolution.providerId,
    sessionId: ctx.sessionId,
    userId: ctx.userId,
    teamId: ctx.teamId,
    requestId: `mcp-${randomUUID()}`,
    emitFrame: (frame) => {
      void publishPreviewFrame(ctx, frame).catch(() => null)
    },
    recordEvent: recordAgentEvent,
  })
  const observer = createMemoryObserver({
    providerId: resolution.providerId,
    sinks: {
      saved: (event) => {
        accumulator.observer.saved(event)
        publishActivity('saved', event)
      },
      fetched: (event) => {
        accumulator.observer.fetched(event)
        publishActivity('fetched', event)
      },
      // Search telemetry has no turn-finalizer state; record it once on the
      // MCP replica rather than relaying and duplicating the event.
      searched: (event) => {
        accumulator.observer.searched(event)
      },
    },
  })

  const tools = resolution.provider.tools.create({
    userId: ctx.userId,
    teamId: ctx.teamId,
    conversationId: ctx.sessionId,
    origin: 'user',
    observer,
    getActivePlanId: async () => {
      try {
        const plans = await listActivePlansForConversation(ctx.sessionId, {
          teamId: ctx.teamId,
          userId: ctx.userId,
        })

        if (plans.length !== 1) return null
        const [plan] = plans

        return plan ? String(plan.number) : null
      } catch {
        return null
      }
    },
  })

  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [name, flushMemoryActivity(tool, pendingActivity)]),
  )
}

/** Provider observers are synchronous by SPI contract. Hold the MCP result
 * until every activity frame they started has reached the hosting turn, so
 * the finalizer cannot snapshot attribution first. */
function flushMemoryActivity(tool: MemoryTool, pending: Set<Promise<void>>): MemoryTool {
  const execute = tool.execute

  if (!execute) return tool

  return {
    ...tool,
    execute: async (input, options) => {
      try {
        const output: unknown = await execute(input, options)

        return output
      } finally {
        await Promise.all(pending)
      }
    },
  }
}

/** Every AI SDK tool set the preview adapts, keyed by group for the report. */
export async function previewAiSdkToolSets(
  ctx: PreviewToolContext,
): Promise<Record<string, Record<string, unknown>>> {
  const [memory, skills] = await Promise.all([memoryTools(ctx), skillToolSet(ctx)])

  return {
    memory,
    skills,
    chart: { render_chart: createChartTool() },
    sessions: createSessionTools(ctx.userId, ctx.sessionId, ctx.teamId),
  }
}

type ModuleFactory = (ctx: PreviewToolContext) => Promise<PreviewToolModule>

// Modules with their own blocking/side-channel semantics, beyond the plain
// AI SDK adaptation above.
const EXTRA_MODULES: ModuleFactory[] = [
  () => Promise.resolve(sessionResourceToolModule()),
  () => Promise.resolve(threadToolModule()),
  (ctx) => Promise.resolve(connectorToolModule(ctx)),
  () => Promise.resolve(decisionToolModule()),
  () => Promise.resolve(kubeconfigToolModule()),
  slackPreviewToolModule,
  localExecToolModule,
]

export async function previewToolModules(ctx: PreviewToolContext): Promise<PreviewToolModule[]> {
  const [sets, extras] = await Promise.all([
    previewAiSdkToolSets(ctx),
    Promise.all(EXTRA_MODULES.map((factory) => factory(ctx))),
  ])

  return [
    ...Object.values(sets)
      .filter((tools) => Object.keys(tools).length > 0)
      .map((tools) => toolModuleFromAiSdkTools(tools)),
    ...extras,
  ]
}
