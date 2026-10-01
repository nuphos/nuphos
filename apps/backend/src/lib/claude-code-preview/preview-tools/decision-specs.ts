// Shared vocabulary of the decision tools: which classic tools park the turn,
// how long one may park it, and what the model is told when nobody answers.
import type { PreviewWaitKind } from '../decision-waiter'

export type DecisionSpec = {
  kind: PreviewWaitKind
  /** The entity id the decision is about, read from the classic tool's output. */
  ref?: (output: Record<string, unknown>) => string | undefined
  /** Hint appended to the result so Claude reads the decision as authoritative. */
  instruction: string
}

export const DECISION_SPECS: Record<string, DecisionSpec> = {
  propose_authorization_rule: {
    kind: 'authorization-rule',
    ref: (output) => (typeof output.ruleId === 'string' ? output.ruleId : undefined),
    instruction: 'The user has now confirmed or dismissed the rule; continue accordingly.',
  },
}

export const CLIENT_TOOL_INSTRUCTION =
  "The tool ran on the user's machine; `output` is its real result."

/**
 * How long one MCP call may hold the turn open waiting for an answer.
 *
 * MCP traffic goes straight to the backend Service (see `previewMcpBaseUrl`),
 * so the binding limit is our own `idleTimeout` of 120s rather than any proxy.
 * Staying under it lets a wait live and die inside a single request: answered
 * in time, the turn simply continues; unanswered, the tool says so and the
 * model moves on. Nothing polls, and nothing outlives the call that made it.
 */
export const DECISION_WAIT_MS = 90_000

const UNANSWERED_INSTRUCTION: Record<PreviewWaitKind, string> = {
  // A client tool is not a decision: Nuphos Desktop runs it without asking, so
  // "nobody decided" would describe a permission prompt that does not exist.
  'client-tool':
    'Nuphos Desktop never picked this call up, so the tool did not run and ' +
    'nothing happened on the user machine. Never say an approval or permission ' +
    'prompt is pending. Tell the user Nuphos Desktop did not run it, and ask ' +
    'them to retry or to run it themselves.',
  'permission-grant':
    'This historical permission proposal can no longer be applied. End your turn and ' +
    'explain the missing access. The user can adjust it in the cloud console or use ' +
    'local_exec on a selected device signed in with the necessary CLI permissions.',
  'authorization-rule':
    'The user has not decided yet. The rule card is live in Nuphos and can still ' +
    'be answered. End your turn now and say so — Nuphos starts a new turn with ' +
    'the answer once they decide. Do not call this tool again for the same rule.',
  'agent-permission':
    'Nobody answered in time, so the request was not approved. Treat it as ' +
    'denied and tell the user.',
}

export function unansweredInstruction(kind: PreviewWaitKind): string {
  return UNANSWERED_INSTRUCTION[kind]
}

/** One line for the transcript card, so the user sees what the model was told. */
export function unansweredCardText(kind: PreviewWaitKind, waitedMs: number): string {
  const seconds = String(Math.round(waitedMs / 1000))

  return kind === 'client-tool'
    ? `Nuphos Desktop did not run this tool (no result after ${seconds}s).`
    : `Still waiting for an answer after ${seconds}s — the agent stopped holding the turn.`
}

// Nothing on the user's device can run a client tool here: no card would be
// reachable, so the call fails now rather than parking the turn on an answer
// that cannot arrive.
export const CLIENT_TOOL_UNREACHABLE_INSTRUCTION =
  'This conversation is not attached to a Nuphos Desktop session, so tools that ' +
  'run on the user machine are unavailable here and nothing was executed. Do not ' +
  'retry and do not wait: tell the user that running commands on their machine ' +
  'needs Nuphos Desktop, and continue with what you can do on the runtime itself.'
