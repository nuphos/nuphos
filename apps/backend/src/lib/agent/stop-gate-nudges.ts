import type { ToolResultError } from './tool-result-errors'

/**
 * Max forced continuation rounds per request — the loop's round counter is
 * the fuse, so a rule the model cannot satisfy costs at most this many extra
 * model rounds before the turn is allowed to end.
 */
export const MAX_STOP_GATE_CONTINUATIONS = 2

function attemptSuffix(priorContinuations: number): string {
  return `\n\nThis is automatic continuation ${String(priorContinuations + 1)} of at most ${String(MAX_STOP_GATE_CONTINUATIONS)} for this turn. The user did not type anything — do not greet them or apologize; just do the work or state precisely what you need.`
}

export function silentEndNudge(
  toolResultErrors: ToolResultError[],
  priorContinuations: number,
): string {
  const errorLines =
    toolResultErrors.length > 0
      ? [
          '',
          'Note: tool calls in this turn reported errors:',
          ...toolResultErrors
            .slice(0, 5)
            .map((e) => `- ${e.toolName ?? 'unknown tool'}: ${e.message}`),
          'If these were left unhandled, address them (retry, work around, or explain the impact) as part of your closing message.',
        ]
      : []

  return (
    [
      '## Continuation forced by stop gate: turn ended without a message to the user',
      '',
      'You ended your turn without any visible text. The user sees tool activity stop and then silence — they cannot tell whether you succeeded, failed, or gave up.',
      ...errorLines,
      '',
      'Write a concise closing message now: what you did, what you observed (cite the actual command output you saw, not what you assume), the outcome, and any recommended next step. If further work is obviously needed and you can do it with your tools, do it first, then summarize.',
    ].join('\n') + attemptSuffix(priorContinuations)
  )
}

export function puntNudge(judgeReason: string, priorContinuations: number): string {
  return (
    [
      '## Continuation forced by stop gate: your final message handed work back to the user',
      '',
      `An automated check flagged your final message: ${judgeReason || 'it asks the user to do or answer something your own tools can handle.'}`,
      '',
      'Do that work yourself now using your tools (bash, skills, web search, knowledge base — whatever applies), then continue the task with what you find. If several interpretations were possible, pick the most defensible one from the evidence and state the assumption instead of asking.',
      '',
      'Only ask the user for things you truly cannot obtain: approvals, credentials you lack, integration bindings, and genuine preference decisions.',
    ].join('\n') + attemptSuffix(priorContinuations)
  )
}
