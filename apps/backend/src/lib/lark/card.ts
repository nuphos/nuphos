// Builders for the interactive card the agent streams its reply into. The card
// is posted once (as a reply to the triggering message) and PATCHed in place as
// the run produces text and tool steps. Lark caps a card at 30KB; we stay well
// under by clamping the body and step details.

export type LarkStepStatus = 'in_progress' | 'complete' | 'error'

export type LarkStep = {
  id: string
  title: string
  status: LarkStepStatus
  detail?: string
}

export type LarkCardState = {
  body: string
  steps: LarkStep[]
  phase: 'running' | 'done' | 'error'
  sessionId?: string
}

const BODY_LIMIT = 8000
const DETAIL_LIMIT = 120
const TITLE_LIMIT = 80
// Keep the whole card comfortably under Lark's 30KB ceiling: a tool-heavy run
// can produce hundreds of steps, so only the most recent ones are rendered.
const MAX_STEPS = 20

function clamp(text: string, limit: number): string {
  const trimmed = text.trim()

  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed
}

function stepIcon(status: LarkStepStatus): string {
  switch (status) {
    case 'complete':
      return '✅'
    case 'error':
      return '❌'
    case 'in_progress':
    default:
      return '⏳'
  }
}

function stepsMarkdown(steps: LarkStep[]): string {
  // Render only the most recent MAX_STEPS; note how many earlier ones were elided
  // so a long run never blows the card budget.
  const hidden = steps.length - MAX_STEPS
  const shown = hidden > 0 ? steps.slice(-MAX_STEPS) : steps
  const lines = shown.map((step) => {
    const head = `${stepIcon(step.status)} ${clamp(step.title, TITLE_LIMIT)}`
    const detail = step.detail ? ` — ${clamp(step.detail.replace(/\s+/g, ' '), DETAIL_LIMIT)}` : ''

    return `${head}${detail}`
  })

  if (hidden > 0) lines.unshift(`… and ${String(hidden)} earlier step${hidden === 1 ? '' : 's'}`)

  return lines.join('\n')
}

// Empty-body placeholder is phase-specific: a still-running card shows "思考中",
// but a completed/failed card with no visible text should not claim to still be
// thinking.
function bodyText(state: LarkCardState): string {
  const body = state.body.trim()

  if (body) return body
  if (state.phase === 'running') return '_Thinking…_'
  if (state.phase === 'error') return '_Something went wrong._'

  return '_Done — no text reply to show._'
}

// Minimal streaming card: no header, no buttons — just the answer body, plus a
// live step timeline WHILE running so the user can see what the agent is doing.
// Once the turn finishes, the steps drop away and the card keeps only the final
// result.
export function buildAgentCard(state: LarkCardState): Record<string, unknown> {
  const elements: Record<string, unknown>[] = []

  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: clamp(bodyText(state), BODY_LIMIT) },
  })

  if (state.phase === 'running' && state.steps.length > 0) {
    elements.push({ tag: 'hr' })
    elements.push({
      tag: 'note',
      elements: [{ tag: 'lark_md', content: stepsMarkdown(state.steps) }],
    })
  }

  return {
    // update_multi allows the card to be PATCHed repeatedly as it streams.
    config: { wide_screen_mode: true, update_multi: true },
    elements,
  }
}
