import { beforeEach, describe, expect, test } from 'bun:test'

import {
  observeAutonomousUpdates,
  setClaudeCodeAutonomousPermissionHandler,
  setClaudeCodeAutonomousUpdateHandler,
  setClaudeCodeBackgroundToolHandler,
} from './autonomous-session-observer'

import type { OpenAbSessionUpdate } from './openab-acp-client'
import type { OpenAbPermissionHandler } from './openab-acp-session'
import type { TeamSession } from './team-openab-runtime'
import type { ConversationPreviewAttachment } from '@/lib/agent/db/shared'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

let attachment: ConversationPreviewAttachment | null = null

useAgentDb({ getConversationPreviewAttachment: async () => attachment })
beforeEach(() => {
  attachment = { runtimeUrl: 'wss://old/acp', openabSessionId: 'openab-1' }
  setClaudeCodeBackgroundToolHandler(async () => {})
})

const permissionRequest = {
  sessionId: 'openab-1',
  toolCall: { toolCallId: 'tool-1', title: 'Run kubectl delete' },
  options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
}

function sessionHarness(
  provider: 'claude-code' | 'codex' = 'claude-code',
  prompt?: TeamSession['client']['prompt'],
) {
  let observer: ((update: OpenAbSessionUpdate) => void) | undefined
  let permissions: OpenAbPermissionHandler | undefined
  const session = {
    teamId: 'team-1',
    conversationId: 'conversation-1',
    userId: 'user-1',
    conversationOwnerUserId: 'owner-1',
    locale: 'en-US',
    openabSessionId: 'openab-1',
    endpoint: { url: 'wss://old/acp', provider },
    client: {
      cancel: () => {},
      prompt:
        prompt ??
        (() => {
          throw new Error('unexpected autonomous prompt')
        }),
      onSessionUpdate: (_sessionId: string, handler: (update: OpenAbSessionUpdate) => void) => {
        observer = handler

        return () => {}
      },
      onSessionPermission: (_sessionId: string, handler: OpenAbPermissionHandler) => {
        permissions = handler

        return () => {}
      },
    },
  } as unknown as TeamSession

  observeAutonomousUpdates(session)

  return {
    session,
    emit(update: OpenAbSessionUpdate) {
      if (!observer) throw new Error('session observer was not installed')
      observer(update)
    },
    requestPermission(request = permissionRequest) {
      if (!permissions) throw new Error('session permission handler was not installed')

      return permissions(request)
    },
  }
}

describe('autonomous Claude session observation', () => {
  test('runtime completion releases busy without waiting for transcript persistence', async () => {
    let finishPersist: (() => void) | undefined
    const persist = new Promise<void>((resolve) => {
      finishPersist = resolve
    })

    setClaudeCodeAutonomousUpdateHandler((event) =>
      event.update.kind === 'complete' ? persist : undefined,
    )
    const harness = sessionHarness()

    harness.emit({ kind: 'status', status: 'active' })
    harness.emit({ kind: 'text', text: 'Timer fired.' })
    harness.emit({ kind: 'status', status: 'idle' })
    finishPersist?.()
    await persist
    await Bun.sleep(0)
  })

  test('an interruption ends the turn the same way a completion does', async () => {
    const seen: string[] = []

    setClaudeCodeAutonomousUpdateHandler((event) => {
      seen.push(event.update.kind)
    })
    const harness = sessionHarness()

    harness.emit({ kind: 'status', status: 'active' })
    harness.emit({ kind: 'text', text: 'Writing the note…' })
    // The runtime session went away mid-turn: no 'complete' will ever arrive,
    // so without this the session stays busy and blocks the next message.
    harness.emit({ kind: 'interrupted', reason: 'connection_closed' })
    await Bun.sleep(0)
    expect(seen).toEqual(['status', 'text', 'interrupted'])
  })

  test('ignores an ordinary prompt usage update when no autonomous content started', () => {
    let calls = 0

    setClaudeCodeAutonomousUpdateHandler(() => {
      calls++
    })
    const harness = sessionHarness()

    harness.emit({ kind: 'complete', origin: { type: 'user' } })
    expect(calls).toBe(0)
  })

  test('finishes a Codex autonomous turn when its thread returns to idle', async () => {
    const seen: string[] = []

    setClaudeCodeAutonomousUpdateHandler((event) => {
      seen.push(event.update.kind)
    })
    const harness = sessionHarness('codex')

    harness.emit({ kind: 'status', status: 'active' })
    harness.emit({ kind: 'text', text: 'Goal continuation finished.' })
    harness.emit({ kind: 'status', status: 'idle' })
    await Bun.sleep(0)

    expect(seen).toEqual(['status', 'text', 'complete'])
  })

  test('does not let a Codex idle boundary overtake its asynchronous content handler', async () => {
    const seen: string[] = []
    let releaseText: (() => void) | undefined
    const textHeld = new Promise<void>((resolve) => {
      releaseText = resolve
    })

    setClaudeCodeAutonomousUpdateHandler(async (event) => {
      if (event.update.kind === 'text') await textHeld
      seen.push(event.update.kind)
    })
    const harness = sessionHarness('codex')

    harness.emit({ kind: 'status', status: 'active' })
    harness.emit({ kind: 'text', text: 'Goal continuation finished.' })
    harness.emit({ kind: 'status', status: 'idle' })
    await Bun.sleep(0)
    expect(seen).toEqual(['status'])

    releaseText?.()
    await textHeld
    await Bun.sleep(0)
    await Bun.sleep(0)
    expect(seen).toEqual(['status', 'text', 'complete'])
  })

  test('runtime idle cannot be overridden by late tools, including missing terminal updates', async () => {
    const seen: OpenAbSessionUpdate[] = []

    setClaudeCodeAutonomousUpdateHandler((event) => {
      seen.push(event.update)
    })
    const harness = sessionHarness('codex')

    harness.session.activeTurn = { cancelled: false }
    harness.emit({ kind: 'status', status: 'idle' })
    harness.session.activeTurn = undefined
    // Production incident: output after prompt completion, then failure 218s later.
    for (const [toolCallId, status] of [
      ['web-search-without-terminal', 'in_progress'],
      ['watch-checks', ''],
      ['watch-checks', 'failed'],
    ]) {
      harness.emit({
        kind: 'agent',
        update: { kind: 'tool', toolCallId: toolCallId!, title: '', status: status! },
      })
    }
    await Bun.sleep(0)
    expect(seen).toEqual([])
    expect(harness.session.runtimeThreadStatus).toBe('idle')
  })

  test('a Codex turn starts only on runtime active, even before any content', async () => {
    const seen: OpenAbSessionUpdate[] = []

    setClaudeCodeAutonomousUpdateHandler((event) => {
      seen.push(event.update)
    })
    const harness = sessionHarness('codex')

    harness.emit({ kind: 'text', text: 'Unowned late content' })
    harness.emit({ kind: 'status', status: 'active' })
    harness.emit({ kind: 'text', text: 'Actual continuation' })
    harness.emit({ kind: 'status', status: 'idle' })
    harness.emit({ kind: 'text', text: 'Late content must not reopen it' })
    await Bun.sleep(0)
    expect(seen.map((update) => update.kind)).toEqual(['status', 'text', 'complete'])
  })

  test('a new runtime turn survives persistence of the previous turn', async () => {
    let release!: () => void
    const persistence = new Promise<void>((resolve) => {
      release = resolve
    })

    setClaudeCodeAutonomousUpdateHandler((event) =>
      event.update.kind === 'complete' ? persistence : undefined,
    )
    const harness = sessionHarness('codex')

    harness.emit({ kind: 'status', status: 'active' })
    harness.emit({ kind: 'status', status: 'idle' })
    harness.emit({ kind: 'status', status: 'active' })
    release()
    await Bun.sleep(0)
    expect(harness.session.runtimeThreadStatus).toBe('active')
  })

  test('uses runtime lifecycle for Claude and ignores late content after idle', async () => {
    const seen: string[] = []

    setClaudeCodeAutonomousUpdateHandler((event) => {
      seen.push(event.update.kind)
    })
    const harness = sessionHarness('claude-code')

    harness.emit({ kind: 'status', status: 'active' })
    harness.emit({ kind: 'text', text: 'Still working…' })
    harness.emit({ kind: 'status', status: 'idle' })
    await Bun.sleep(0)

    expect(seen).toEqual(['status', 'text', 'complete'])
  })

  test('runtime owns continuation for Codex once when a background terminal completes', async () => {
    const seen: string[] = []
    const prompts: string[] = []
    const harness = sessionHarness('codex', async (_sessionId, text, onTextDelta) => {
      prompts.push(text)
      harness.emit({ kind: 'status', status: 'active' })
      onTextDelta('Background checks passed.')

      return { stopReason: 'end_turn' }
    })

    setClaudeCodeAutonomousUpdateHandler((event) => {
      seen.push(event.update.kind)
    })
    harness.emit({
      kind: 'async-task',
      asyncTaskId: 'task-1',
      phase: 'spawned',
      toolCallId: 'tool-1',
    })
    harness.emit({
      kind: 'async-task',
      asyncTaskId: 'task-1',
      phase: 'terminal',
      state: 'completed',
      toolCallId: 'tool-1',
    })
    await Bun.sleep(350)
    await Bun.sleep(0)

    expect(prompts).toHaveLength(0)
    expect(seen).toEqual([])
    // Continuation arrives from runtime, never from a backend timer.
    harness.emit({ kind: 'status', status: 'active' })
    harness.emit({ kind: 'text', text: 'Background checks passed.' })
    harness.emit({ kind: 'status', status: 'idle' })
    await Bun.sleep(0)
    expect(seen).toEqual(['status', 'text', 'complete'])
  })

  test('does not wake Codex for a background terminal stopped by the user', async () => {
    let prompts = 0
    const harness = sessionHarness('codex', async () => {
      prompts++

      return { stopReason: 'end_turn' }
    })

    setClaudeCodeAutonomousUpdateHandler(() => {})
    harness.emit({
      kind: 'async-task',
      asyncTaskId: 'task-1',
      phase: 'terminal',
      state: 'stopped',
    })
    await Bun.sleep(300)

    expect(prompts).toBe(0)
  })

  test('answers a permission request that arrives with no prompt in flight', async () => {
    const seen: string[] = []

    setClaudeCodeAutonomousUpdateHandler(() => {})
    setClaudeCodeAutonomousPermissionHandler((permission) => {
      seen.push(`${permission.conversationId}:${permission.request.toolCall.toolCallId}`)
      // The durable owner travels with the request, not just the last actor.
      expect(permission.userId).toBe('user-1')
      expect(permission.conversationOwnerUserId).toBe('owner-1')

      return Promise.resolve({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
    })
    const harness = sessionHarness()

    harness.emit({ kind: 'status', status: 'active' })

    expect(await harness.requestPermission()).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    })
    expect(seen).toEqual(['conversation-1:tool-1'])
    // The runtime is mid-turn on its own, so the session must stay busy long
    // enough for this turn's `complete` frame to be delivered.
    expect(harness.session.autonomousTranscriptOpen).toBe(true)
  })

  test('fails a permission request closed once the conversation has moved runtime', async () => {
    attachment = { runtimeUrl: 'wss://new/acp', openabSessionId: 'new-session' }
    let calls = 0

    setClaudeCodeAutonomousUpdateHandler(() => {})
    setClaudeCodeAutonomousPermissionHandler(() => {
      calls++

      return Promise.resolve({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
    })
    const harness = sessionHarness()

    // A stale listener must not keep an authorization path alive — under Full
    // Access it would otherwise auto-allow for a conversation that has moved.
    expect(await harness.requestPermission()).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(calls).toBe(0)
    expect(harness.session.autonomousTranscriptOpen).toBe(false)
  })

  test('cancels an approval that resolves after the conversation has moved', async () => {
    setClaudeCodeAutonomousUpdateHandler(() => {})
    setClaudeCodeAutonomousPermissionHandler(() => {
      // The conversation migrates while the approval is still pending.
      attachment = { runtimeUrl: 'wss://new/acp', openabSessionId: 'new-session' }

      return Promise.resolve({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
    })
    const harness = sessionHarness()

    harness.emit({ kind: 'status', status: 'active' })

    expect(await harness.requestPermission()).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(harness.session.autonomousTranscriptOpen).toBe(false)
  })

  test('fails a permission request closed when no autonomous handler is registered', async () => {
    setClaudeCodeAutonomousUpdateHandler(() => {})
    setClaudeCodeAutonomousPermissionHandler(undefined)
    const harness = sessionHarness()

    expect(await harness.requestPermission()).toEqual({ outcome: { outcome: 'cancelled' } })
  })

  test('contains a synchronous run-creation failure from the WebSocket callback', async () => {
    setClaudeCodeAutonomousUpdateHandler(() => {
      throw new Error('server is draining')
    })
    const harness = sessionHarness()

    expect(() => harness.emit({ kind: 'text', text: 'Timer fired.' })).not.toThrow()
    await Bun.sleep(0)
  })
})

test('old native updates cannot write into a conversation after it has moved', async () => {
  attachment = { runtimeUrl: 'wss://new/acp', openabSessionId: 'new-session' }
  let calls = 0

  setClaudeCodeAutonomousUpdateHandler(() => {
    calls++
  })
  const harness = sessionHarness()

  harness.emit({ kind: 'text', text: 'Stale old runtime output' })
  await Bun.sleep(0)
  expect(calls).toBe(0)
})

test('removed attachments stop forwarding autonomous output', async () => {
  attachment = null
  let calls = 0

  setClaudeCodeAutonomousUpdateHandler(() => {
    calls++
  })
  const harness = sessionHarness()

  harness.emit({ kind: 'text', text: 'Output after removal' })
  await Bun.sleep(0)
  expect(calls).toBe(0)
})

test('late tool results update the original transcript without acquiring a run', async () => {
  const tools: string[] = []

  setClaudeCodeBackgroundToolHandler(async (context, update) => {
    expect(context.conversationOwnerUserId).toBe('owner-1')
    tools.push(update.toolCallId)
  })
  setClaudeCodeAutonomousUpdateHandler(() => {
    throw new Error('Must not create a run')
  })
  const h = sessionHarness('codex')

  h.emit({ kind: 'status', status: 'idle' })
  h.emit({
    kind: 'agent',
    update: { kind: 'tool', toolCallId: 'original-command', title: '', status: 'failed' },
  })
  await Bun.sleep(0)
  expect(tools).toEqual(['original-command'])
})

test('runtime permission requests are not denied by a stale transcript status', async () => {
  let calls = 0

  setClaudeCodeAutonomousPermissionHandler(async () => {
    calls++

    return { outcome: { outcome: 'selected', optionId: 'allow-once' } }
  })
  const h = sessionHarness('codex')

  h.emit({ kind: 'status', status: 'idle' })
  expect(await h.requestPermission()).toEqual({
    outcome: { outcome: 'selected', optionId: 'allow-once' },
  })
  expect(calls).toBe(1)
  expect(h.session.runtimeThreadStatus).toBe('idle')
})

test('provider idle cannot close a runtime-owned continuation before its final buffered text', async () => {
  const seen: string[] = []

  setClaudeCodeAutonomousUpdateHandler((event) => {
    seen.push(event.update.kind)
  })
  const h = sessionHarness('codex')

  h.emit({
    kind: 'agent',
    update: {
      kind: 'runtime-state',
      snapshot: { schemaVersion: 2, state: 'active', phase: 'finishing' },
    },
  })
  h.emit({ kind: 'status', status: 'idle' })
  h.emit({ kind: 'text', text: 'The final buffered result.' })
  h.emit({
    kind: 'agent',
    update: { kind: 'runtime-state', snapshot: { schemaVersion: 2, state: 'idle', phase: 'idle' } },
  })
  await Bun.sleep(0)
  expect(seen).toEqual(['status', 'text', 'complete'])
})
