import { OpenAbRpcError } from './openab-acp-errors'

export const RUNTIME_DISK_FULL_CODE = 'runtime_disk_full'
export const RUNTIME_INTERNAL_ERROR_CODE = 'runtime_internal_error'

const RUNTIME_FAILURES = {
  [RUNTIME_DISK_FULL_CODE]:
    'The computer this Bot or Task runs on is out of disk space, so this turn could not run. Ask someone who manages that computer to free space, or switch to another runtime, then resend your message.',
  [RUNTIME_INTERNAL_ERROR_CODE]:
    'The agent failed without saying why. Resend your message; if it keeps happening, check the runtime’s logs or switch this conversation to another runtime.',
} as const

export const RUNTIME_AGENT_EXITED_CODE = 'runtime_agent_exited'

export type RuntimeFailure = {
  code: keyof typeof RUNTIME_FAILURES | typeof RUNTIME_AGENT_EXITED_CODE
  message: string
}

/**
 * The runtime's notice for an agent process that died while its session was starting: the
 * heading, one sentence naming how it ended and what to do, then the stderr it ended on.
 */
const AGENT_EXITED = /^\*\*Agent Stopped\*\*\n([^\n]+)(?:\n```\n([\s\S]+?)\n```)?$/u

/** One stack frame or JSON dump on a line would swamp the failure row it is quoted in. */
const QUOTED_STDERR_CHARS = 200

const quoted = (line: string) =>
  line.length > QUOTED_STDERR_CHARS ? `"${line.slice(0, QUOTED_STDERR_CHARS)}…"` : `"${line}"`

/**
 * Only the runtime saw that computer's agent die, so its sentence is the whole explanation
 * anyone gets. The last stderr line is quoted with it; the rest stays in the frame's details.
 */
function agentExited(error: unknown): RuntimeFailure | undefined {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    const said = cause instanceof OpenAbRpcError && AGENT_EXITED.exec(cause.message.trim())

    if (!said) continue
    const last = said[2]?.trim().split('\n').at(-1)

    return {
      code: RUNTIME_AGENT_EXITED_CODE,
      message: last ? `${said[1]} Its last output: ${quoted(last)}` : (said[1] ?? ''),
    }
  }

  return undefined
}

const DISK_FULL = /\bENOSPC\b|no space left on device/iu
/** The shapes an adapter's -32603 takes on its way here when it carries no cause at all. */
const BARE_INTERNAL_ERROR =
  /^(?:JSON-RPC error -32603: Internal error|(?:\*\*Internal Error\*\* \(code: -32603\)\n)?Internal error(?:\n\n_The agent did not return any error details\.[^\n]*_)?)$/u

function runtimeFailureCode(error: unknown): keyof typeof RUNTIME_FAILURES | undefined {
  const messages = typeof error === 'string' ? [error] : []

  for (let cause = error; cause instanceof Error; cause = cause.cause) messages.push(cause.message)
  if (messages.some((message) => DISK_FULL.test(message))) return RUNTIME_DISK_FULL_CODE
  if (error instanceof OpenAbRpcError && BARE_INTERNAL_ERROR.test(error.message.trim())) {
    return RUNTIME_INTERNAL_ERROR_CODE
  }

  return undefined
}

/**
 * A runtime failure with a deterministic cause (an errno, or no cause at all) and a next
 * step, or undefined. Prose such as a process-death notice is the adapter's to word.
 */
export function runtimeFailure(error: unknown): RuntimeFailure | undefined {
  const code = runtimeFailureCode(error)

  return code ? { code, message: RUNTIME_FAILURES[code] } : agentExited(error)
}
