export type TurnOutcome =
  | { kind: 'finished'; text: string }
  | { kind: 'approval'; toolName?: string }
  | { kind: 'failed'; cause: string }

export type TurnFacts = {
  frames: readonly string[]
  aborted: boolean
  awaitingAuthorization?: boolean
  awaitingDecision?: string
}

// The client resumes these on its own, or another replica picks the turn up.
const SILENT_PAUSES = new Set(['model-silence', 'tool-execution-timeout', 'shutdown'])

const PAUSE_CAUSES: Record<string, string> = {
  'output-budget': 'The agent reached its output limit before finishing.',
  'content-filter': 'The response was blocked by a content filter.',
}

const NOTIFICATION_MAX_CHARS = 200

type Payload = Record<string, unknown> & { type: string }

function parseFrame(frame: string): Payload | null {
  if (!frame.startsWith('data: ')) return null
  try {
    const payload = JSON.parse(frame.slice('data: '.length).trimEnd()) as unknown

    if (payload && typeof payload === 'object' && typeof (payload as Payload).type === 'string') {
      return payload as Payload
    }
  } catch {
    return null
  }

  return null
}

function stringField(payload: Payload, key: string): string | undefined {
  const value = payload[key]

  return typeof value === 'string' && value.length > 0 ? value : undefined
}

type FrameScan = {
  finalText: string
  approvalTool?: string
  sawApproval: boolean
  errorText?: string
  terminal?: { type: string; reason?: string }
}

function isStepBoundary(type: string): boolean {
  return type.startsWith('tool-') || type.startsWith('reasoning')
}

function scanFrames(frames: readonly string[]): FrameScan {
  const toolNames = new Map<string, string>()
  const scan: FrameScan = { finalText: '', sawApproval: false }
  let textClosed = false

  for (const frame of frames) {
    const payload = parseFrame(frame)

    if (!payload) continue
    const { type } = payload
    const toolCallId = stringField(payload, 'toolCallId')
    const toolName = stringField(payload, 'toolName')

    if (toolCallId && toolName) toolNames.set(toolCallId, toolName)
    if (type === 'text-delta') {
      if (textClosed) scan.finalText = ''
      textClosed = false
      scan.finalText += stringField(payload, 'delta') ?? ''
    } else if (type === 'tool-approval-request') {
      scan.sawApproval = true
      scan.approvalTool = toolCallId ? toolNames.get(toolCallId) : undefined
    } else if (type === 'error') {
      scan.errorText = stringField(payload, 'errorText') ?? 'The agent stopped with an error.'
    } else if (type === 'atlas-turn-complete' || type === 'atlas-turn-paused') {
      scan.terminal = { type, reason: stringField(payload, 'reason') }
    }
    if (isStepBoundary(type)) textClosed = true
  }

  return scan
}

export function approvalToolName(frames: readonly string[]): string | undefined {
  return scanFrames(frames).approvalTool
}

function pausedOutcome(reason: string | undefined, aborted: boolean): TurnOutcome | null {
  if (!reason || SILENT_PAUSES.has(reason)) return null
  if (reason === 'stream-ended-without-result' && aborted) return null

  return {
    kind: 'failed',
    cause: PAUSE_CAUSES[reason] ?? 'The agent stopped before finishing this turn.',
  }
}

export function classifyTurn(facts: TurnFacts): TurnOutcome | null {
  const scan = scanFrames(facts.frames)

  if (scan.errorText && !facts.aborted) {
    return { kind: 'failed', cause: scan.errorText.trim().split('\n')[0] ?? scan.errorText }
  }
  if (!scan.terminal) return null
  if (scan.terminal.type === 'atlas-turn-paused') {
    return pausedOutcome(scan.terminal.reason, facts.aborted)
  }
  if (facts.awaitingDecision === 'client-tool') return null
  if (facts.awaitingDecision || facts.awaitingAuthorization || scan.sawApproval) {
    return { kind: 'approval', ...(scan.approvalTool ? { toolName: scan.approvalTool } : {}) }
  }

  return { kind: 'finished', text: scan.finalText }
}

export function plainText(input: string): string {
  return input
    .replaceAll(/```[\s\S]*?```/g, '(code)')
    .replaceAll(/\]\([^()\s]*\)/g, '')
    .replaceAll(/[*_~`[\]]+/g, '')
    .replaceAll(/^[ \t]*(?:#{1,6}|>|[-+]|\d+\.)[ \t]/gm, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

export function truncate(text: string, max = NOTIFICATION_MAX_CHARS): string {
  const chars = Array.from(text)

  return chars.length <= max ? text : `${chars.slice(0, max).join('')}…`
}

export function outcomeBody(outcome: TurnOutcome, planNumber: number | null): string {
  if (planNumber != null) return `Plan #${String(planNumber)} is waiting for approval`
  switch (outcome.kind) {
    case 'finished':
      return truncate(plainText(outcome.text)) || 'The agent finished without a text response.'
    case 'approval':
      return outcome.toolName
        ? truncate(`Waiting for your approval: ${outcome.toolName}`)
        : 'Waiting for your approval'
    case 'failed':
      return truncate(outcome.cause)
  }
}
