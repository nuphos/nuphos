import { isToolSearchTitle, nuphosToolName } from '@/lib/claude-code-preview/preview-agent-update'
import {
  TOOL_PRESENTATION,
  TOOL_PRESENTATION_FRAME,
  TOOL_PRESENTATION_ID,
  runtimeToolResult,
  runtimeToolOutput,
} from '@/lib/claude-code-preview/preview-tool-presentation'
import { INTERRUPTED_TOOL_ERROR } from '@/lib/claude-code-preview/preview-transcript'

import type { createPreviewToolLog } from './chat-preview-tool-log'
import type { PreviewAgentUpdate } from '@/lib/claude-code-preview/preview-agent-update'

const runtimeOwners = new WeakMap<object, Set<string>>()
const legacyOwners = new WeakMap<object, Set<string>>()
const handlerModes = new WeakMap<object, Map<string, boolean>>()

/** Consumes backend-only ownership declarations, never forwards them as chat parts. */
export function consumePreviewToolPresentation(
  emit: (frame: Record<string, unknown>) => void,
  log: ReturnType<typeof createPreviewToolLog>,
  frame: Record<string, unknown>,
): boolean {
  const marked =
    frame[TOOL_PRESENTATION] === 'runtime' &&
    ['tool-input-available', 'tool-output-available', 'tool-output-error'].includes(
      String(frame.type),
    )

  if (frame.type !== TOOL_PRESENTATION_FRAME && !marked) return false
  if ((!marked && frame.owner !== 'runtime') || typeof frame.toolName !== 'string') return true
  if (marked) {
    if (typeof frame.toolCallId !== 'string') return false
    const modes = handlerModes.get(log) ?? new Map<string, boolean>()

    handlerModes.set(log, modes)
    const existing = modes.get(frame.toolCallId)

    if (existing !== undefined) return existing
    // Opaque calls may finish before their bridge frames arrive. Do not infer
    // an invocation's identity from a different (even completed) call of its class.
    const opaque = [...log.states.values()].some((state) => !state.mcpToolName)
    const supported =
      !legacyOwners.get(log)?.has(frame.toolName) &&
      !opaque &&
      [...log.states.values()].some((state) => state.mcpToolName === frame.toolName)

    modes.set(frame.toolCallId, supported)
    if (!supported) {
      const legacy = legacyOwners.get(log) ?? new Set<string>()

      legacy.add(frame.toolName)
      legacyOwners.set(log, legacy)

      return false
    }
  } else if (legacyOwners.get(log)?.has(frame.toolName)) return true
  const names = runtimeOwners.get(log) ?? new Set<string>()

  runtimeOwners.set(log, names)
  names.add(frame.toolName)
  for (const [id, state] of log.states) {
    if (state.toolName !== frame.toolName || !state.hidden) continue
    state.hidden = false
    emit({
      type: 'tool-input-available',
      toolCallId: id,
      toolName: state.toolName,
      input: state.input ?? {},
    })
    const step = log.list().find((entry) => entry.toolCallId === id)

    if (step?.errorText !== undefined)
      emit({ type: 'tool-output-error', toolCallId: id, errorText: step.errorText })
    else if (step?.output !== undefined)
      emit({ type: 'tool-output-available', toolCallId: id, output: step.output })
  }

  return true
}

export function handlePreviewToolUpdate(
  emit: (frame: Record<string, unknown>) => void,
  log: ReturnType<typeof createPreviewToolLog>,
  update: Extract<PreviewAgentUpdate, { kind: 'tool' }>,
): void {
  const known = log.states.get(update.toolCallId)
  const title = oneLineTitle(update.title)
  const name = title === '' ? (known?.name ?? 'tool') : title
  const classic = nuphosToolName(update.mcpToolId) ?? known?.mcpToolName
  const result = classic ? runtimeToolResult(update.rawOutput) : null

  const meta = result?._meta as Record<string, unknown> | undefined
  const handlerId = meta?.[TOOL_PRESENTATION_ID]
  const mode = typeof handlerId === 'string' ? handlerModes.get(log)?.get(handlerId) : undefined
  // Result metadata binds this exact ACP completion to the handler invocation.
  // Previously consumed calls keep their mode even after an opaque call falls back.
  const resultOwned =
    result !== null &&
    classic !== undefined &&
    (mode ?? (typeof handlerId === 'string' || !legacyOwners.get(log)?.has(classic)))

  if (resultOwned && mode === undefined && typeof handlerId === 'string') {
    const modes = handlerModes.get(log) ?? new Map<string, boolean>()

    modes.set(handlerId, true)
    handlerModes.set(log, modes)
  }
  const runtimeOwned =
    resultOwned ||
    (classic !== undefined &&
      runtimeOwners.get(log)?.has(classic) === true &&
      !legacyOwners.get(log)?.has(classic) &&
      [...log.states.values()].every((state) => state.mcpToolName !== undefined))
  const displayName = classic ?? name
  const hidden =
    update.revealed || runtimeOwned
      ? false
      : (known?.hidden ?? (isToolSearchTitle(name) || classic !== undefined))
  // Undefined until the call's input arrives; a steer can cut a call off before.
  const input = update.rawInput ?? known?.input
  const revealing = known?.hidden === true && !hidden

  if (!known || revealing || update.rawInput !== undefined || name !== known.name) {
    log.states.set(update.toolCallId, {
      name,
      toolName: classic ?? name,
      input,
      hidden,
      ...(classic ? { mcpToolName: classic } : {}),
    })
    if (!isToolSearchTitle(name)) log.record(update.toolCallId, classic ?? name, input ?? {})
    if (!hidden) {
      emit({
        type: 'tool-input-available',
        toolCallId: update.toolCallId,
        toolName: displayName,
        input: input ?? {},
      })
    }
  }
  if (update.status === 'completed') {
    const output = result
      ? runtimeToolOutput(result)
      : (update.rawOutput ?? update.contentText ?? null)

    if (result?.isError === true) {
      const errorText = log.fail(
        update.toolCallId,
        typeof output === 'string' ? output : JSON.stringify(output),
      )

      if (!hidden) emit({ type: 'tool-output-error', toolCallId: update.toolCallId, errorText })

      return
    }

    log.complete(update.toolCallId, output)
    if (!hidden) emit({ type: 'tool-output-available', toolCallId: update.toolCallId, output })
  } else if (update.status === 'failed') {
    const errorText =
      update.contentText ??
      (typeof update.rawOutput === 'string' ? update.rawOutput : `${name} failed`)

    const cause = log.fail(update.toolCallId, errorText)

    if (!hidden)
      emit({ type: 'tool-output-error', toolCallId: update.toolCallId, errorText: cause })
  }
}

/** Calls still waiting on a result: the ones a steer arriving now could cut off. */
export function openToolCalls(log: ReturnType<typeof createPreviewToolLog>): string[] {
  return log
    .list()
    .filter((step) => step.output === undefined && step.errorText === undefined)
    .map((step) => step.toolCallId)
}

/**
 * A steer aborts the running cycle. A call it cut off while the model was
 * still writing its input never runs, so no result ever arrives and its timer
 * would tick until the turn ends. Once the agent answers the steer, close the
 * calls that were open at the steer and never got their input. A call with
 * input may be a background command that is still running, so it stays open.
 */
export function closeCallsCutOffBySteer(
  emit: (frame: Record<string, unknown>) => void,
  log: ReturnType<typeof createPreviewToolLog>,
  cutOff: readonly string[],
): void {
  const open = new Set(openToolCalls(log))

  for (const toolCallId of cutOff) {
    const state = log.states.get(toolCallId)

    if (!open.has(toolCallId) || state?.input !== undefined) continue
    const errorText = log.fail(toolCallId, INTERRUPTED_TOOL_ERROR)

    if (!state?.hidden) emit({ type: 'tool-output-error', toolCallId, errorText })
  }
}

/** Calls open when the latest steer arrived, closed by the agent's next output. */
export function trackSteerCutOff(
  emit: (frame: Record<string, unknown>) => void,
  log: ReturnType<typeof createPreviewToolLog>,
) {
  let cutOff: string[] = []

  return {
    /** No update: streamed text. An update for a call open at the steer is not an answer. */
    observe(update?: PreviewAgentUpdate) {
      if (update?.kind === 'steering') {
        cutOff = openToolCalls(log)

        return
      }
      if (cutOff.length === 0) return
      if (update?.kind === 'tool' && cutOff.includes(update.toolCallId)) return
      closeCallsCutOffBySteer(emit, log, cutOff)
      cutOff = []
    },
  }
}

const TITLE_MAX = 120

/**
 * A call's title as one short line. Codex titles a shell call with its whole
 * command, which the call's input already carries, so every stored and
 * streamed command went out twice.
 */
export function oneLineTitle(title: string): string {
  const line = title.trimStart().split('\n', 1)[0] ?? ''

  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line
}
