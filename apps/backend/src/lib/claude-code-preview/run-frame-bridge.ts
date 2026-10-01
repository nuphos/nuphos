// Delivers UI frames from MCP tool handlers into a conversation's active run.
// The pod's MCP call can land on any backend replica while the run (and its
// SSE stream) lives on one: a local run is appended directly, anything else is
// published on a Redis channel the hosting replica subscribes to for the
// duration of the preview turn.
import { getSubscriber, redisEnabled, withRedis } from '@/lib/redis'

import type { PublishPreviewFrame } from './preview-tool-context'
import type { AgentRun } from '@/routes/agent/types'

export type RunHost = {
  findLocalRun(userId: string, sessionId: string): AgentRun | null
  appendFrame(run: AgentRun, sseFrame: string): void
  /** The session's active run on any replica. */
  findActiveStreamId?(userId: string, sessionId: string): Promise<string | null>
}

export type PreviewFrameConsumer = (frame: Record<string, unknown>) => boolean

// The run modules sit in a routes/agent import cycle that only resolves when
// entered from the routes side; loading them lazily keeps this lib-side entry
// point out of it.
async function defaultRunHost(): Promise<RunHost> {
  const [frames, registry, runStore] = await Promise.all([
    import('@/routes/agent/run-frames'),
    import('@/routes/agent/run-registry'),
    import('@/lib/agent/run-store'),
  ])

  return {
    findLocalRun(userId, sessionId) {
      let latest: AgentRun | null = null

      for (const run of registry.agentRuns.values()) {
        if (run.userId !== userId || run.sessionId !== sessionId || run.done) continue
        if (!latest || run.createdAt > latest.createdAt) latest = run
      }

      return latest
    },
    appendFrame: frames.appendAgentRunFrame,
    async findActiveStreamId(userId, sessionId) {
      return (await runStore.getActiveAgentRunForSession(userId, sessionId))?.streamId ?? null
    },
  }
}

export function previewFrameChannel(userId: string, sessionId: string): string {
  return `atlas:preview-frames:${userId}:${sessionId}`
}

export function createPreviewFrameBridge(host: () => Promise<RunHost>) {
  const consumers = new Map<string, PreviewFrameConsumer>()
  const publishPreviewFrame: PublishPreviewFrame = async (ctx, frame) => {
    const runs = await host()
    const runOwnerUserId = ctx.conversationOwnerUserId ?? ctx.userId
    const run = runs.findLocalRun(runOwnerUserId, ctx.sessionId)

    if (run) {
      if (consumers.get(run.key)?.(frame)) return
      runs.appendFrame(run, `data: ${JSON.stringify(frame)}\n\n`)

      return
    }
    await withRedis((client) =>
      client.publish(previewFrameChannel(runOwnerUserId, ctx.sessionId), JSON.stringify(frame)),
    )
  }

  /** The stream of the run a tool call belongs to: the client that started it owns the call. */
  const previewRunStreamId = async (
    ctx: Parameters<PublishPreviewFrame>[0],
  ): Promise<string | undefined> => {
    const runs = await host()
    const runOwnerUserId = ctx.conversationOwnerUserId ?? ctx.userId
    const local = runs.findLocalRun(runOwnerUserId, ctx.sessionId)

    if (local) return local.streamId
    const remote = await runs.findActiveStreamId?.(runOwnerUserId, ctx.sessionId).catch(() => null)

    return remote ?? undefined
  }

  /**
   * Subscribe the replica hosting `run` to frames published elsewhere for this
   * conversation. Returns the unsubscribe; call it when the turn ends.
   */
  const bindPreviewRunFrameBridge = (
    run: AgentRun,
    userId: string,
    sessionId: string,
    consumeFrame?: PreviewFrameConsumer,
  ) => {
    if (consumeFrame) consumers.set(run.key, consumeFrame)
    const clearConsumer = () => {
      if (consumeFrame && consumers.get(run.key) === consumeFrame) consumers.delete(run.key)
    }

    if (!redisEnabled()) return clearConsumer
    const channel = previewFrameChannel(userId, sessionId)
    const subscriber = getSubscriber()
    const onMessage = (incoming: string, message: string) => {
      if (incoming !== channel || run.done) return
      void host().then((runs) => {
        if (run.done) return
        try {
          const frame = JSON.parse(message) as Record<string, unknown>

          if (consumers.get(run.key)?.(frame)) return
        } catch {
          // Invalid bridge payloads retain the old behavior and reach the run;
          // the ordinary SSE parser will surface or ignore them as before.
        }
        runs.appendFrame(run, `data: ${message}\n\n`)
      })
    }

    subscriber.on('message', onMessage)
    void subscriber.subscribe(channel).catch(() => {
      // Only cross-replica frames are lost without the subscription; the turn is unaffected.
    })

    return () => {
      clearConsumer()
      subscriber.off('message', onMessage)
      void subscriber.unsubscribe(channel).catch(() => {})
    }
  }

  return { publishPreviewFrame, previewRunStreamId, bindPreviewRunFrameBridge }
}

export const { publishPreviewFrame, previewRunStreamId, bindPreviewRunFrameBridge } =
  createPreviewFrameBridge(defaultRunHost)
